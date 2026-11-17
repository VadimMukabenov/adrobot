# AI usage

Codex assisted with the requirements, backend, React components, tests, debugging and documentation. The employer's editor video was transcribed through the browser's YouTube transcript export, then converted into explicit behavior checks. A separate read-only agent checked the design; another reviewed the implementation.

Image Gen produced a visual concept using fictional data. The shipped UI uses real React components, HTML controls and CSS rather than a screenshot.

Important engineering decisions were recorded explicitly: local drafts versus published state, an archive of associations instead of deleting global offers, stable integer allocation, optimistic revisions and read-back verification after remote writes. Tests were written and observed failing before the corresponding behavior was implemented. External HTTP behavior was isolated in test fixtures; SQLite state and the application editor remained real in integration tests.

The creator/editor were also exercised against an authorized test Keitaro installation using only the applicant's prefixed test campaign. Local secrets, databases and live screenshots are excluded from the public deliverable.

AI generation is not presented as proof of correctness. Automated tests, migration checks, browser checks, live read-back and code review provide separate evidence. Candidate review and interview preparation are a separate step; the candidate should not claim to have manually authored every line or years of Python production experience based on this exercise.
