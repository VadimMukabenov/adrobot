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

## Start here

Use **Bash on Linux, macOS or WSL2**. Download/extract this repository, or clone it,
then open a terminal in its root: the directory containing `compose.yaml`,
`backend/` and `frontend/`. Every command block below starts from that root;
subshells keep your terminal in the same directory.

You need an existing **Keitaro Admin API key**, a reachable tracker and access to
at least one offer, domain, campaign group and traffic source. Obtain the key in
the tracker's admin interface. A login/password is not an API key.

### 1. Configure once (both launch options)

Copy this entire block into Bash. It asks for the tracker address and then the
API key; the key is hidden while typing. Paste values at the prompts, not into
this README. Existing `.env` files are preserved. To change existing settings,
edit `.env` locally and restart the app.

```bash
(
  set -eu
  test -f compose.yaml && test -f .env.example || {
    echo "Open a terminal in the Adrobot repository root first." >&2
    exit 1
  }
  if [ -f .env ]; then
    echo "Keeping existing .env. Check its Keitaro settings before starting."
  else
    read -r -p "Keitaro origin (https://tracker.example, without /admin): " tracker
    read -r -s -p "Keitaro Admin API key (hidden): " api_key
    printf '\n'
    case "$tracker" in
      https://?*|http://?*) ;;
      *) echo "An http:// or https:// tracker address is required." >&2; exit 1 ;;
    esac
    test -n "$api_key" || { echo "API key must not be empty." >&2; exit 1; }
    tracker=${tracker%/}
    case "$tracker" in
      */admin|*/admin_api/v1)
        echo "Enter the tracker origin without /admin or /admin_api/v1." >&2
        exit 1 ;;
    esac
    case "$tracker$api_key" in
      *'\'*|*'${'*)
        echo 'Backslashes and ${...} expressions are unsupported in this setup block.' >&2
        echo 'Use the literal Admin API key from Keitaro, not an escaped value.' >&2
        exit 1 ;;
    esac
    dotenv_value() {
      local value="$1"
      value=${value//\'/\\\'}
      printf "'%s'" "$value"
    }
    umask 077
    {
      printf 'KEITARO_BASE_URL='; dotenv_value "$tracker"; printf '\n'
      printf 'KEITARO_API_KEY='; dotenv_value "$api_key"; printf '\n'
      printf '%s\n' 'DATABASE_URL=sqlite:///./adrobot.db' 'CAMPAIGN_PREFIX=test_mukabenov_'
    } > .env
    echo "Created private .env. Never commit or share it."
  fi
)
```

### 2A. Recommended: Docker Compose

Prerequisite: a running Docker engine with **Compose v2** (`docker compose version`).
Host Python, Node.js and uv are **not required**. Internet access is needed on the
first build to download images and locked dependencies. Port **8765** must be free.

After step 1, copy this entire block:

```bash
(
  set -eu
  test -f compose.yaml && test -f .env
  docker compose version
  docker info > /dev/null
  docker compose up --build -d
  if ! docker compose exec -T app .venv/bin/python - <<'PYTHON'
import json
import time
from urllib.request import urlopen

for attempt in range(60):
    try:
        with urlopen("http://127.0.0.1:8765/api/health", timeout=2) as response:
            health = json.load(response)
        assert health["status"] == "ok" and health["configured"]
        print("Adrobot is ready: http://127.0.0.1:8765")
        break
    except Exception:
        if attempt == 59:
            raise SystemExit("Startup check failed; inspect the logs below.")
        time.sleep(1)
PYTHON
  then
    docker compose logs --tail=80 app
    exit 1
  fi
)
```

Open **http://127.0.0.1:8765/**. API documentation:
**http://127.0.0.1:8765/docs**. The container applies Alembic migrations before
starting. The readiness check confirms the local app and a configured key;
opening the campaign list and creation dropdowns checks actual Keitaro access.

Useful commands, also from the repository root:

```bash
docker compose logs --tail=80 app    # diagnostics
docker compose stop                # stop, preserve data
docker compose up -d               # start again
docker compose up --build -d       # rebuild after source or .env changes
```

SQL data lives in the `adrobot-data` Docker volume. **Do not run
`docker compose down -v`** if you need to keep drafts and archive history.

### 2B. Alternative: without Docker

Complete step 1 first. Requirements: **Python 3.12+, Node.js 22.12+ (Node 22 LTS
recommended), npm and [uv](https://docs.astral.sh/uv/getting-started/installation/)**.
`python3`, `node`, `npm` and `uv` must be on PATH. Internet access is needed for
the first dependency installation. Do not run this option while Docker or
another application already occupies port 8765.

Copy the entire block from the repository root. It installs the locked
dependencies, compiles React, migrates the database and starts the server:

```bash
(
  set -eu
  test -f compose.yaml && test -f .env
  python3 -c 'import sys; assert sys.version_info >= (3, 12), "Python 3.12+ required"'
  node -e 'const [a,b] = process.versions.node.split(".").map(Number); if (a < 22 || (a === 22 && b < 12)) { throw Error("Node.js 22.12+ required"); }'
  npm --version
  uv --version
  (cd frontend && npm ci && npm run build)
  cd backend
  uv sync --frozen
  uv run alembic upgrade head
  uv run uvicorn adrobot.app:create_app --factory --host 127.0.0.1 --port 8765 --workers 1
)
```

Wait for `Application startup complete`, then open **http://127.0.0.1:8765/**.
The backend serves React and the API together. Keep this terminal open; **Ctrl+C**
stops the server. Repeat the block to restart safely; migrations are repeatable.
The default local database is `backend/adrobot.db`. Docker and this option use
separate databases, so drafts do not transfer automatically between them.

For UI development, keep the backend running and open a second terminal in the
repository root:

```bash
(cd frontend && npm run dev -- --host 127.0.0.1)
```

Use the URL printed by Vite. It proxies `/api` to `127.0.0.1:8765`; the API key
stays on the backend.

### First use and troubleshooting

1. The campaign list should load. Open **New campaign** and check that domains,
   groups, sources and offers load. Empty lists or a 401/403 mean that the key or
   its resource permissions need attention; successful local startup alone does
   not validate those permissions.
2. Use a name starting with `test_mukabenov_`, choose the country and existing
   metadata/offer, then create. This writes a real test campaign to Keitaro.
3. Open its offer stream. Add/Remove/Pin change only the local draft;
   **Push to Keitaro** publishes and **Cancel** discards unpublished edits.

| Symptom | What to check |
|---|---|
| `docker: command not found` / Compose unavailable | Install Docker with Compose v2 before using option 2A. |
| Docker daemon connection/permission error | Start Docker and use an OS account allowed to access its engine. |
| `address already in use` / port allocation error | Stop the process already listening on 8765; run only one launch option. |
| 401/403 or unavailable offers | Check the Admin API key and resource access in Keitaro. An admin login password cannot replace the key. |
| Cannot connect to Keitaro | Check the origin, network/VPN, DNS and tracker TLS certificate. Keep certificate verification enabled. |
| Changed `.env` but old settings remain | Docker: `docker compose up --build -d`; manual: Ctrl+C and rerun option 2B. |
| Backend works but no React page | Manual option: run the entire 2B block, including the frontend build. |

The app binds to loopback. It is a local administrative tool without user
authentication; public hosting needs authentication, authorization and TLS.

## Configuration

| Variable | Purpose |
|---|---|
| `KEITARO_BASE_URL` | Tracker origin, e.g. `https://tracker.example`; omit `/admin` and `/admin_api/v1`. |
| `KEITARO_API_KEY` | Existing Admin API key; server-only, sent in the `Api-Key` header. |
| `DATABASE_URL` | Defaults to `sqlite:///./adrobot.db`, relative to the backend working directory. |
| `CAMPAIGN_PREFIX` | Defaults to `test_mukabenov_`; creator and editor writes are restricted to this prefix. |

To evaluate with a different test surname, set `CAMPAIGN_PREFIX=test_yoursurname_`. Reading another campaign is allowed; writing outside the prefix is rejected by the backend. Existing domains, groups and traffic sources are reused, never created or modified by this app.

## Migrations

From the repository root, for the **manual** launch:

```bash
(cd backend && uv run alembic upgrade head)
(cd backend && uv run alembic current)
(cd backend && uv run alembic check)
```

For the running **Docker** app (uses its actual volume):

```bash
docker compose exec -T app .venv/bin/alembic upgrade head
docker compose exec -T app .venv/bin/alembic current
docker compose exec -T app .venv/bin/alembic check
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

From the repository root, with the manual-launch prerequisites installed:

```bash
(
  set -eu
  (cd backend && uv sync --frozen && uv run pytest -q && uv run ruff check adrobot tests)
  (cd frontend && npm ci && npm test && npm run build)
)
```

Tests use isolated databases/fake API boundaries and do not change real Keitaro
campaigns. For a schema check, use the migration commands above against the
intended database.

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
