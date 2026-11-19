# Modes and startup

`~/adrobot/start --demo` starts an explicitly labelled local demo at
http://127.0.0.1:8766/. It uses its own Compose project/volume and four sample
offers. Both tracker resources and application drafts survive restarts. No API
key or real Keitaro is involved; errors in live mode never switch to demo.
The launcher ignores a live `.env` and inherited connection credentials in demo.
Select demo via the launcher/process `APP_MODE=demo`, never by adding it to a
live dotenv file. The application and demo tracker need separate SQLite files.

`~/adrobot/start` keeps the live application at http://127.0.0.1:8765/ and its
existing volume/connection. Both modes can run together.

Add `--image` to pull a ready image instead of building. Image mode has its own
mode-specific volume; a first live image launch needs web connection setup.
To pin a release, set `ADROBOT_IMAGE=ghcr.io/vadimmukabenov/adrobot:sha-COMMIT_SHA`
where COMMIT_SHA is the full published Git commit. The CI run records the registry
digest. Published images support linux/amd64.

Repeat a clean demo (deletes only demo drafts/sample data):

```bash
docker compose -p adrobot-demo -f ~/adrobot/compose.demo.yaml down --volumes && ~/adrobot/start --demo
```

For image mode, reset its separate demo volume with:

```bash
APP_MODE=demo docker compose --env-file /dev/null -p adrobot-release-demo -f ~/adrobot/compose.release.yaml down --volumes
```

This is a separate volume from source-built demo. Live reset is destructive to local live drafts/connection;
make a backup before using `down --volumes`.

## Reviewer HTTP emulator

```bash
~/adrobot/start --emulator
# Or pull the published image:
~/adrobot/start --emulator --image
```

Open **http://127.0.0.1:8767/**. The emulator banner is always visible. This starts
the normal React/FastAPI/SQLAlchemy app and a separate HTTP simulator implementing
the subset of Keitaro Admin API used by this assignment. It seeds four offers and
a campaign with three offers. No live key, saved connection or `.env` is imported.
Application drafts and remote simulator resources use separate persistent Docker
volumes in the `adrobot-emulator` project. Repeating either emulator command keeps
both; returning to `~/adrobot/start` keeps the real connection at port 8765.

1. Open the seeded campaign and add the fourth sample offer: each gets 25%.
2. Set a weight, pin it, remove/restore offers, Publish and reload.
3. Use **Open as visitor**, select a country and submit. Matching country opens
   Google; other countries open distinct sample destinations sampled from the
   published weights. This choice simulates geography; VPN/IP is not inspected.
   A handful of visits cannot prove an exact statistical split.

The tracker public endpoint is **http://127.0.0.1:8768/**. Both ports are loopback
only; use this computer's browser. `ADROBOT_EMULATOR_PORT` and
`ADROBOT_EMULATOR_TRACKER_PORT` override the ports together with the generated
visitor links. To pin an image, set `ADROBOT_IMAGE` to an immutable published tag.

To delete only emulator data and start fresh:

```bash
docker compose --env-file /dev/null -p adrobot-emulator -f ~/adrobot/compose.emulator.yaml down --volumes
~/adrobot/start --emulator
```

The older `--demo` mode uses in-process sample resources at 8766; it remains
available for UI exploration. Use `--emulator` for reviewer checks through the
real HTTP integration path. Neither mode is a fallback after live errors.

# Using Adrobot

A FastAPI + SQLAlchemy + React editor for Keitaro campaigns. Create two-stream campaigns, edit offer allocations locally, and publish only when ready.

## What works

- Campaign creator with a country redirect to Google and a default offer stream; domain, campaign group and traffic source come from Keitaro.
- Offer search by ID or name. Add, remove, restore, pin/unpin, and edit a pinned integer weight.
- Persistent SQL drafts: browser/backend restarts do not publish or erase edits.
- Explicit **Publish to Keitaro** and **Discard draft**. Removed links stay in a local archive; global offers are never deleted.
- Refresh imports external changes and archives disappeared offers. It refuses to overwrite an unfinished local draft.
- Deterministic integer allocation with an exact total of 100%, optimistic local revisions, remote-change detection, and read-back verification after writes.
- Interrupted creation records its alias, operation ID and stage. Retrying the same operation reconciles existing resources instead of blindly creating another campaign.

### First use and troubleshooting

1. On first launch, open the setup page, keep the test Keitaro URL (or paste
   your full admin URL), enter the existing Admin API key and click **Connect**.
   The connection check only reads Keitaro; it does not create a campaign.
   The campaign list should load. Open **New campaign** and check that domains,
   groups, sources and offers load. Empty lists or a 401/403 mean that the key or
   its resource permissions need attention; successful local startup alone does
   not validate those permissions.
2. Use a name starting with `test_mukabenov_`, choose the country and existing
   metadata/offer, then create. This writes a real test campaign to Keitaro.
3. Open its offer stream. Add/Remove/Pin change only the local draft;
   **Publish to Keitaro** publishes and **Discard draft** discards unpublished edits.

| Symptom | What to check |
|---|---|
| `no configuration file provided` | Run `~/adrobot/start` from any directory. |
| First launch shows Connect to Keitaro | Enter the URL and Admin API key on that page; `.env` is optional. |
| `docker: command not found` / Compose unavailable | Install Docker with Compose v2.24+ first. |
| Docker daemon connection/permission error | Start Docker and use an OS account allowed to access its engine. |
| `address already in use` / port allocation error | Stop the process already listening on 8765; run only one launch option. |
| 401/403 or unavailable offers | Check the Admin API key and resource access in Keitaro. An admin login password cannot replace the key. |
| Cannot connect to Keitaro | Check the origin, network/VPN, DNS and tracker TLS certificate. Keep certificate verification enabled. |
| Changed `.env` but old settings remain | Docker: `docker compose up --wait`; manual: restart the server. |
| Backend works but no React page | Manual option: follow [local development](development.md), including the frontend build. |

The app binds to loopback. It is a local administrative tool without user
authentication; public hosting needs authentication, authorization and TLS.

## Configuration

Browser setup stores the verified connection in `/data/keitaro.json` in the
Compose volume, with owner-only file permissions (0600). It survives container
replacement; no API key is returned to the frontend or stored in browser storage.
Existing nonempty environment API keys take precedence and skip setup. This is
one local tracker connection, not a multi-user login system. Setup is available
only through localhost/loopback, including Kubernetes port-forward.

To change a browser-saved connection without deleting drafts: stop the app,
remove only `keitaro.json` in the volume, then start and reconnect:

```bash
docker compose stop app &&
docker compose run --rm --no-deps app rm -f /data/keitaro.json &&
docker compose up --wait
```

If `.env` supplies a key, change/remove that value instead and recreate the
container. Do not delete the data volume to reset connection settings.

Environment configuration remains available for automated deployments:

| Variable | Purpose |
|---|---|
| `KEITARO_BASE_URL` | Tracker origin, default `https://tlgk.host`; environment values must omit `/admin` and `/admin_api/v1`. |
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
6. **Publish to Keitaro** updates only the offer list of that stream and then reads it back. **Discard draft** restores the last confirmed snapshot, including weights and pins; new unpublished associations disappear.

If an offer is removed directly in Keitaro, Refresh archives its known local association. If an externally edited weight contradicts a local pin, Refresh accepts the remote weight and clears that pin with a message. Refresh imports actual remote weights without silently normalizing them; the next explicit edit recalculates them.

### Allocation rules

Keitaro's Admin API uses integer `share` values. The remaining weight after active pins is split evenly; leftover percentage points go to ascending offer IDs. This avoids float drift and always produces a deterministic total:

- Three free offers: **34 / 33 / 33**.
- Four free offers: **25 / 25 / 25 / 25**.
- One pinned at 25 with two free: **25 / 38 / 37**.

Archived rows are always 0 and unpinned. Invalid pin totals and duplicate associations are rejected transactionally. A local empty draft is allowed for cancellation, but publishing without active offers is rejected. A pin total of 100 allows other active offers to have 0%; that means they receive no allocated traffic. These are explicit application decisions where the demonstration left details unspecified.

## Conflicts and recovery

Each edit carries `expected_revision`; a stale browser tab gets a 409 instead of overwriting newer local work. The stream is locked during Push. Before publishing, the app compares remote offers with its last fetched fingerprint. If they differ, it preserves the draft and asks you to Cancel and Refresh.

Push rechecks the live campaign name and stream ownership before writing; a renamed campaign outside the test prefix or a moved stream keeps its draft and is not published.

Keitaro does not provide a documented atomic compare-and-swap for this operation. A remote change (including a rename or stream move) between the checks and PUT is still possible. This is optimistic conflict detection, not a distributed transaction or a guarantee against every concurrent third-party writer.

If a stream is confirmed missing in Keitaro, its local history and draft are retained, publishing is disabled, and Cancel allows the remaining campaign to be refreshed. Unavailable global offers cannot be restored.

If a write response is lost, read-back may confirm that it succeeded. Otherwise the draft stays available, or the stream enters an **uncertain** state and offers **Check publication status**. Never assume a timeout means nothing happened.

If the application process itself stopped during a write, **stop all workers**
and recover against the same database. For the recommended Docker launch:

```bash
docker compose stop app &&
docker compose run --rm --no-deps app .venv/bin/python -m adrobot.recover --worker-stopped &&
docker compose up --wait
```

This uses the existing Docker volume; no host Python/uv is needed. It marks
interrupted writes **uncertain**, without contacting Keitaro. Then use Check publication status
in the UI, or resume saved creation through **New campaign**. Recovery does not
claim a remote success. A creation whose identity/configuration cannot be
reconciled remains incomplete for manual inspection.

For a manual launch, stop Uvicorn and run from the repository root:
`(cd backend && uv run python -m adrobot.recover --worker-stopped)`, then restart.
For Kubernetes use the [offline PVC recovery job](kubernetes.md#restart-and-recovery).
Use one backend worker; never run recovery alongside a live worker.

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
