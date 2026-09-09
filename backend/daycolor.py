"""Day-of-week colour coding for inbound batches.

A staffer facing a basket of identical lipsticks cannot tell which arrived first.
Mode A stock is a quantity, not a set of tracked units (PRD §5.1), so the system
has no per-unit arrival date to sort by — FIFO has to be carried by something
physical. A colour keyed to the weekday of arrival does that: it is readable
across a room, needs no scanner, and costs nothing but the right sticker.

Three rules shape this module.

**Never colour alone.** The design system's own rule is that every state carries
colour *and* words (frontend/README.md), and it applies with more force here: at
least one man in twelve has a colour-vision deficiency, and the whole point of
this scheme is instant discrimination. Every payload therefore ships the day
name and the date beside the swatch, and the printed label shows all three.

**No red.** `--stop` red means failure everywhere else in this app, and a
Wednesday batch is not a failure. The palette below deliberately avoids it.

**Jakarta time, not UTC.** The pods run UTC. Jakarta is UTC+7 with no daylight
saving ever, so a fixed offset is exactly right and needs no tzdata in the
image. Without this, every receipt taken after 17:00 local would be stamped with
tomorrow's colour — the evening shift would mislabel a whole delivery.
"""
from datetime import date, datetime, timedelta, timezone

# Western Indonesia Time. Fixed offset: Indonesia has never observed DST.
WIB = timezone(timedelta(hours=7), "WIB")

# Indexed by Python's Monday=0 weekday. Hues chosen to stay separable under the
# common red-green deficiencies, and to avoid --stop red entirely.
PALETTE = [
    {"key": "mon", "hex": "#F2C300", "ink": "#17181A", "id": "Senin",  "en": "Monday"},
    {"key": "tue", "hex": "#1E8E3E", "ink": "#FFFFFF", "id": "Selasa", "en": "Tuesday"},
    {"key": "wed", "hex": "#1A73C8", "ink": "#FFFFFF", "id": "Rabu",   "en": "Wednesday"},
    {"key": "thu", "hex": "#E8710A", "ink": "#17181A", "id": "Kamis",  "en": "Thursday"},
    {"key": "fri", "hex": "#7B3FA0", "ink": "#FFFFFF", "id": "Jumat",  "en": "Friday"},
    {"key": "sat", "hex": "#D6336C", "ink": "#FFFFFF", "id": "Sabtu",  "en": "Saturday"},
    {"key": "sun", "hex": "#5E6064", "ink": "#FFFFFF", "id": "Minggu", "en": "Sunday"},
]


def local_now() -> datetime:
    return datetime.now(WIB)


def local_date(when: datetime | None = None) -> date:
    """The Jakarta calendar date for a moment, whatever timezone it arrived in.

    A naive datetime out of the database is treated as UTC, which is what the
    pods write.
    """
    if when is None:
        return local_now().date()
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return when.astimezone(WIB).date()


def for_date(day: date) -> dict:
    """The colour for a calendar date, with everything a label needs printed on it."""
    entry = PALETTE[day.weekday()]
    return {
        "key": entry["key"],
        "hex": entry["hex"],
        "ink": entry["ink"],
        "day_id": entry["id"],
        "day_en": entry["en"],
        "date": day.isoformat(),
        # Week number is what stops a 7-colour cycle from lying. Stock is held
        # ~14 days (HANDOFF §11), so a fortnight-old batch wears the same colour
        # as today's. The ISO week disambiguates it, and its parity is what a
        # staffer can actually read at a glance.
        "iso_week": day.isocalendar().week,
        "week_parity": "A" if day.isocalendar().week % 2 == 0 else "B",
    }


def for_moment(when: datetime | None = None) -> dict:
    return for_date(local_date(when))


def legend() -> list[dict]:
    """The whole week, for a wall chart and the label screen."""
    # Anchor on the Monday of the current Jakarta week so each entry carries a
    # real date rather than a bare weekday name.
    today = local_date()
    monday = today - timedelta(days=today.weekday())
    return [for_date(monday + timedelta(days=i)) for i in range(7)]
