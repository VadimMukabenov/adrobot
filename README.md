# Adrobot

Create Keitaro campaigns and edit offer weights with persistent drafts,
Cancel and explicit publishing. FastAPI · SQLAlchemy · React.

## Run

Requires **Git and Docker with Compose v2.24+**. Paste from **any directory**:

```bash
git clone https://github.com/VadimMukabenov/adrobot ~/adrobot && ~/adrobot/start
```

Open **http://127.0.0.1:8765/**. The setup page has two fields:

- **Keitaro URL** is already filled in: [test Keitaro](https://tlgk.host/admin/).
- **Admin API key**: in Keitaro, account icon → **Account → API keys**.
  Paste the existing key and click **Connect**. [Where to find the key](https://docs.keitaro.io/en/team-management/admin-api-keys.html).

Docker handles the build, database and startup. Connection settings and drafts
survive restarts. Start again with `~/adrobot/start`.

[Usage](docs/usage.md) · [Development and tests](docs/development.md) ·
[Kubernetes](docs/kubernetes.md) · [Verification](docs/verification.md) · [AI usage](docs/ai-usage.md)
