# Local development

## Run without Docker

From the repository root. Requirements: **Python 3.12+, Node.js 22.12+ (Node 22 LTS
recommended), npm and [uv](https://docs.astral.sh/uv/getting-started/installation/)**.
`python3`, `node`, `npm` and `uv` must be on PATH. Internet access is needed for
the first dependency installation. Do not run this option while Docker or
another application already occupies port 8765.

Copy the entire block from the repository root. It installs the locked
dependencies, compiles React, migrates the database and starts the server:

```bash
(
  set -eu
  test -f compose.yaml
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

Wait for `Application startup complete`, then open **http://127.0.0.1:8765/**
and connect to Keitaro on the setup page. `.env` is optional.
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

See [verification](verification.md) for the exact checked scope and limitations, and [AI usage](ai-usage.md) for how agents contributed.

