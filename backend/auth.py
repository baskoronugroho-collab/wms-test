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

    row = await db.fetch_one(
        "SELECT id, email, name, role, default_site_id, locale FROM users "
        "WHERE email = %s AND active = 1",
        (email,),
    )
    if not row:
        # Known to Google, unknown to us. An admin maps the email to a role and
        # a site before the person can do anything — we do not auto-provision.
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
