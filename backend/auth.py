"""User identity and site scoping.

Substrait's auth proxy injects X-Forwarded-Email on every gated request once the
app owner enables Google SSO. That header is trustworthy ONLY while SSO is on —
with SSO off the proxy is not there to strip client-sent values, so anyone can
forge it. Two rules follow (PRD §5.4):

  1. A missing header is anonymous, never admin.
  2. Anonymous access is refused unless ALLOW_ANONYMOUS_DEV is explicitly on,
     which is for local development and must be false anywhere deployed.

SSO answers *who*. Roles and site access are this app's own logic.
"""
import os

from fastapi import Depends, Header, HTTPException, Request

import db

ROLES = ("superadmin", "ops_head", "hq", "supervisor", "hub_operator", "staff")

# Rank for "at least this role" checks. Staff is the floor.
#
#   staff         receives against an AWB, picks, counts, raises an unknown-SKU
#                 request
#   hub_operator  staff plus hub dispatch (hidden in the first build, PRD §1.2.2)
#   supervisor    SPV of their own hubs: racks and bins, SKU -> rack, counts,
#                 acknowledging a replenishment variance, registering staff at
#                 their own hubs
#   hq            Ops HQ across every hub: brands, SKUs, photos, thresholds,
#                 racks, station requests, replenishment and variance sign-off,
#                 dark stores, user accounts up to Ops HQ (the former admin role)
#   ops_head      everything Ops HQ does, plus the last approval on every
#                 variance and write-off (PRD §1.2, §11.5). Ranked above hq so
#                 every at_least("hq") check lets the Ops Head through; the
#                 three-step approval that needs the difference is a later build.
#   superadmin    everything, grants Ops Head and superadmin, and may view the
#                 app as any other role
_RANK = {"staff": 0, "hub_operator": 1, "supervisor": 2, "hq": 3, "ops_head": 4,
         "superadmin": 5}

# Roles a superadmin may preview. Previewing is read-only (see current_user).
VIEWABLE = ("ops_head", "hq", "supervisor", "hub_operator", "staff")

# Which roles each role may give when registering or editing a user (PRD §1.2,
# decided 25 and 30 Sep). Ops HQ and the Ops Head stop at Ops HQ: a role that can
# mint its own peers or superiors is not a hierarchy. The hidden hub operator is
# left to a superadmin until the central warehouse returns.
GRANTABLE = {
    "superadmin": ROLES,
    "ops_head": ("hq", "supervisor", "staff"),
    "hq": ("hq", "supervisor", "staff"),
    "supervisor": ("staff",),
}

# Every person in the operation signs in with a Ninja Van Google account
# (PRD §1.3, §1.4.1). Checked when an account is registered.
ALLOWED_EMAIL_DOMAIN = "ninjavan.co"


def email_allowed(email: str) -> bool:
    """True for an address on the Ninja Van domain, compared without case."""
    email = (email or "").strip().lower()
    return "@" in email and email.rsplit("@", 1)[1] == ALLOWED_EMAIL_DOMAIN


def grantable_roles(role: str) -> tuple[str, ...]:
    """The roles a person holding `role` may give. Empty for staff."""
    return GRANTABLE.get(role, ())


def rank(role: str | None) -> int:
    return _RANK.get(role or "", 0)


class User:
    def __init__(self, row: dict):
        self.id = row["id"]
        self.email = row["email"]
        self.name = row.get("name") or row["email"]
        self.role = row.get("role") or "staff"
        # The account's own role. `role` differs from it only while a superadmin
        # is viewing the app as another role.
        self.real_role = self.role
        self.viewing_as: str | None = None
        self.default_site_id = row.get("default_site_id")
        self.locale = row.get("locale") or "id"

    def at_least(self, role: str) -> bool:
        return _RANK.get(self.role, 0) >= _RANK[role]


def _anon_allowed() -> bool:
    return os.getenv("ALLOW_ANONYMOUS_DEV", "false").lower() in ("1", "true", "yes")


def _auto_domain() -> str:
    """Domain whose staff are provisioned on first sign-in. Empty disables it."""
    return os.getenv("AUTO_PROVISION_DOMAIN", "").strip().lower()


# Where an auto-provisioned account lands: the training site, so a first
# sign-in can look around without being able to touch real stock.
_AUTO_SITE_CODE = "MAC-TRN"


async def _auto_provision(email: str) -> dict | None:
    """Create a staff account for a trusted domain, or return None.

    Only reached for an email the users table has never seen — a deactivated
    account is refused by the caller before we get here, so this can never
    resurrect someone an admin has switched off.

    The domain is checked against the SSO header the proxy injected, never
    against anything the client can set. With SSO off the header is forgeable,
    so provisioning is refused there too (the caller has already returned 401
    for the anonymous case, and DEV mode never reaches this function).
    """
    domain = _auto_domain()
    if not domain or "@" not in email:
        return None
    if email.rsplit("@", 1)[1].lower() != domain:
        return None
    # A misconfigured AUTO_PROVISION_DOMAIN must not open the door to accounts
    # an admin could never have registered by hand.
    if not email_allowed(email):
        return None

    site = await db.fetch_one(
        "SELECT id FROM sites WHERE code = %s AND is_training = 1", (_AUTO_SITE_CODE,)
    )
    site_id = site["id"] if site else None

    # Two first requests can race; the unique key on email decides the winner
    # and both then read back the same row.
    await db.execute(
        "INSERT INTO users (email, name, role, default_site_id, locale, active) "
        "VALUES (%s, %s, 'staff', %s, 'id', 1) "
        "ON DUPLICATE KEY UPDATE users.id = users.id",
        (email, email.split("@")[0].replace(".", " ").title(), site_id),
    )
    row = await db.fetch_one(
        "SELECT id, email, name, role, default_site_id, locale FROM users "
        "WHERE email = %s AND active = 1",
        (email,),
    )
    # Access to the training site only. A live site stays an admin's decision.
    if row and site_id:
        await db.execute(
            "INSERT INTO user_sites (user_id, site_id) VALUES (%s, %s) "
            "ON DUPLICATE KEY UPDATE user_sites.user_id = user_sites.user_id",
            (row["id"], site_id),
        )
    return row


async def current_user(
    x_forwarded_email: str | None = Header(default=None),
    x_view_as: str | None = Header(default=None),
    request: Request = None,
) -> User:
    # Also called directly with only the email (outbound.hiryu_or_admin), when
    # the undeclared parameters still hold their Header() markers.
    view_as = x_view_as if isinstance(x_view_as, str) else None
    method = request.method if isinstance(request, Request) else "GET"
    email = x_forwarded_email
    if not email:
        if not _anon_allowed():
            raise HTTPException(
                status_code=401,
                detail="Belum masuk. Aktifkan Google SSO di tab Access aplikasi. / Not signed in. Enable Google SSO on the app's Access tab.",
            )
        email = os.getenv("DEV_USER_EMAIL", "dev@ninjavan.co")

    if not db.ready():
        raise HTTPException(status_code=503, detail="Database belum diatur. / Database not configured.")

    # Read the row regardless of `active`, so a deactivated account is told it
    # is deactivated rather than silently falling through to provisioning and
    # being recreated. That distinction is the whole point of the flag.
    row = await db.fetch_one(
        "SELECT id, email, name, role, default_site_id, locale, active, first_login_at "
        "FROM users WHERE email = %s",
        (email,),
    )
    if row and not row["active"]:
        raise HTTPException(
            status_code=403,
            detail=f"{email} sudah dinonaktifkan. Minta admin membukanya lagi. / {email} has been deactivated. Ask an admin to restore access.",
        )

    if not row:
        row = await _auto_provision(email)

    if not row:
        # Known to Google, unknown to us, and not on a domain we provision for.
        raise HTTPException(
            status_code=403,
            detail=f"{email} belum terdaftar di WMS. Minta admin menambahkan kamu. / {email} is not registered in the WMS. Ask an admin to add you.",
        )
    user = User(row)
    if row.get("first_login_at") is None and "first_login_at" in row:
        # Orang & akses shows "belum pernah masuk" until the first sign-in.
        await db.execute("UPDATE users SET first_login_at = NOW() "
                         "WHERE id = %s AND first_login_at IS NULL", (row["id"],))

    # A superadmin can look at the app exactly as another role sees it: the
    # same screens, the same refusals. It is a preview, so nothing is written
    # under a borrowed role -- a write would be recorded against the superadmin
    # while being allowed or refused by someone else's permissions.
    if view_as and user.real_role == "superadmin" and view_as in VIEWABLE:
        user.role = view_as
        user.viewing_as = view_as
        if method not in ("GET", "HEAD", "OPTIONS"):
            raise HTTPException(
                status_code=403,
                detail=f"Mode lihat sebagai {view_as}: hanya melihat. Kembali ke superadmin "
                       f"untuk mengubah data. / Viewing as {view_as} is read-only.",
            )
    return user


def require(role: str):
    """Dependency factory: require at least `role`."""

    async def _dep(user: User = Depends(current_user)) -> User:
        if not user.at_least(role):
            raise HTTPException(
                status_code=403,
                detail=f"Ini butuh peran {role}. Peran kamu {user.role}. / This needs the {role} role. You are {user.role}.",
            )
        return user

    return _dep


async def assert_site_access(user: User, site_id: int) -> dict:
    """Every query is site-scoped (PRD §10.2.5). Staff at UT5 cannot touch KJR."""
    site = await db.fetch_one(
        "SELECT id, code, name, site_type, is_training, active, inbound_bins FROM sites "
        "WHERE id = %s",
        (site_id,),
    )
    if not site:
        raise HTTPException(status_code=404, detail="Dark store tidak ditemukan. / Dark store not found.")

    # Ops HQ works across every hub, so it is scoped like an admin here.
    if user.at_least("hq"):
        return site

    allowed = await db.fetch_one(
        "SELECT 1 AS ok FROM user_sites WHERE user_id = %s AND site_id = %s",
        (user.id, site_id),
    )
    if not allowed:
        raise HTTPException(
            status_code=403,
            detail=f"Kamu tidak punya akses ke {site['code']}. / You do not have access to {site['code']}.",
        )
    return site


async def assert_training_site(site_id: int) -> dict:
    """Guard for every training route (PRD M8.2.5).

    Refused on the site flag in the service, not hidden behind a UI toggle or an
    environment variable — a reset must be impossible on a real site, not merely
    discouraged.
    """
    site = await db.fetch_one(
        "SELECT id, code, name, is_training FROM sites WHERE id = %s", (site_id,)
    )
    if not site:
        raise HTTPException(status_code=404, detail="Dark store tidak ditemukan. / Dark store not found.")
    if not site["is_training"]:
        raise HTTPException(
            status_code=403,
            detail=(
                f"{site['code']} adalah dark store aktif. Aksi latihan hanya boleh di lokasi latihan. / "
                f"{site['code']} is a live dark store. Training actions are only "
                "permitted on a training site."
            ),
        )
    return site
