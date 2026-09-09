"""Stamp a version query onto local CSS/JS references in every HTML file.

There is no build step, so assets keep stable names — `css/app.css` today is
`css/app.css` tomorrow. A browser that cached yesterday's copy will happily
render today's markup against it, which is exactly what happened on the v2
rollout: new HTML, old tokens.css, no --sidebar-w, and a sidebar that took the
whole window.

`Cache-Control: no-cache` (set in cicd/nginx.conf) fixes this going forward by
forcing revalidation, but it depends on the browser honouring headers it has
already cached, and it costs a round trip per asset per load. A version query
is stronger and cheaper: a changed URL cannot hit a stale entry at all, and
unchanged deploys still hit the cache.

Run before packaging a deploy:

    python tools/stamp_assets.py

Idempotent — an existing ?v= is replaced, not appended to.
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"

# Local assets only. A CDN or Google Fonts URL is left alone.
PATTERN = re.compile(
    r'((?:href|src)=")((?:\.\./)?(?:css|js)/[A-Za-z0-9._-]+\.(?:css|js))(\?v=[^"]*)?(")'
)


def version() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True
        ).strip()
    except Exception:
        # A version that changes per run still beats none: worst case the
        # browser refetches assets it already had.
        import time
        return str(int(time.time()))


def main() -> int:
    v = version()
    changed = 0
    files = sorted(FRONTEND.rglob("*.html"))
    for path in files:
        src = path.read_text(encoding="utf-8")
        out = PATTERN.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={v}{m.group(4)}", src)
        if out != src:
            path.write_text(out, encoding="utf-8")
            changed += 1
    print(f"stamped ?v={v} on {changed} of {len(files)} HTML files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
