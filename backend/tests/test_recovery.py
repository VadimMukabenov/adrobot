import pytest

from adrobot.models import Operation, Stream
from adrobot.recover import recover_interrupted


def test_recovery_requires_stopped_worker_and_only_unlocks_interrupted_operations(setup):
    _, _, _, db = setup
    with db.session.begin() as session:
        stream = session.get(Stream, 11)
        stream.status, stream.dirty = "pushing", True
        session.add(Operation(id="interrupted-create", kind="create", status="running"))
        session.add(Operation(id="already-done", kind="push", status="confirmed"))
    with pytest.raises(ValueError):
        recover_interrupted(db, confirmed_worker_stopped=False)
    result = recover_interrupted(db, confirmed_worker_stopped=True)
    assert result == {"streams": 1, "operations": 1}
    with db.session() as session:
        assert session.get(Stream, 11).status == "uncertain"
        assert session.get(Stream, 11).dirty is True
        assert session.get(Operation, "interrupted-create").status == "uncertain"
        assert session.get(Operation, "already-done").status == "confirmed"
