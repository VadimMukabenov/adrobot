"""Offline recovery for a process interrupted during a remote write.

This command never calls Keitaro and never declares a remote write successful.
"""

import argparse
import json

from sqlalchemy import select

from .db import Database
from .models import Operation, Stream, utcnow
from .settings import Settings


def recover_interrupted(db, *, confirmed_worker_stopped: bool):
    if not confirmed_worker_stopped:
        raise ValueError("Stop all Adrobot workers before recovering interrupted operations.")
    with db.session.begin() as session:
        streams = session.scalars(select(Stream).where(Stream.status == "pushing")).all()
        operations = session.scalars(select(Operation).where(Operation.status == "running")).all()
        for stream in streams:
            stream.status, stream.revision = "uncertain", stream.revision + 1
            stream.messages = ["Process interrupted. Reconcile the remote result before editing."]
        for operation in operations:
            operation.status, operation.updated_at = "uncertain", utcnow()
        return {"streams": len(streams), "operations": len(operations)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--worker-stopped",
        action="store_true",
        help="Confirm that all Adrobot workers have been stopped first.",
    )
    args = parser.parse_args()
    if not args.worker_stopped:
        parser.error("Stop all Adrobot workers, then pass --worker-stopped.")
    print(
        json.dumps(
            recover_interrupted(Database(Settings().database_url), confirmed_worker_stopped=True)
        )
    )
