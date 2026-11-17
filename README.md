# Adrobot

A FastAPI + SQLAlchemy + React editor for Keitaro campaigns. Create two-stream campaigns, edit offer allocations locally, and publish only when ready.

## What works

- Campaign creator with a country redirect to Google and a default offer stream; domain, campaign group and traffic source come from Keitaro.
- Offer search by ID or name. Add, remove, restore, pin/unpin, and edit a pinned integer weight.
- Persistent SQL drafts: browser/backend restarts do not publish or erase edits.
- Explicit **Push to Keitaro** and **Cancel**. Removed links stay in a local archive; global offers are never deleted.
- Refresh imports external changes and archives disappeared offers. It refuses to overwrite an unfinished local draft.
- Deterministic integer allocation with an exact total of 100%, optimistic local revisions, remote-change detection, and read-back verification after writes.
- Interrupted creation records its alias, operation ID and stage. Retrying the same operation reconciles existing resources instead of blindly creating another campaign.

## Quick start with Docker Compose

Requirements: Docker with Compose. You need a Keitaro Admin API key with access to the resources being edited.

```bash
cp .env.example .env
# Set KEITARO_BASE_URL and KEITARO_API_KEY in .env using your editor.
docker compose up --build
```

Open **http://127.0.0.1:8765**. The container applies Alembic migrations before starting. SQL data lives in the `adrobot-data` volume; restarting the container preserves it. Do not run `docker compose down -v` if you need to keep drafts and archive history.

The app intentionally binds to loopback. It is a local administrative tool, without user authentication; do not expose it publicly without adding authentication, authorization, TLS and a deployment-specific security review.

## Run without Docker

Requirements: Python 3.12+, Node.js 22.12+ and [uv](https://docs.astral.sh/uv/getting-started/installation/).

From the repository root:

```bash
cp .env.example .env
# Fill the two Keitaro settings. Keep .env out of Git.
cd frontend
npm ci
npm run build
cd ../backend
uv sync --frozen
uv run alembic upgrade head
uv run uvicorn adrobot.app:create_app --factory --host 127.0.0.1 --port 8765 --workers 1
```

Open **http://127.0.0.1:8765**. The backend serves the compiled React app on the same origin. API documentation is at **http://127.0.0.1:8765/docs**.

For UI development, keep the backend running and, from `frontend`, run `npm run dev`. Vite proxies `/api` to `127.0.0.1:8765`; no API key is sent to the browser.

## Configuration

| Variable | Purpose |
|---|---|
| `KEITARO_BASE_URL` | Tracker origin, e.g. `https://tracker.example`; omit `/admin` and `/admin_api/v1`. |
| `KEITARO_API_KEY` | Existing Admin API key; server-only, sent in the `Api-Key` header. |
| `DATABASE_URL` | Defaults to `sqlite:///./adrobot.db`, relative to the backend working directory. |
| `CAMPAIGN_PREFIX` | Defaults to `test_mukabenov_`; creator and editor writes are restricted to this prefix. |

To evaluate with a different test surname, set `CAMPAIGN_PREFIX=test_yoursurname_`. Reading another campaign is allowed; writing outside the prefix is rejected by the backend. Existing domains, groups and traffic sources are reused, never created or modified by this app.

## Migrations

Run these commands from `backend`:

```bash
uv run alembic upgrade head     # empty database -> current schema
uv run alembic current          # installed revision
uv run alembic check            # model/schema drift
```

The initial migration creates campaigns, streams, offers, unique stream-offer associations and an operation journal. Application startup does **not** call `create_all` or silently change a schema. To inspect a rollback on a disposable database: `uv run alembic downgrade base`. That rollback removes application data; it is not part of normal startup.

## Editor workflow

1. Select a campaign. The first selection fetches its streams; later openings use the persisted local state so that drafts survive.
2. **Refresh from Keitaro** explicitly imports the current published state. Streams without an offer list are displayed as non-editable; their redirects/filters are preserved.
3. Search and select an existing offer, then **Add offer**. A yellow header means unpublished changes.
4. **Remove** archives the association locally and gives it 0%. The offer remains in the global Keitaro catalogue. **Restore** brings it back into the draft.
5. **Pin** fixes the current weight. Editing a weight also pins it; **Unpin** returns it to equal sharing.
6. **Push to Keitaro** updates only the offer list of that stream and then reads it back. **Cancel** restores the last confirmed snapshot, including weights and pins; new unpublished associations disappear.

If an offer is removed directly in Keitaro, Refresh archives its known local association. If an externally edited weight contradicts a local pin, Refresh accepts the remote weight and clears that pin with a message. Refresh imports actual remote weights without silently normalizing them; the next explicit edit recalculates them.

### Allocation rules

Keitaro's Admin API uses integer `share` values. The remaining weight after active pins is split evenly; leftover percentage points go to ascending offer IDs. This avoids float drift and always produces a deterministic total:

- Three free offers: **34 / 33 / 33**.
- Four free offers: **25 / 25 / 25 / 25**.
- One pinned at 25 with two free: **25 / 38 / 37**.

Archived rows are always 0 and unpinned. Invalid pin totals and duplicate associations are rejected transactionally. A local empty draft is allowed for cancellation, but publishing without active offers is rejected. A pin total of 100 allows other active offers to have 0%; that means they receive no allocated traffic. These are explicit application decisions where the demonstration left details unspecified.

## Conflicts and recovery

Each edit carries `expected_revision`; a stale browser tab gets a 409 instead of overwriting newer local work. The stream is locked during Push. Before publishing, the app compares remote offers with its last fetched fingerprint. If they differ, it preserves the draft and asks you to Cancel and Refresh.

Keitaro does not provide a documented atomic compare-and-swap for this operation. A remote change between the comparison and PUT is still possible. This is optimistic conflict detection, not a distributed transaction or a guarantee against every concurrent third-party writer.

If a stream is confirmed missing in Keitaro, its local history and draft are retained, publishing is disabled, and Cancel allows the remaining campaign to be refreshed. Unavailable global offers cannot be restored.

If a write response is lost, read-back may confirm that it succeeded. Otherwise the draft stays available, or the stream enters an **uncertain** state and offers **Reconcile**. Never assume a timeout means nothing happened.

If the application process itself stopped during a write:

1. Stop **all** Adrobot workers.
2. From `backend`, run `uv run python -m adrobot.recover --worker-stopped`.
3. Restart the application. Reconcile uncertain streams, or resume the saved creation through **New campaign**.

Recovery only changes local running states to uncertain. It neither writes to Keitaro nor declares a remote success. Use one backend worker for this local evaluation workflow. A creation whose identity or configuration cannot be reconciled stays visibly incomplete for manual inspection.

## Checks

```bash
cd backend
uv sync --frozen
uv run pytest -q
uv run ruff check adrobot tests
uv run alembic check
cd ../frontend
npm ci
npm test
npm run build
```

See [verification](docs/verification.md) for the exact checked scope and limitations, and [AI usage](docs/ai-usage.md) for how agents contributed.

## Structure

```text
backend/adrobot/weights.py   Pure allocation rules
backend/adrobot/editor.py    Local draft/snapshot/archive state machine
backend/adrobot/creator.py   Staged campaign creation and reconciliation
backend/adrobot/keitaro.py   Server-only HTTP adapter
backend/adrobot/models.py   SQLAlchemy schema
backend/alembic/            Explicit migrations
backend/tests/              Domain, SQL and HTTP-boundary tests
frontend/src/components/    React forms, streams, offer tables and search
```

The application is a management wrapper. Visitor redirects and click/conversion analytics run inside Keitaro; this project does not implement a second tracker, collect lead contacts or submit advertising campaigns.

Official references: [Keitaro Admin API](https://admin-api.docs.keitaro.io/), [flows](https://docs.keitaro.io/en/campaigns-and-streams/streams.html).
