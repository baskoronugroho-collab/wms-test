"""Admin: staff accounts, hubs, and rack settings (PRD M7.6).

This is the screen that retires the interim auto-provision rule in §5.4. Until
now, granting someone a live site meant writing a migration and deploying; that
does not survive a pilot across ten stations with staff turnover.

Everything here is admin-only, with one deliberate exception noted on the read
of sites, which supervisors also need.
"""
from fastapi import APIRouter, Depends, HTTPException

import auth
import db
import models

router = APIRouter(prefix="/api/admin", tags=["admin"])


# --- staff accounts ---------------------------------------------------------

async def _user_payload(row: dict) -> dict:
    codes = await db.fetch_all(
        "SELECT s.code FROM user_sites us JOIN sites s ON s.id = us.site_id "
        "WHERE us.user_id = %s ORDER BY s.code",
        (row["id"],),
    )
    return {
        "id": row["id"], "email": row["email"], "name": row["name"],
        "role": row["role"], "default_site_id": row["default_site_id"],
        "locale": row["locale"], "active": bool(row["active"]),
        "site_codes": [c["code"] for c in codes],
        "created_at": str(row["created_at"]) if row.get("created_at") else None,
    }


@router.get("/users", response_model=models.AdminUserList)
async def list_users(user: auth.User = Depends(auth.require("admin"))):
    rows = await db.fetch_all(
        "SELECT id, email, name, role, default_site_id, locale, active, created_at "
        "FROM users ORDER BY active DESC, role, email"
    )
    return {
        "users": [await _user_payload(r) for r in rows],
        "roles": list(auth.ROLES),
    }


async def _set_sites(user_id: int, site_ids: list[int]) -> None:
    await db.execute("DELETE FROM user_sites WHERE user_id = %s", (user_id,))
    for sid in site_ids:
        await db.execute(
            "INSERT INTO user_sites (user_id, site_id) VALUES (%s,%s) "
            "ON DUPLICATE KEY UPDATE user_sites.user_id = user_sites.user_id",
            (user_id, sid),
        )


@router.post("/users", response_model=models.AdminUser, status_code=201)
async def create_user(
    body: models.AdminUserIn, user: auth.User = Depends(auth.require("admin"))
):
    """Register a staff email against a role and the sites they may work at."""
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(422, "Masukkan alamat email yang benar.")
    if body.role not in auth.ROLES:
        raise HTTPException(422, f"Role must be one of {', '.join(auth.ROLES)}.")

    existing = await db.fetch_one("SELECT id FROM users WHERE email = %s", (email,))
    if existing:
        raise HTTPException(409, f"{email} sudah terdaftar.")

    await db.execute(
        "INSERT INTO users (email, name, role, default_site_id, locale, active) "
        "VALUES (%s,%s,%s,%s,%s,1)",
        (email, body.name or email.split("@")[0].replace(".", " ").title(),
         body.role, body.default_site_id, body.locale),
    )
    row = await db.fetch_one("SELECT * FROM users WHERE email = %s", (email,))
    if body.site_ids:
        await _set_sites(row["id"], body.site_ids)
    await db.execute(
        "INSERT INTO audit_log (actor_email, action, entity, entity_id, after_json) "
        "VALUES (%s,'user.create','users',%s,%s)",
        (user.email, row["id"], f"{email} as {body.role}"),
    )
    return await _user_payload(await db.fetch_one(
        "SELECT * FROM users WHERE id = %s", (row["id"],)))


@router.patch("/users/{user_id}", response_model=models.AdminUser)
async def update_user(
    user_id: int,
    body: models.AdminUserPatch,
    user: auth.User = Depends(auth.require("admin")),
):
    """Change a role, the sites someone may work at, or switch them off."""
    row = await db.fetch_one("SELECT * FROM users WHERE id = %s", (user_id,))
    if not row:
        raise HTTPException(404, "User not found")

    # An admin must not be able to lock themselves out of the only screen that
    # can grant the role back. Someone else has to do it.
    if row["id"] == user.id:
        if body.active is False:
            raise HTTPException(422, "Tidak bisa menonaktifkan akun sendiri.")
        if body.role and body.role != row["role"]:
            raise HTTPException(422, "Tidak bisa mengubah role akun sendiri.")

    if body.role is not None and body.role not in auth.ROLES:
        raise HTTPException(422, f"Role must be one of {', '.join(auth.ROLES)}.")

    sets, params = [], []
    for field in ("name", "role", "default_site_id", "locale"):
        val = getattr(body, field)
        if val is not None:
            sets.append(f"{field} = %s")
            params.append(val)
    if body.active is not None:
        sets.append("active = %s")
        params.append(1 if body.active else 0)
    if sets:
        params.append(user_id)
        await db.execute(f"UPDATE users SET {', '.join(sets)} WHERE id = %s", params)

    if body.site_ids is not None:
        await _set_sites(user_id, body.site_ids)

    await db.execute(
        "INSERT INTO audit_log (actor_email, action, entity, entity_id, after_json) "
        "VALUES (%s,'user.update','users',%s,%s)",
        (user.email, user_id, str(body.model_dump(exclude_none=True))),
    )
    return await _user_payload(await db.fetch_one(
        "SELECT * FROM users WHERE id = %s", (user_id,)))


# --- hubs and rack settings -------------------------------------------------

@router.get("/sites", response_model=models.SiteAdminList)
async def list_sites(user: auth.User = Depends(auth.require("supervisor"))):
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
        if not user.at_least("admin"):
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
    user: auth.User = Depends(auth.require("admin")),
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
