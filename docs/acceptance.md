# Assignment acceptance checklist

The assignment has two functional parts: campaign creation and the editor shown
in the supplied video. This checklist separates an isolated integration test
from evidence on the real shared Keitaro installation.

## Current evidence

- Real visitor routing: the candidate confirmed on a phone with Singapore and
  Netherlands VPN exits that the selected country opens Google and another
  country opens the offer.
- The shared live account currently exposes one offer. A separate offer creation
  attempt returned HTTP 403. Live redistribution across multiple offers remains
  unverified with this account.
- Automated editor acceptance uses **four distinct offers** behind an isolated
  HTTP tracker. It runs the real React, FastAPI, SQLAlchemy, migrations and
  persistent draft workflow. It checks remote resources and request counts;
  it does not replace production API calls with browser-only response stubs.
- No live API key, saved connection or user volume is used by these tests.

## Functional cases

Use a dedicated test campaign. Two offers suffice for a basic split; four make
it possible to repeat the complete video. Remove means removing an association
from a stream, never deleting the shared global offer.

| Case | Action | Expected result |
|---|---|---|
| Create | Choose name, country, offer, domain, group and source | Two configured streams: country to Google, default to the offer at 100% |
| Load | Open or refresh a campaign | Offer streams are editable; non-offer routing streams remain visible and unchanged |
| Search/Add | Search by name or ID and add offers | Local weights become 50/50, 34/33/33, then 25/25/25/25; remote configuration stays unchanged |
| Discard | Discard the unpublished additions | New local associations disappear; baseline weights and pins return; catalog offers remain |
| Publish | Publish an actual change | The remote stream's offer list and integer shares match the draft |
| Pin/Add | With three offers, pin one at 25%; add a fourth | The pin stays at 25%, the other three receive 25% each |
| Remove | Remove the fourth while the first is pinned at 25% | Removed row stays archived at 0%; active weights are 25/38/37; Publish removes only the remote association |
| Restore | Restore the archived row and publish | Four remote associations return at 25% each; pin remains |
| External removal | Remove an association in the tracker, then Refresh | Known missing association is archived locally and can be restored and published |
| Empty draft | Remove the only active offer | Visible explanation and disabled Publish; Restore and Discard stay available |
| Routing preservation | Edit and publish offers | No PUT to the country redirect stream; its settings stay unchanged |

The integer remainder rule is an application decision: the original video
requires correct totals and pin preservation, but does not specify a tie-break.
A few visitor clicks cannot establish an exact traffic ratio; compare the
configured remote shares first.

## Repeat automated acceptance

Install the prerequisites described in [Development](development.md), then:

```bash
(cd backend && uv sync --frozen && uv run pytest)
(cd frontend && npm ci && npx playwright install --with-deps chromium && npm run test:e2e)
```

The browser suite includes the complete four-offer cycle plus external conflicts,
lost write responses, reconciliation, persistence and creation recovery. Tests
use fresh temporary databases and loopback ports 18781/18782. To use installed
Chrome locally, set `ADROBOT_E2E_BROWSER_CHANNEL=chrome` for `npm run test:e2e`.

Passing this fixture proves the application workflow under the modeled API
contract. It does not establish full equivalence to every Keitaro version,
permission model, production response shape, GeoIP database or network condition.
