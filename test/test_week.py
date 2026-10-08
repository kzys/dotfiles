import datetime
import importlib.machinery
import importlib.util
import itertools
import pathlib
import re

import pytest

WEEK = pathlib.Path(__file__).resolve().parent.parent / 'bin' / 'week'

ANSI = re.compile(r'\033\[[0-9;]*m')


def load(path):
    """Import a script that has no .py suffix."""
    loader = importlib.machinery.SourceFileLoader(path.name, str(path))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


week = load(WEEK)

TUESDAY = datetime.date(2026, 8, 4)


def date(*args):
    return datetime.date(*args)


class TestCount:
    def test_defaults_to_one_week(self):
        assert week.parse_count([]) == 1

    def test_reads_a_leading_dash_number(self):
        assert week.parse_count(['-3']) == 3

    @pytest.mark.parametrize('arg', ['-0', '-00'])
    def test_rejects_a_count_of_zero(self, arg):
        with pytest.raises(ValueError):
            week.parse_count([arg])

    @pytest.mark.parametrize('arg', ['-x', '3', '--weeks=3', '-', ''])
    def test_rejects_anything_else(self, arg):
        with pytest.raises(ValueError):
            week.parse_count([arg])


class TestWeeks:
    def test_shows_the_week_around_today(self):
        assert week.weeks(TUESDAY, 1) == [[date(2026, 8, d) for d in range(3, 10)]]

    @pytest.mark.parametrize('day', range(3, 10))
    def test_starts_on_monday_wherever_today_falls(self, day):
        assert week.weeks(date(2026, 8, day), 1)[0][0] == date(2026, 8, 3)

    @pytest.mark.parametrize('count, first',
                             [(1, 3), (2, 27), (3, 27), (4, 20), (5, 20)])
    def test_puts_the_current_week_in_the_middle(self, count, first):
        grid = week.weeks(TUESDAY, count)
        assert len(grid) == count
        assert grid[0][0].day == first
        assert TUESDAY in grid[count // 2]

    @pytest.mark.parametrize('today, count',
                             [(TUESDAY, 3), (date(2026, 12, 30), 2)])
    def test_days_run_consecutively(self, today, count):
        days = [d for w in week.weeks(today, count) for d in w]
        assert days == [days[0] + datetime.timedelta(days=i)
                        for i in range(7 * count)]

    def test_crosses_a_year_end(self):
        grid = week.weeks(date(2026, 12, 30), 2)
        assert grid[0][0] == date(2026, 12, 21)
        assert grid[-1][-1] == date(2027, 1, 3)


class TestMonthLabels:
    def labels(self, today, count):
        return week.month_labels(week.weeks(today, count))

    def test_labels_the_month_the_grid_starts_in(self):
        assert self.labels(TUESDAY, 1) == [('08', 0)]

    def test_labels_a_new_month_where_it_starts(self):
        assert self.labels(TUESDAY, 3) == [('07', 0), ('08', 15)]

    def test_labels_a_new_year(self):
        assert self.labels(date(2026, 12, 30), 3) == [('12', 0), ('01', 35)]

    def test_labels_a_month_starting_on_a_monday_only_once(self):
        assert self.labels(date(2026, 6, 3), 1) == [('06', 0)]

    def test_labels_never_overlap(self):
        day = date(2025, 1, 1)
        while day < date(2028, 1, 1):
            for count in range(1, 6):
                labels = self.labels(day, count)
                for (text, col), (_, following) in itertools.pairwise(labels):
                    assert col + len(text) < following, f'{day} -{count}: {labels}'
            day += datetime.timedelta(days=1)


class TestCalendar:
    def test_puts_the_months_above_the_header(self):
        assert week.calendar(TUESDAY, 3).split('\n')[0] == '07             08'

    def test_repeats_the_header_for_each_week(self):
        assert week.calendar(TUESDAY, 3).count(week.HEADER) == 3

    @pytest.mark.parametrize('today',
                             [TUESDAY, date(2026, 12, 30), date(2025, 4, 9)])
    def test_starts_each_month_over_its_own_first_day(self, today):
        lines = week.calendar(today, 3).split('\n')
        for number, col in week.month_labels(week.weeks(today, 3))[1:]:
            assert lines[0][col:col + 2] == number
            assert lines[2][col:col + 2] == ' 1'

    @pytest.mark.parametrize('count', range(1, 6))
    def test_header_and_grid_are_the_same_width(self, count):
        lines = ANSI.sub('', week.calendar(TUESDAY, count)).split('\n')
        assert len(lines) == 3
        assert len(lines[1]) == len(lines[2])
        assert len(lines[0]) <= len(lines[1])


class TestToday:
    def test_highlights_today(self):
        assert '\033[7m 4\033[0m' in week.calendar(TUESDAY, color=True)

    def test_highlights_nothing_else(self):
        assert len(ANSI.findall(week.calendar(TUESDAY, 3, color=True))) == 2

    def test_stays_plain_without_color(self):
        assert '\033' not in week.calendar(TUESDAY, 3)
