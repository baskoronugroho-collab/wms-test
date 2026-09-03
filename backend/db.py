"""Database access for the Ninja Kilat WMS.

OceanBase speaks the MySQL wire protocol, so this is asyncmy with %s
placeholders throughout. Never asyncpg, never $1.

All DDL lives in Flyway migrations under resources/db/migration/. Nothing here
creates or alters a table.
"""
import os
from contextlib import asynccontextmanager
from typing import Any, Iterable, Sequence
from urllib.parse import unquote, urlparse

import asyncmy
from asyncmy.cursors import DictCursor

_pool = None


def dsn() -> dict:
    """DATABASE_URL looks like mysql://user%40tenant:password@host:2881/dbname."""
    u = urlparse(os.environ["DATABASE_URL"])
    return {
        "host": u.hostname,
        "port": u.port or 2881,
        "user": unquote(u.username or ""),
        "password": unquote(u.password or ""),
        "db": (u.path or "/").lstrip("/"),
    }


async def connect() -> None:
    global _pool
    if os.getenv("DATABASE_URL"):
        _pool = await asyncmy.create_pool(**dsn(), autocommit=True, minsize=1, maxsize=10)


async def disconnect() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        await _pool.wait_closed()
        _pool = None


def ready() -> bool:
    return _pool is not None


@asynccontextmanager
async def cursor():
    """A read cursor on an autocommit connection."""
    async with _pool.acquire() as conn:
        async with conn.cursor(cursor=DictCursor) as cur:
            yield cur


@asynccontextmanager
async def tx():
    """A transactional cursor.

    Everything that touches inventory runs inside one of these: the balance
    update and its ledger row must land together or not at all (PRD §10.5.1).
    """
    async with _pool.acquire() as conn:
        await conn.begin()
        try:
            async with conn.cursor(cursor=DictCursor) as cur:
                yield cur
            await conn.commit()
        except Exception:
            await conn.rollback()
            raise


async def fetch_all(sql: str, params: Sequence[Any] = ()) -> list[dict]:
    async with cursor() as cur:
        await cur.execute(sql, tuple(params))
        return list(await cur.fetchall())


async def fetch_one(sql: str, params: Sequence[Any] = ()) -> dict | None:
    async with cursor() as cur:
        await cur.execute(sql, tuple(params))
        return await cur.fetchone()


async def execute(sql: str, params: Sequence[Any] = ()) -> int:
    async with cursor() as cur:
        await cur.execute(sql, tuple(params))
        return cur.lastrowid or cur.rowcount


# --- helpers used inside an open transaction -------------------------------

async def one(cur, sql: str, params: Sequence[Any] = ()) -> dict | None:
    await cur.execute(sql, tuple(params))
    return await cur.fetchone()


async def many(cur, sql: str, params: Sequence[Any] = ()) -> list[dict]:
    await cur.execute(sql, tuple(params))
    return list(await cur.fetchall())


async def run(cur, sql: str, params: Sequence[Any] = ()) -> int:
    await cur.execute(sql, tuple(params))
    return cur.lastrowid or cur.rowcount


def placeholders(items: Iterable) -> str:
    return ",".join(["%s"] * len(list(items)))
