import datetime
import importlib.machinery
import importlib.util
import pathlib
import re
import unittest

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


class TestCount(unittest.TestCase):
    def test_defaults_to_one_week(self):
        self.assertEqual(week.parse_count([]), 1)

    def test_reads_a_leading_dash_number(self):
        self.assertEqual(week.parse_count(['-3']), 3)

    def test_rejects_anything_else(self):
        for arg in ('-x', '3', '--weeks=3', '-', ''):
            with self.subTest(arg=arg):
                with self.assertRaises(ValueError):
                    week.parse_count([arg])


class TestWeeks(unittest.TestCase):
    def test_shows_the_week_around_today(self):
        self.assertEqual(week.weeks(TUESDAY, 1), [[date(2026, 8, 3),
                                                   date(2026, 8, 4),
                                                   date(2026, 8, 5),
                                                   date(2026, 8, 6),
                                                   date(2026, 8, 7),
                                                   date(2026, 8, 8),
                                                   date(2026, 8, 9)]])

    def test_starts_on_monday_wherever_today_falls(self):
        for day in range(3, 10):
            with self.subTest(day=day):
                self.assertEqual(week.weeks(date(2026, 8, day), 1)[0][0],
                                 date(2026, 8, 3))

    def test_puts_the_current_week_in_the_middle(self):
        for count, first in ((1, 3), (2, 27), (3, 27), (4, 20), (5, 20)):
            with self.subTest(count=count):
                grid = week.weeks(TUESDAY, count)
                self.assertEqual(len(grid), count)
                self.assertEqual(grid[0][0].day, first)
                self.assertIn(TUESDAY, grid[count // 2])

    def test_days_run_consecutively(self):
        for today, count in ((TUESDAY, 3), (date(2026, 12, 30), 2)):
            with self.subTest(today=today, count=count):
                days = [d for w in week.weeks(today, count) for d in w]
                self.assertEqual(days, [days[0] + datetime.timedelta(days=i)
                                        for i in range(7 * count)])

    def test_crosses_a_year_end(self):
        grid = week.weeks(date(2026, 12, 30), 2)
        self.assertEqual(grid[0][0], date(2026, 12, 21))
        self.assertEqual(grid[-1][-1], date(2027, 1, 3))


class TestCalendar(unittest.TestCase):
    def test_names_the_month_of_a_single_week(self):
        self.assertEqual(week.calendar(TUESDAY).split('\n')[1].split()[0], 'Aug')

    def test_names_the_month_the_range_starts_in(self):
        self.assertEqual(week.calendar(TUESDAY, 3).split('\n')[1].split()[0], 'Jul')

    def test_repeats_the_header_for_each_week(self):
        self.assertEqual(week.calendar(TUESDAY, 3).count(week.HEADER), 3)

    def test_every_line_is_the_same_width(self):
        for count in range(1, 6):
            with self.subTest(count=count):
                lines = ANSI.sub('', week.calendar(TUESDAY, count)).split('\n')
                self.assertEqual(len({len(l) for l in lines}), 1)


class TestToday(unittest.TestCase):
    def test_highlights_today(self):
        self.assertIn('\033[7m 4\033[0m', week.calendar(TUESDAY, color=True))

    def test_highlights_nothing_else(self):
        self.assertEqual(len(ANSI.findall(week.calendar(TUESDAY, 3, color=True))), 2)

    def test_stays_plain_without_color(self):
        self.assertNotIn('\033', week.calendar(TUESDAY, 3))


if __name__ == '__main__':
    unittest.main()
