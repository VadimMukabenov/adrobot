# Verification

Checked on 17 November 2026 and rechecked on 18 November 2026. This document separates test results from assumptions. The first table describes the original 17 November run; the recheck below records current access limits.

| Area | Evidence |
|---|---|
| Backend | 55 tests passed: allocation, SQL drafts, restart, Cancel, archive/Restore, local revision conflict, remote conflict, timeout read-back, HTTP payload/header handling, creator idempotency/partial progress and offline interrupted-operation recovery. |
| Frontend | 8 behavior tests passed: archive actions, pin input, disabled mutations, uncertain-state reconciliation, non-offer stream and saved creation/422 correction, retained operation identity and local Cancel for missing streams. TypeScript and production build passed. |
| Database | Alembic initial upgrade on an empty SQLite database; model/schema check passed. |
| Live creator | Two applicant-prefixed test campaigns were created (one through the React form) and read back with the selected domain/group/source, country accept filter to Google, and one default offer at 100%. |
| Live editor | Add stayed local; Cancel restored the snapshot; Push confirmed three offers; a pinned 25% left 38%/37%; Remove/Restore and direct external removal/import were checked. The redirect stream's settings remained unchanged. |

Live verification checked management API configuration and read-back. It did not buy traffic, send real lead data, test paid conversions, or prove real-world geographic routing from multiple countries.

## Known limits

- Local administrative application, without multi-user authentication or public hosting hardening. Use loopback and one backend worker.
- Remote conflict detection is optimistic; Keitaro has no documented conditional atomic update in the used endpoint.
- Process-interrupted writes require the documented offline recovery before reconciliation.
- No automatic rollback deletes a partially created remote campaign. It stays inspectable; the application never silently removes shared resources.
- The app does not redesign arbitrary redirect/landing/filter settings of imported streams.
- Docker image built successfully from the lockfiles. A new non-root container started on a separate loopback port with an empty database, applied the initial migration, passed Alembic schema check, and served health and the React page. No API key was included in that container.

## Dependency advisory

On 17 November 2026 `npm audit` reported six high-severity entries tracing to one transitive development-tool dependency, `picomatch@4.0.7`: [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf). The current registry version was still4.0.7 and the advisory listed no patched version. The affected dependency is used by Vite/Vitest and their development glob tooling, not the React runtime bundle's application inputs. Development servers stay on loopback. `npm audit --omit=dev` reported zero vulnerabilities. No `audit fix --force`, misleading suppression or unsupported dependency replacement was used. This is a remaining upstream development-tool risk, not a claim that an application exploit was demonstrated.

## Review regressions

Read-only review found three important recovery defects before delivery. Regression tests first reproduced the failures, then verified the fixes: confirmed remote deletion no longer traps an uncertain draft; creation resume refuses changed routing; and changed dependencies cannot erase the identity of an unfinished creation. Routing mutations are tested independently. A focused follow-up review found no remaining Critical/Important issues in those paths.

## Browser checks

The production React bundle was tested in the in-app browser against the authorized test installation: creation through the form, keyboard offer selection, Add, pin-by-input, Push, Remove/Restore, Cancel and draft persistence after reload. Publication was visibly confirmed. The final page emitted no recorded console warnings or errors.

Desktop (1487×1058) and mobile (390×844) were inspected. At mobile width the editor document remained 390px wide; its 690px offer table scrolled inside a 330px container. The creation form also fit the viewport. The temporary viewport override was reset afterwards. Live screenshots are kept locally and excluded from publication.

The desktop result was visually compared with the generated concept at matching dimensions. The sidebar, metadata, stream cards, controls, light palette and table hierarchy are retained. Intentional differences include real variable-length names with ellipsis, actual row counts, a clean published state rather than the concept's draft, and functional error/reconciliation feedback. The concept is a design reference, not evidence of a running application.

## Recheck: 18 November 2026

- Backend: 55 tests passed; Ruff passed. Frontend: 8 tests passed, TypeScript and Vite production build passed.
- Empty SQLite database: Alembic upgrade, current revision and schema drift check passed. Clean Docker container: migrations, health, compiled React and non-root execution passed.
- Real Keitaro: a new `test_mukabenov_` campaign was created through React and independently read back. Domain/group/source, DE accept filter with Google URL in `action_options`, and the default offer at 100% were confirmed. Pin/Push, local Remove, rejected empty Push, draft persistence, Restore and Cancel were exercised. No JavaScript runtime errors were recorded.
- **Current access limitation:** the supplied key now lists only offer 18813; previously used additional offers return 403. The current three-offer scenario was therefore checked against a stateful fake Keitaro boundary, through the real React/FastAPI/SQLAlchemy stack. This is not a new live three-offer verification.
- Isolated browser flow: Add/Cancel, 34/33/33 allocation, pinned 25% with remaining 38%/37%, reload persistence, dirty Refresh refusal, Push/read-back, Remove/Push and Restore/Push passed. Expected 404 cache-miss and 409 dirty-refresh responses were distinguished from runtime errors.
- Playwright was used because the Browser plugin was not available. Desktop 1440×1000 and mobile 390×844 were inspected; the mobile document fits the viewport while the offer table scrolls internally.
- README configuration and Docker startup blocks were extracted and executed on a clean source copy with an empty volume. Local readiness, compiled React, repeat startup and all Docker migration commands passed. Only the host port was isolated (8767) to preserve the running user instance. Synthetic credentials tested dotenv quoting, hidden input setup, private file permissions and preservation of an existing `.env`; readiness alone does not prove a key has remote access.
- Manual README startup was also run on a clean source copy: locked dependency install, frontend production build, empty-database migration and Uvicorn startup passed on isolated port 8768. An initially cold uv cache downloaded slowly; the completed run used the ordinary warm uv cache. The user instance on 8765 was preserved.
- Fresh dependency audit: production dependencies have zero reported vulnerabilities; six high-severity development-tool entries remain under the advisory above. No forced dependency downgrade was applied.

Temporary QA scripts, synthetic fixtures, databases and screenshots are excluded from the source deliverable. No paid traffic, real lead data or advertising conversions were used in this recheck.
