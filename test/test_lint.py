"""Check that every tracked file we have an interpreter for at least parses.

Nothing here runs the files, and nothing outside this repository is needed
beyond the interpreters themselves.
"""

import ast
import re
import shutil
import subprocess

import pytest

EXTENSIONS = {
    'py': 'python',
    'rb': 'ruby',
    'sh': 'shell',
    'yml': 'yaml',
    'yaml': 'yaml',
}

# Only a real path, so that zshrc and its "#! sh" stay out: shellcheck has no
# zsh support.
SHELL_SHEBANG = re.compile(r'#! ?/(usr/)?bin/(env )?(ba)?sh$')

# Ruby's YAML rather than PyYAML, which would mean a pip install; ruby is here
# for the .rb files anyway.
YAML_PARSE = 'YAML.load_stream(File.read(ARGV[0]))'

RUBY = shutil.which('ruby')
SHELLCHECK = shutil.which('shellcheck')


def tracked():
    """Tracked files, minus symlinks so a linked script is checked once."""
    listing = subprocess.run(['git', 'ls-files', '-s'], check=True,
                             capture_output=True, text=True).stdout
    for line in listing.splitlines():
        mode, _, rest = line.partition(' ')
        if mode != '120000':
            yield rest.split('\t', 1)[1]


def shebang(path):
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            line = f.readline().rstrip('\n')
    except OSError:
        return ''
    return line if line.startswith('#!') else ''


def language(path):
    """Which interpreter owns a file, by extension and then by shebang."""
    extension = path.rpartition('.')[2]
    if extension in EXTENSIONS:
        return EXTENSIONS[extension]

    line = shebang(path)
    if 'python' in line:
        return 'python'
    if 'ruby' in line:
        return 'ruby'
    if SHELL_SHEBANG.match(line):
        return 'shell'
    return None


def by_language():
    files = {}
    for path in tracked():
        found = language(path)
        if found:
            files.setdefault(found, []).append(path)
    return files


FILES = by_language()

needs_ruby = pytest.mark.skipif(not RUBY, reason='ruby is not installed')


class TestSources:
    @staticmethod
    def parses(*command):
        got = subprocess.run(command, capture_output=True, text=True)
        assert got.returncode == 0, got.stdout + got.stderr

    @pytest.mark.parametrize('name', sorted(set(EXTENSIONS.values())))
    def test_finds_something_to_check(self, name):
        """A classifier that matched nothing would leave every check vacant."""
        assert FILES.get(name)

    @pytest.mark.parametrize('path', FILES.get('python', []))
    def test_python_parses(self, path):
        with open(path, encoding='utf-8') as f:
            ast.parse(f.read(), path)

    @needs_ruby
    @pytest.mark.parametrize('path', FILES.get('ruby', []))
    def test_ruby_parses(self, path):
        self.parses('ruby', '-c', path)

    @needs_ruby
    @pytest.mark.parametrize('path', FILES.get('yaml', []))
    def test_yaml_parses(self, path):
        self.parses('ruby', '-ryaml', '-e', YAML_PARSE, path)

    @pytest.mark.skipif(not SHELLCHECK, reason='shellcheck is not installed')
    def test_shell_scripts_are_clean(self):
        self.parses('shellcheck', *FILES['shell'])
