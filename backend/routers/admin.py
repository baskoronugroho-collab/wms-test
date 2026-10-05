"""Admin: staff accounts, hubs, and rack settings (PRD M7.6, §1.2 to §1.4).

This is the screen that retires the interim auto-provision rule in §5.4. Until
now, granting someone a live site meant writing a migration and deploying; that
does not survive a pilot across ten stations with staff turnover.

Who registers whom (PRD §1.2, decided 25 and 30 Sep):

  superadmin        any role, including Ops Head and superadmin
  ops_head, hq      staff, SPV and Ops HQ, at any hub
  supervisor (SPV)  staff only, and only at their own hubs; can deactivate them
  staff             nobody

The same ladder decides whose account someone may change: an Ops HQ cannot edit
an Ops Head, and an SPV sees and edits only the staff of their own hubs. Only
@ninjavan.co accounts can be registered (§1.3, §1.4.1). Hubs and rack settings
stay Ops HQ, with one deliberate exception noted on the read of sites, which
supervisors also need.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import auth
import db
import models

router = APIRouter(prefix="/api/admin", tags=["admin"])


# --- staff accounts (Pengaturan, Orang & akses; canvas 2b) -------------------------
#
# A person is added by their @ninjavan.co e-mail: no invitation and no e-mail is
# sent, they sign in straight away with Google. Hiryu first: the Hiryu login
# (MANAGER for an SPV, STAFF for staff) is made before the WMS account, and the
# WMS records that it was ("Login Hiryu sudah dibuat", required). Everyone may
# look at the list; who may change whom is the ladder above.

ROLE_TEXT = {"staff": "Staf", "hub_operator": "Operator hub", "supervisor": "SPV",
             "hq": "Ops HQ", "ops_head": "Ops Head", "superadmin": "Superadmin"}


class PersonIn(BaseModel):
    email: str = Field(description="@ninjavan.co only")
    name: str | None = None
    role: str = "staff"
    site_ids: list[int] = Field(default_factory=list, description="Hub(s)")
    hiryu_login: bool = Field(default=False, description="Login Hiryu sudah dibuat (required)")
    default_site_id: int | None = None
    locale: str = "id"


class PersonPatch(BaseModel):
    name: str | None = None
    role: str | None = None
    default_site_id: int | None = None
    locale: str | None = None
    active: bool | None = Field(default=None, description="false = tutup akun")
    site_ids: list[int] | None = None
    hiryu_login: bool | None = None


class Person(BaseModel):
    id: int
    email: str
    name: str | None
    role: str
    role_text: str
    default_site_id: int | None
    locale: str
    active: bool
    site_ids: list[int]
    site_codes: list[str]
    all_hubs: bool = Field(description="Ops HQ and above work at every hub (Semua)")
    hiryu_login: bool
    hiryu_text: str = Field(description="Ya, MANAGER | Ya, STAFF | Ya, Google | Belum | "
                                        "Tidak, dicabut")
    first_login_at: str | None = None
    never_signed_in: bool
    deactivated_at: str | None = None
    created_at: str | None = None
    can_edit: bool = Field(default=False, description="The caller may change this account")


class PersonList(BaseModel):
    users: list[Person]
    roles: list[str] = Field(description="Roles the caller may give")
    role_text: dict[str, str]
    all_roles: list[str]
    can_add: bool
    note: str


def _iso(v) -> str | None:
    return v.isoformat() + "Z" if hasattr(v, "isoformat") else (str(v) if v else None)


def _hiryu_text(role: str, active: bool, hiryu_login: bool) -> str:
    if not active:
        return "Tidak, dicabut"
    if not hiryu_login:
        return "Belum"
    if role == "supervisor":
        return "Ya, MANAGER"
    if role in ("staff", "hub_operator"):
        return "Ya, STAFF"
    return "Ya, Google"


async def _user_payload(row: dict, viewer: auth.User | None = None) -> dict:
    sites = await db.fetch_all(
        "SELECT s.id, s.code FROM user_sites us JOIN sites s ON s.id = us.site_id "
        "WHERE us.user_id = %s ORDER BY s.code",
        (row["id"],),
    )
    active = bool(row["active"])
    hiryu = bool(row.get("hiryu_login"))
    can_edit = False
    if viewer is not None:
        try:
            if row["id"] != viewer.id and viewer.real_role == viewer.role:
                await _check_manage(viewer, row)
                can_edit = True
        except HTTPException:
            can_edit = False
    return {
        "id": row["id"], "email": row["email"], "name": row["name"],
        "role": row["role"], "role_text": ROLE_TEXT.get(row["role"], row["role"]),
        "default_site_id": row["default_site_id"],
        "locale": row["locale"], "active": active,
        "site_ids": [c["id"] for c in sites],
        "site_codes": [c["code"] for c in sites],
        "all_hubs": auth.rank(row["role"]) >= auth.rank("hq"),
        "hiryu_login": hiryu, "hiryu_text": _hiryu_text(row["role"], active, hiryu),
        "first_login_at": _iso(row.get("first_login_at")),
        "never_signed_in": row.get("first_login_at") is None,
        "deactivated_at": _iso(row.get("deactivated_at")),
        "created_at": str(row["created_at"]) if row.get("created_at") else None,
        "can_edit": can_edit,
    }


def _hub_scoped(user: auth.User) -> bool:
    """An SPV works inside their own hubs; everyone from Ops HQ up sees all."""
    return not user.at_least("hq")


async def _site_ids_of(user_id: int) -> set[int]:
    rows = await db.fetch_all(
        "SELECT site_id FROM user_sites WHERE user_id = %s", (user_id,))
    return {int(r["site_id"]) for r in rows}


def _check_grant(user: auth.User, role: str) -> None:
    """Refuse a role this person may not give, with the reason in both languages."""
    if role not in auth.ROLES:
        raise HTTPException(422, f"Role must be one of {', '.join(auth.ROLES)}.")
    if role not in auth.grantable_roles(user.role):
        if role in ("ops_head", "superadmin"):
            raise HTTPException(
                403, "Hanya superadmin yang bisa memberi role Ops Head atau superadmin. / "
                     "Only a superadmin can give the Ops Head or superadmin role.")
        if user.role == "supervisor":
            raise HTTPException(
                403, "SPV hanya bisa mendaftarkan staf. / An SPV can only register staff.")
        raise HTTPException(
            403, f"Role {role} tidak bisa Anda berikan. / You cannot give the {role} role.")


async def _check_manage(user: auth.User, row: dict) -> None:
    """May this person change this account at all?

    The target's current role must be one the actor could give (so Ops HQ never
    edits an Ops Head or a superadmin), and an SPV's reach ends at their hubs.
    """
    if user.role == "superadmin":
        return
    if row["role"] not in auth.grantable_roles(user.role):
        raise HTTPException(
            403, "Akun ini di atas wewenang Anda. / This account is above what you may change.")
    if _hub_scoped(user):
        mine = await _site_ids_of(user.id)
        if not (await _site_ids_of(row["id"])) & mine:
            raise HTTPException(
                403, "Orang ini tidak bekerja di hub Anda. / This person does not work at "
                     "your hubs.")


async def _allowed_sites(user: auth.User, site_ids) -> None:
    """An SPV may only hand out their own hubs."""
    if not _hub_scoped(user) or not site_ids:
        return
    if set(site_ids) - await _site_ids_of(user.id):
        raise HTTPException(
            403, "SPV hanya bisa memberi akses ke hub sendiri. / An SPV can only give access "
                 "to their own hubs.")


_USER_COLS = ("id, email, name, role, default_site_id, locale, active, created_at, "
              "hiryu_login, first_login_at, deactivated_at")


@router.get("/users", response_model=PersonList)
async def list_users(site_id: int | None = Query(default=None, description="One hub only"),
                     user: auth.User = Depends(auth.current_user)):
    """Orang & akses: the people of the hub(s). Every role may look.

    Ops HQ and above see everyone. Below that, the people who share one of the
    caller's hubs, plus Ops HQ and above (they work at every hub). `can_edit` per
    row and `roles` (what the caller may give) follow the same ladder as the writes.
    """
    rows = await db.fetch_all(
        f"SELECT {_USER_COLS} FROM users ORDER BY active DESC, role, name, email")
    pairs = await db.fetch_all("SELECT user_id, site_id FROM user_sites")
    sites_of: dict[int, set[int]] = {}
    for p in pairs:
        sites_of.setdefault(int(p["user_id"]), set()).add(int(p["site_id"]))
    if _hub_scoped(user):
        mine = sites_of.get(user.id, set())
        rows = [r for r in rows if auth.rank(r["role"]) >= auth.rank("hq")
                or sites_of.get(int(r["id"]), set()) & mine]
    if site_id is not None:
        rows = [r for r in rows if auth.rank(r["role"]) >= auth.rank("hq")
                or site_id in sites_of.get(int(r["id"]), set())]
    return {
        "users": [await _user_payload(r, user) for r in rows],
        "roles": list(auth.grantable_roles(user.role)),
        "role_text": ROLE_TEXT,
        "all_roles": list(auth.ROLES),
        "can_add": bool(auth.grantable_roles(user.role)) and user.real_role == user.role,
        "note": ("Orang yang keluar: tutup akun WMS dan cabut login Hiryu di hari yang sama. "
                 "Pengganti ditambahkan sebagai akun baru."),
    }


async def _set_sites(user_id: int, site_ids: list[int]) -> None:
    await db.execute("DELETE FROM user_sites WHERE user_id = %s", (user_id,))
    for sid in site_ids:
        await db.execute(
            "INSERT INTO user_sites (user_id, site_id) VALUES (%s,%s) "
            "ON DUPLICATE KEY UPDATE user_sites.user_id = user_sites.user_id",
            (user_id, sid),
        )


@router.post("/users", response_model=Person, status_code=201)
async def create_user(
    body: PersonIn, user: auth.User = Depends(auth.require("supervisor"))
):
    """Tambah orang: a Ninja Van e-mail, name, role and hub(s), after the Hiryu
    login was made. No invitation and no e-mail are sent."""
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(422, "Masukkan alamat email yang benar. / Enter a valid email.")
    if not auth.email_allowed(email):
        raise HTTPException(
            422, f"Hanya akun @{auth.ALLOWED_EMAIL_DOMAIN} yang bisa didaftarkan: semua orang "
                 f"masuk dengan akun Google Ninja Van. / Only @{auth.ALLOWED_EMAIL_DOMAIN} "
                 "accounts can be registered: everyone signs in with a Ninja Van Google account.")
    _check_grant(user, body.role)
    if not body.hiryu_login:
        raise HTTPException(
            422, "Buat login Hiryu dulu (STAFF atau MANAGER), lalu centang Login Hiryu sudah "
                 "dibuat. / Make the Hiryu login first, then tick it.")

    site_ids = list(dict.fromkeys(body.site_ids or []))
    default_site_id = body.default_site_id
    if default_site_id and default_site_id not in site_ids:
        # A default site the person may not work at would strand them at sign-in.
        site_ids.append(default_site_id)
    if _hub_scoped(user):
        # Staff registered by an SPV must land on that SPV's hub, never nowhere.
        if not site_ids:
            raise HTTPException(
                422, "Pilih minimal satu hub Anda. / Choose at least one of your hubs.")
        await _allowed_sites(user, site_ids)
        default_site_id = default_site_id or site_ids[0]

    existing = await db.fetch_one("SELECT id FROM users WHERE email = %s", (email,))
    if existing:
        raise HTTPException(409, f"{email} sudah terdaftar. / {email} is already registered.")

    if auth.rank(body.role) < auth.rank("hq") and not site_ids:
        raise HTTPException(422, "Pilih hub orang ini. / Choose this person's hub.")
    await db.execute(
        "INSERT INTO users (email, name, role, default_site_id, locale, active, hiryu_login) "
        "VALUES (%s,%s,%s,%s,%s,1,1)",
        (email, (body.name or "").strip() or email.split("@")[0].replace(".", " ").title(),
         body.role, default_site_id, body.locale),
    )
    row = await db.fetch_one("SELECT * FROM users WHERE email = %s", (email,))
    if site_ids:
        await _set_sites(row["id"], site_ids)
    await db.execute(
        "INSERT INTO audit_log (actor_email, action, entity, entity_id, after_json) "
        "VALUES (%s,'user.create','users',%s,%s)",
        (user.email, row["id"], f"{email} as {body.role}"),
    )
    return await _user_payload(await db.fetch_one(
        "SELECT * FROM users WHERE id = %s", (row["id"],)), user)


@router.patch("/users/{user_id}", response_model=Person)
async def update_user(
    user_id: int,
    body: PersonPatch,
    user: auth.User = Depends(auth.require("supervisor")),
):
    """Change a role, the hubs someone works at, the Hiryu login tick, or close
    the account (active false; the Hiryu login is revoked the same day)."""
    row = await db.fetch_one("SELECT * FROM users WHERE id = %s", (user_id,))
    if not row:
        raise HTTPException(404, "User not found")

    # Nobody changes their own role (§1.4.1), and nobody locks themselves out of
    # the only screen that can grant access back. Someone else has to do it.
    if row["id"] == user.id:
        if body.active is False:
            raise HTTPException(422, "Tidak bisa menonaktifkan akun sendiri. / "
                                     "You cannot deactivate your own account.")
        if body.role and body.role != row["role"]:
            raise HTTPException(422, "Tidak bisa mengubah role akun sendiri. / "
                                     "You cannot change your own role.")
    else:
        await _check_manage(user, row)

    if body.role is not None and body.role != row["role"]:
        _check_grant(user, body.role)

    site_ids = body.site_ids
    if site_ids is not None and _hub_scoped(user):
        # An SPV edits only their own hubs on this person; access the person has
        # at other hubs is someone else's decision and stays as it is.
        await _allowed_sites(user, site_ids)
        keep = (await _site_ids_of(user_id)) - (await _site_ids_of(user.id))
        site_ids = sorted(keep | set(site_ids))
        if not site_ids:
            raise HTTPException(
                422, "Staf harus punya minimal satu hub. Nonaktifkan akunnya kalau ia berhenti. / "
                     "Staff need at least one hub. Deactivate the account if they have left.")
    if body.default_site_id is not None and _hub_scoped(user):
        await _allowed_sites(user, [body.default_site_id])

    sets, params = [], []
    for field in ("name", "role", "default_site_id", "locale"):
        val = getattr(body, field)
        if val is not None:
            sets.append(f"{field} = %s")
            params.append(val)
    if body.active is not None:
        sets.append("active = %s")
        params.append(1 if body.active else 0)
        if not body.active and row["active"]:
            sets.append("deactivated_at = NOW()")
        elif body.active and not row["active"]:
            sets.append("deactivated_at = NULL")
    if body.hiryu_login is not None:
        sets.append("hiryu_login = %s")
        params.append(1 if body.hiryu_login else 0)
    if sets:
        params.append(user_id)
        await db.execute(f"UPDATE users SET {', '.join(sets)} WHERE id = %s", params)

    if site_ids is not None:
        await _set_sites(user_id, site_ids)

    await db.execute(
        "INSERT INTO audit_log (actor_email, action, entity, entity_id, after_json) "
        "VALUES (%s,'user.update','users',%s,%s)",
        (user.email, user_id, str(body.model_dump(exclude_none=True))),
    )
    return await _user_payload(await db.fetch_one(
        "SELECT * FROM users WHERE id = %s", (user_id,)), user)


# --- hubs and rack settings -------------------------------------------------

@router.get("/sites", response_model=models.SiteAdminList)
async def list_sites(user: auth.User = Depends(auth.current_user)):
    """Hubs with their rack layout and how full each one is.

    Supervisor rather than admin: a station supervisor needs to see their own
    racks, and the payload carries no personal data beyond a headcount.
    """
    sites = await db.fetch_all(
        "SELECT id, code, name, address, site_type, is_training, active "
        "FROM sites ORDER BY is_training, code"
    )
    visible = []
    for s in sites:
        if not user.at_least("hq"):
            allowed = await db.fetch_one(
                "SELECT 1 AS ok FROM user_sites WHERE user_id = %s AND site_id = %s",
                (user.id, s["id"]),
            )
            if not allowed:
                continue

        racks = await db.fetch_all(
            "SELECT r.id, r.code, "
            "       COUNT(DISTINCT lv.id) AS levels, "
            "       COUNT(l.id) AS locations, "
            "       SUM(CASE WHEN bk.id IS NOT NULL THEN 1 ELSE 0 END) AS occupied "
            "FROM racks r "
            "LEFT JOIN levels lv ON lv.rack_id = r.id "
            "LEFT JOIN locations l ON l.level_id = lv.id "
            "LEFT JOIN baskets bk ON bk.location_id = l.id "
            "WHERE r.site_id = %s GROUP BY r.id, r.code ORDER BY r.code",
            (s["id"],),
        )
        rack_rows, total_loc, total_occ = [], 0, 0
        for r in racks:
            levels = int(r["levels"] or 0)
            locs = int(r["locations"] or 0)
            occ = int(r["occupied"] or 0)
            total_loc += locs
            total_occ += occ
            rack_rows.append({
                "rack_id": r["id"], "code": r["code"], "levels": levels,
                "positions_per_level": (locs // levels) if levels else 0,
                "locations": locs, "occupied": occ,
            })

        staff = await db.fetch_one(
            "SELECT COUNT(*) AS n FROM user_sites WHERE site_id = %s", (s["id"],)
        )
        visible.append({
            "id": s["id"], "code": s["code"], "name": s["name"],
            "address": s["address"], "site_type": s["site_type"],
            "is_training": bool(s["is_training"]), "active": bool(s["active"]),
            "racks": rack_rows, "total_locations": total_loc,
            "occupied_locations": total_occ,
            "staff_count": staff["n"] if staff else 0,
        })
    return {"sites": visible}


@router.patch("/sites/{site_id}", response_model=models.Ok)
async def update_site(
    site_id: int,
    body: models.SitePatch,
    user: auth.User = Depends(auth.require("hq")),
):
    row = await db.fetch_one("SELECT * FROM sites WHERE id = %s", (site_id,))
    if not row:
        raise HTTPException(404, "Site not found")
    if row["is_training"] and body.active is False:
        raise HTTPException(
            422, "Lokasi latihan tidak boleh dinonaktifkan — staf baru butuh ini."
        )

    sets, params = [], []
    for field in ("name", "address"):
        val = getattr(body, field)
        if val is not None:
            sets.append(f"{field} = %s")
            params.append(val)
    if body.active is not None:
        sets.append("active = %s")
        params.append(1 if body.active else 0)
    if not sets:
        return {"ok": True, "message": "Tidak ada perubahan."}
    params.append(site_id)
    await db.execute(f"UPDATE sites SET {', '.join(sets)} WHERE id = %s", params)
    await db.execute(
        "INSERT INTO audit_log (actor_email, action, entity, entity_id, after_json) "
        "VALUES (%s,'site.update','sites',%s,%s)",
        (user.email, site_id, str(body.model_dump(exclude_none=True))),
    )
    return {"ok": True, "message": f"{row['code']} diperbarui."}
