# Adrobot

Create Keitaro campaigns and edit offer weights with persistent drafts,
Cancel and explicit publishing. FastAPI · SQLAlchemy · React.

## Start

Requires **Git and Docker with Compose v2.24+**. From any directory:

```bash
git clone https://github.com/VadimMukabenov/adrobot ~/adrobot && ~/adrobot/start
```

Open **http://127.0.0.1:8765/** and connect using the real Keitaro Admin API key
([setup below](#connect-to-real-keitaro)). Existing connection and drafts are kept.

To test the full editor with four offers, select the **HTTP Keitaro emulator**:

```bash
~/adrobot/start --emulator
```

Open **http://127.0.0.1:8767/**. No key or configuration is needed. The same
application talks over HTTP to a separate local tracker. Both databases persist
in their own volumes; real Keitaro and its connection stay separate.
**Open as visitor** lets you select a simulated country and open Google or a
sample offer using the published weights. VPN/real GeoIP is not simulated.

Add `--image` to either command to pull the published image without a local build,
for example `~/adrobot/start --emulator --image`. Repeat a command to resume that
mode; both can run together. Update an existing clone with `git -C ~/adrobot pull --ff-only`.

## Use the editor

1. Choose a campaign, or **New campaign**: selected country → Google, other visitors → an offer (destination page).
2. **Open as visitor** previews the campaign; **Copy link** lets you test real Keitaro on your phone with VPN. In the emulator, select a country in the local preview.
3. Add offers and set traffic percentages. **Pin** keeps a percentage fixed; the rest is shared equally.
4. **Publish to Keitaro** applies the draft. **Discard draft** undoes local edits; **Remove** never deletes the global offer.

**Acceptance:** creation and country routing were checked with the supplied live
account, which exposed one offer during verification. The four-offer editor cycle
is checked against the HTTP emulator; live multi-offer validation needs additional
accessible offers. [Scenarios and how to repeat them](docs/acceptance.md).

## Connect to real Keitaro

```bash
~/adrobot/start
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

To repeat first launch without `.env`, reset the saved connection and local drafts:

```bash
docker compose -f ~/adrobot/compose.yaml down --volumes && ~/adrobot/start
```

[CI](https://github.com/VadimMukabenov/adrobot/actions/workflows/ci.yml) · [Usage](docs/usage.md) · [Development and tests](docs/development.md) ·
[Kubernetes](docs/kubernetes.md) · [Verification](docs/verification.md) · [AI usage](docs/ai-usage.md)
