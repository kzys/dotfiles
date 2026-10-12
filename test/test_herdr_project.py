import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from herdr_project.match import clip, columns, spans, visible
from herdr_project.screen import preview


def test_filters_sessions_by_project():
    rows = [
        ('new', '', '', '+ new project'),
        ('project', '/foo', '', '20261011-a  Foo work'),
        ('session', '/foo', '1', '    10-11 17:00  Bar fix'),
        ('session', '/foo', '2', '    10-11 16:00  Baz fix'),
        ('project', '/qux', '', '20261010-b  Qux work'),
        ('session', '/qux', '3', '    10-10 17:00  Bar fix'),
    ]
    assert visible(rows, '') == list(range(6))
    assert visible(rows, 'foo') == [1, 2, 3]
    assert visible(rows, 'foo bar') == [1, 2]
    assert visible(rows, 'bar') == [1, 2, 4, 5]
    assert visible(rows, 'Bar') == [1, 2, 4, 5]
    assert visible(rows, 'BAR') == []
    assert spans(['work', 'x'], 'Foo work') == [(4, 8)]
    assert spans(['foo'], 'İx foo') == [(3, 6)]


def test_clips_wide_text():
    assert columns('a税b') == 4
    assert clip('a税b', 2) == 'a'
    assert clip('a税b', 3) == 'a税'


def test_previews_notes(tmp_path):
    (tmp_path / 'README.md').write_text('readme\n')
    (tmp_path / 'AGENT-b.md').write_text('b\n')
    (tmp_path / 'AGENT-a.md').write_text('a\n')
    assert preview(str(tmp_path)) == 'readme\na\nb\n'
    assert preview('') == ''
