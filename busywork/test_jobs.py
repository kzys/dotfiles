import json

from jobs import Jobs


def test_detail(tmp_path):
    (tmp_path / "j1").mkdir()
    (tmp_path / "j1" / "state.json").write_text(json.dumps({
        "state": "working", "detail": "waiting on tempo"}))
    assert Jobs(str(tmp_path)).info("j1") == {"detail": "waiting on tempo"}


def test_missing_or_bad_state_is_empty(tmp_path):
    (tmp_path / "j2").mkdir()
    (tmp_path / "j2" / "state.json").write_text("{not json")
    j = Jobs(str(tmp_path))
    assert j.info("nope") == {}
    assert j.info("") == {}
    assert j.info("j2") == {}


def test_state_without_detail_is_empty(tmp_path):
    (tmp_path / "j3").mkdir()
    (tmp_path / "j3" / "state.json").write_text(json.dumps({"state": "working"}))
    assert Jobs(str(tmp_path)).info("j3") == {}
