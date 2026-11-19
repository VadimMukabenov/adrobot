# Adrobot

Create Keitaro campaigns and edit offer weights with persistent drafts,
Cancel and explicit publishing. FastAPI · SQLAlchemy · React.

## Run

Requires **Git and Docker with Compose v2.20+**. Run from **any directory**:

```bash
git clone https://github.com/VadimMukabenov/adrobot ~/adrobot && ~/adrobot/start
```

First launch asks for **two real values**:

| Prompt | Exactly what to enter |
|---|---|
| Keitaro admin URL | [Open the test Keitaro](https://tlgk.host/admin/). In the terminal, **press Enter** to use `https://tlgk.host`. For another tracker, paste its full URL; `/admin/...` is removed automatically. |
| Admin API key | In Keitaro: account icon → **Account → API keys**; copy the existing key, paste it into the terminal and press Enter. **Typing stays invisible.** This is not your login password. |

[API key instructions](https://docs.keitaro.io/en/team-management/admin-api-keys.html).

Docker handles the build, migrations and startup. Settings are saved locally;
the key is not sent to the browser. You are not asked again on subsequent runs.

Open **http://127.0.0.1:8765/** when the command finishes.
To start again: `~/adrobot/start`. Drafts survive container restarts.

[Usage and troubleshooting](docs/usage.md) ·
[Development and tests](docs/development.md) ·
[Kubernetes example](docs/kubernetes.md) ·
[Verification](docs/verification.md) · [AI usage](docs/ai-usage.md)
