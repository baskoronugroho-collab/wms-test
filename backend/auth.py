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

from fastapi import Depends, Header, HTTPException

import db

ROLES = ("admin", "supervisor", "hub_operator", "staff")

# Rank for "at least this role" checks. Staff is the floor.
_RANK = {"staff": 0, "hub_operator": 1, "supervisor": 2, "admin": 3}


class User:
    def __init__(self, row: dict):
        self.id = row["id"]
        self.email = row["email"]
        self.name = row.get("name") or row["email"]
        self.role = row.get("role") or "staff"
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
) -> User:
    email = x_forwarded_email
    if not email:
        if not _anon_allowed():
            raise HTTPException(
                status_code=401,
                detail="Not signed in. Enable Google SSO on the app's Access tab.",
            )
        email = os.getenv("DEV_USER_EMAIL", "dev@ninjavan.co")

    if not db.ready():
        raise HTTPException(status_code=503, detail="Database not configured")

    # Read the row regardless of `active`, so a deactivated account is told it
    # is deactivated rather than silently falling through to provisioning and
    # being recreated. That distinction is the whole point of the flag.
    row = await db.fetch_one(
        "SELECT id, email, name, role, default_site_id, locale, active FROM users "
        "WHERE email = %s",
        (email,),
    )
    if row and not row["active"]:
        raise HTTPException(
            status_code=403,
            detail=f"{email} has been deactivated. Ask an admin to restore access.",
        )

    if not row:
        row = await _auto_provision(email)

    if not row:
        # Known to Google, unknown to us, and not on a domain we provision for.
        raise HTTPException(
            status_code=403,
            detail=f"{email} is not registered in the WMS. Ask an admin to add you.",
        )
    return User(row)


def require(role: str):
    """Dependency factory: require at least `role`."""

    async def _dep(user: User = Depends(current_user)) -> User:
        if not user.at_least(role):
            raise HTTPException(
                status_code=403,
                detail=f"This needs the {role} role. You are {user.role}.",
            )
        return user

    return _dep


async def assert_site_access(user: User, site_id: int) -> dict:
    """Every query is site-scoped (PRD §10.2.5). Staff at UT5 cannot touch KJR."""
    site = await db.fetch_one(
        "SELECT id, code, name, site_type, is_training, active FROM sites WHERE id = %s",
        (site_id,),
    )
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    if user.at_least("admin"):
        return site

    allowed = await db.fetch_one(
        "SELECT 1 AS ok FROM user_sites WHERE user_id = %s AND site_id = %s",
        (user.id, site_id),
    )
    if not allowed:
        raise HTTPException(
            status_code=403, detail=f"You do not have access to {site['code']}."
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
        raise HTTPException(status_code=404, detail="Site not found")
    if not site["is_training"]:
        raise HTTPException(
            status_code=403,
            detail=(
                f"{site['code']} is a live site. Training actions are only "
                "permitted on a training site."
            ),
        )
    return site
