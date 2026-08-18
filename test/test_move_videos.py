import importlib.machinery
import importlib.util
import pathlib
import unittest
from unittest import mock

MOVE_VIDEOS = pathlib.Path(__file__).resolve().parent.parent / 'bin' / 'move-videos'

ROOT = pathlib.Path('/library/iTunes Music')
DEST = pathlib.Path('/share')


def load(path):
    """Import a script that has no .py suffix."""
    loader = importlib.machinery.SourceFileLoader(path.name, str(path))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


move_videos = load(MOVE_VIDEOS)


class TestDestination(unittest.TestCase):
    def destination(self, path, **tags):
        with mock.patch.object(move_videos, 'read_tags', return_value=tags):
            got = move_videos.destination(ROOT / path, ROOT, DEST)
        return str(got.relative_to(DEST))

    def test_names_a_music_video_after_its_artist_directory(self):
        self.assertEqual(
            self.destination('Röyksopp/Unknown Album/Happy Up Here.m4v'),
            'Röyksopp/Röyksopp - Happy Up Here.m4v')

    def test_drops_the_track_number_iTunes_prefixed(self):
        self.assertEqual(
            self.destination('Beck/Beck (Video Album)/01 Hell Yes.m4v'),
            'Beck/Beck - Hell Yes.m4v')

    def test_prefers_the_tags_to_the_path(self):
        self.assertEqual(
            self.destination('capsule/Unknown Album/track.m4v',
                             artist='capsule', title='Sugarless GiRL'),
            'capsule/capsule - Sugarless GiRL.m4v')

    def test_leaves_a_title_that_already_names_the_artist_alone(self):
        self.assertEqual(
            self.destination('Vitalic/Unknown Album/x.m4v',
                             title='Vitalic - My Friend Dario'),
            'Vitalic/Vitalic - My Friend Dario.m4v')

    def test_flattens_the_media_kind_directories(self):
        self.assertEqual(self.destination('Movies/Think Different.mov'),
                         'other/Think Different.mov')
        self.assertEqual(
            self.destination('Podcasts/Commencement Speakers/Larry Page.mp4'),
            'other/Larry Page.mp4')

    def test_rescues_a_music_video_the_tags_name_an_artist_for(self):
        self.assertEqual(
            self.destination('Movies/Take Me Out.mp4',
                             artist='Franz Ferdinand', title='Take Me Out'),
            'Franz Ferdinand/Franz Ferdinand - Take Me Out.mp4')

    def test_leaves_a_talk_alone_however_it_credits_its_speaker(self):
        self.assertEqual(
            self.destination('Movies/Commencement.m4v', artist='Steve Jobs',
                             title='Commencement Address', media_type='9'),
            'other/Commencement.m4v')

    def test_keeps_a_slash_in_a_tag_out_of_the_path(self):
        self.assertEqual(
            self.destination('AC_DC/Unknown Album/x.m4v',
                             artist='AC/DC', title='Back/Black'),
            'AC-DC/AC-DC - Back-Black.m4v')


if __name__ == '__main__':
    unittest.main()
