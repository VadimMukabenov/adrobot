# Adrobot

Create Keitaro campaigns and edit offer weights with persistent drafts,
Cancel and explicit publishing. FastAPI · SQLAlchemy · React.

## Run

Requires **Git and Docker with Compose v2.24+**. Paste from **any directory**:

```bash
git clone https://github.com/VadimMukabenov/adrobot ~/adrobot && ~/adrobot/start
```

Open **http://127.0.0.1:8765/**, then connect:

1. Sign in to **[test Keitaro](https://tlgk.host/admin/)** using the account from the assignment:

   | Login | Password |
   |---|---|
   | `fortests@etolegko.com` | `T9*2jiT8zoUKEH1J7VvFqkXM` |

   > **Security note:** I understand that real project credentials must never be published or committed.
   > This shared test account is included deliberately as an assignment-only simplification for quick evaluation and onboarding.

2. In Keitaro: account icon → **Account → API keys**. Copy the existing key.
   [Where to find it](https://docs.keitaro.io/en/team-management/admin-api-keys.html).
3. Back in Adrobot, keep the prefilled **Keitaro URL**, paste the key into
   **Admin API key** and click **Connect**.

Docker handles the build, database and startup. Connection settings and drafts
survive restarts. Start again with `~/adrobot/start`.

[Usage](docs/usage.md) · [Development and tests](docs/development.md) ·
[Kubernetes](docs/kubernetes.md) · [Verification](docs/verification.md) · [AI usage](docs/ai-usage.md)
