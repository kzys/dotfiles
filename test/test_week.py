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

    def test_rejects_a_count_of_zero(self):
        for arg in ('-0', '-00'):
            with self.subTest(arg=arg):
                with self.assertRaises(ValueError):
                    week.parse_count([arg])

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


class TestMonthLabels(unittest.TestCase):
    def labels(self, today, count):
        return week.month_labels(week.weeks(today, count))

    def test_labels_the_month_the_grid_starts_in(self):
        self.assertEqual(self.labels(TUESDAY, 1), [('08', 0)])

    def test_labels_a_new_month_where_it_starts(self):
        self.assertEqual(self.labels(TUESDAY, 3), [('07', 0), ('08', 15)])

    def test_labels_a_new_year(self):
        self.assertEqual(self.labels(date(2026, 12, 30), 3), [('12', 0), ('01', 35)])

    def test_labels_a_month_starting_on_a_monday_only_once(self):
        self.assertEqual(self.labels(date(2026, 6, 3), 1), [('06', 0)])

    def test_labels_never_overlap(self):
        day = date(2025, 1, 1)
        while day < date(2028, 1, 1):
            for count in range(1, 6):
                labels = self.labels(day, count)
                for (text, col), (_, following) in zip(labels, labels[1:]):
                    self.assertLess(col + len(text), following,
                                    msg=f'{day} -{count}: {labels}')
            day += datetime.timedelta(days=1)


class TestCalendar(unittest.TestCase):
    def test_puts_the_months_above_the_header(self):
        self.assertEqual(week.calendar(TUESDAY, 3).split('\n')[0], '07             08')

    def test_repeats_the_header_for_each_week(self):
        self.assertEqual(week.calendar(TUESDAY, 3).count(week.HEADER), 3)

    def test_starts_each_month_over_its_own_first_day(self):
        for today, count in ((TUESDAY, 3), (date(2026, 12, 30), 3), (date(2025, 4, 9), 3)):
            with self.subTest(today=today):
                lines = week.calendar(today, count).split('\n')
                for number, col in self.first_of_month(today, count):
                    self.assertEqual(lines[0][col:col + 2], number)
                    self.assertEqual(lines[2][col:col + 2], ' 1')

    def first_of_month(self, today, count):
        return week.month_labels(week.weeks(today, count))[1:]

    def test_header_and_grid_are_the_same_width(self):
        for count in range(1, 6):
            with self.subTest(count=count):
                lines = ANSI.sub('', week.calendar(TUESDAY, count)).split('\n')
                self.assertEqual(len(lines), 3)
                self.assertEqual(len(lines[1]), len(lines[2]))
                self.assertLessEqual(len(lines[0]), len(lines[1]))


class TestToday(unittest.TestCase):
    def test_highlights_today(self):
        self.assertIn('\033[7m 4\033[0m', week.calendar(TUESDAY, color=True))

    def test_highlights_nothing_else(self):
        self.assertEqual(len(ANSI.findall(week.calendar(TUESDAY, 3, color=True))), 2)

    def test_stays_plain_without_color(self):
        self.assertNotIn('\033', week.calendar(TUESDAY, 3))


if __name__ == '__main__':
    unittest.main()
