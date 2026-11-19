"""Immediate, read-only progress observation around the existing creation transaction."""

import json
from concurrent.futures import ThreadPoolExecutor
from time import monotonic, sleep

from .errors import AppError


class CreationProgress:
    def __init__(self, creator):
        self.creator = creator
        self.pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="creation")

    @staticmethod
    def event(kind, **body):
        return json.dumps({"type": kind, **body}) + "\n"

    def events(self, request):
        operation = dict(
            operation_id=request.operation_id, status="running", phase="validating_settings"
        )
        # Flush useful feedback before even starting a potentially slow tracker call.
        yield self.event("progress", operation=operation)
        future = self.pool.submit(self.creator.create, request)
        deadline = monotonic() + 120
        previous = None
        while not future.done() and monotonic() < deadline:
            try:
                operation = self.creator.operation(request.operation_id)
            except AppError as error:
                if error.status != 404:
                    raise
            if operation != previous:
                yield self.event("progress", operation=operation)
                previous = operation
            sleep(0.2)
        if not future.done():
            yield self.event("result", operation={
                **operation,
                "message": "Keitaro is still processing this creation. The request is kept "
                "in your browser; check this same operation before retrying.",
            })
            return
        try:
            operation = future.result()
            # A duplicate request can attach to an already-running operation. Observe
            # its saved progress, never issue another remote write from this observer.
            while operation["status"] == "running" and monotonic() < deadline:
                yield self.event("progress", operation=operation)
                sleep(0.2)
                operation = self.creator.operation(request.operation_id)
            yield self.event("result", operation=operation)
        except AppError as error:
            yield self.event("error", status=error.status, detail=error.message)
        except Exception:
            # Never expose upstream exception text, bodies or credentials.
            yield self.event(
                "error", status=502,
                detail="Creation connection interrupted. The same operation is saved; "
                "check its status before retrying.",
            )

    def close(self):
        # Closing the browser does not cancel a possible remote write. Application
        # shutdown waits for workers before their shared HTTP connection pool closes.
        self.pool.shutdown(wait=True)
