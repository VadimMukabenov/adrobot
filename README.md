# Adrobot

Create Keitaro campaigns and edit offer weights with persistent drafts,
Cancel and explicit publishing. FastAPI · SQLAlchemy · React.

## Run

Requires **Git and Docker with Compose v2.20+**. Run from **any directory**:

```bash
git clone https://github.com/VadimMukabenov/adrobot ~/adrobot && ~/adrobot/start
```

On first launch, enter the **Keitaro tracker address** (without `/admin`) and
**Admin API key** when asked. The key is hidden and saved locally; it is never
sent to the browser. Docker handles the build, database migrations and startup.

Open **http://127.0.0.1:8765/** when the command finishes.
To start again: `~/adrobot/start`. Drafts survive container restarts.

[Usage and troubleshooting](docs/usage.md) ·
[Development and tests](docs/development.md) ·
[Kubernetes example](docs/kubernetes.md) ·
[Verification](docs/verification.md) · [AI usage](docs/ai-usage.md)
