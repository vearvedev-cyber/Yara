"""
Zambian public holiday calendar and working-day counting.

The generated list is a starting point: holidays are stored as data (PublicHoliday),
so one-off days declared by government are added through the API/admin, and any
date here can be corrected without a deploy. Verify each year against the
official gazette.
"""

from datetime import date, timedelta


def easter_sunday(year: int) -> date:
    """Gregorian Easter (anonymous algorithm)."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month, day = divmod(h + l - 7 * m + 114, 31)
    return date(year, month, day + 1)


def _first_monday(year: int, month: int) -> date:
    d = date(year, month, 1)
    return d + timedelta(days=(0 - d.weekday()) % 7)


def zambian_public_holidays(year: int) -> list[tuple[date, str]]:
    """Holidays for one year. A fixed-date holiday on a Sunday is observed on the Monday."""
    easter = easter_sunday(year)
    heroes = _first_monday(year, 7)

    fixed = [
        (date(year, 1, 1), "New Year's Day"),
        (date(year, 3, 8), "International Women's Day"),
        (date(year, 3, 12), 'Youth Day'),
        (date(year, 4, 28), 'Kenneth Kaunda Day'),
        (date(year, 5, 1), 'Labour Day'),
        (date(year, 5, 25), 'Africa Freedom Day'),
        (date(year, 10, 18), 'National Day of Prayer'),
        (date(year, 10, 24), 'Independence Day'),
        (date(year, 12, 25), 'Christmas Day'),
    ]
    movable = [
        (easter - timedelta(days=2), 'Good Friday'),
        (easter - timedelta(days=1), 'Holy Saturday'),
        (easter + timedelta(days=1), 'Easter Monday'),
        (heroes, "Heroes' Day"),
        (heroes + timedelta(days=1), 'Unity Day'),
        (_first_monday(year, 8), "Farmers' Day"),
    ]

    result = list(movable)
    taken = {d for d, _ in movable}
    for d, name in fixed:
        result.append((d, name))
        taken.add(d)
    for d, name in fixed:
        if d.weekday() == 6:  # Sunday → observed next free day
            observed = d + timedelta(days=1)
            while observed in taken:
                observed += timedelta(days=1)
            result.append((observed, f'{name} (observed)'))
            taken.add(observed)
    return sorted(result)


def holiday_dates(workspace, start: date, end: date) -> set[date]:
    """National holidays plus the workspace's own, between start and end inclusive."""
    from django.db.models import Q
    from .models import PublicHoliday

    q = Q(workspace__isnull=True)
    if workspace is not None:
        q |= Q(workspace=workspace)
    return set(
        PublicHoliday.objects.filter(q, date__gte=start, date__lte=end).values_list('date', flat=True)
    )


def count_working_days(start: date, end: date, weekdays: set[int], holidays: set[date]) -> int:
    """Days from start to end inclusive that fall on a working weekday and aren't holidays.
    weekdays uses date.weekday() numbering: Monday=0 … Sunday=6."""
    if end < start:
        return 0
    days = 0
    current = start
    while current <= end:
        if current.weekday() in weekdays and current not in holidays:
            days += 1
        current += timedelta(days=1)
    return days
