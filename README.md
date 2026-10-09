# Dreamcatcher · BOM Compare

A runnable BOM review workspace for AI-1192: compare engineering, manufacturing and as-built structures, find each difference in its assembly, inspect reference assignments, and review linked change/quality records.

**Current delivery:** complete local app with six synthetic snapshots, a tested comparison engine, directory and HTTPS gateway providers, and a BigQuery/Excel handoff. Native Teamcenter, Manufacturo and BigQuery connections are **not configured**. No internal data or credentials are included. The existing Excel workbook was not supplied, so Excel parity has **not** been established.

## Run

Node.js 24+. There are no third-party runtime dependencies and no build step.

```bash
git clone https://github.com/paulmalmquist/bom_app.git
cd bom_app
npm start
```

Open **http://127.0.0.1:3000**. The initial example compares released eBOM A with aBOM SN120. Expected result: **8 changed occurrences, 4 explicitly source-explained, 6 reference assignment changes**.

```bash
npm test
npm run check
```

## Transfer to the work environment

Start with **[HANDOFF_BIGQUERY_EXCEL.md](docs/HANDOFF_BIGQUERY_EXCEL.md)**. Paste the complete prompt into your work coding agent with this checkout, the workbook, and access to your existing BigQuery environment. It instructs the agent to discover real tables, establish occurrence grain and effectivity, wire the app to governed warehouse data, and produce a row-level reconciliation against Excel. It must preserve the working app and explain any discrepancy rather than silently reproducing a workbook defect.

Further references:

- [Integration contract](docs/INTEGRATION.md): source adapter and API contracts, snapshots, source evidence, auth and hosting.
- [Excel validation protocol](docs/EXCEL_VALIDATION.md): orientation, matching keys, workbook extraction and acceptance criteria.
- [Architecture and limits](docs/ARCHITECTURE.md): matching rules and explicitly unsupported semantics.
- [Ticket acceptance matrix](docs/ACCEPTANCE.md): implemented behavior and remaining environment work.

## What works

- Any combination of eBOM, mBOM and aBOM; released and unreleased revisions; serial-specific snapshots.
- Added, removed, replaced, revised, quantity, unit, reference, description and moved occurrence detection.
- Distinct repeated occurrences, full A/B paths and selectable assembly branches.
- A separate reference-designator assignment view, preserving all repeated uses.
- Explanations counted only when source records declare every changed field; partial, unscoped, stale and wrong-serial links stay in the review queue.
- Search, change filters, unexplained differences, full JSON/CSV exports and the last eight comparisons in tab memory.
- Deterministic SHA-256 snapshot fingerprints and source capture timestamps in exported reports.
- Server-only credentials, API token protection, validated inputs, bounded gateway responses and explicit source errors.

## Data modes

Copy `.env.example` to `.env` and choose one mode:

| Mode | Behavior |
| --- | --- |
| `demo` | Default. Reads the included synthetic catalog. No source connection is implied. |
| `directory` | Reads normalized JSON snapshots from `BOM_DATA_DIR`, populated by your internal service or pipeline. Useful for controlled validation. |
| `gateway` | Reads `GET /boms` and `GET /boms/:id` from `BOM_GATEWAY_URL`. Each comparison fetches the selected snapshots automatically. The gateway can query BigQuery or access authorized source systems. |

Gateway URLs require HTTPS. `BOM_GATEWAY_TOKEN` stays on the server. There is no failure fallback to demo data. See the integration contract before connecting live data; `data/live/` is ignored by Git.

## Container

Set `BOM_APP_TOKEN` to a strong value in your environment before running beyond localhost. The browser requests this token and keeps it only in memory.

```bash
docker build -t bom-compare .
docker run --rm -p 127.0.0.1:3000:3000 -e BOM_APP_TOKEN bom-compare
```

For Dreamcatcher, put the service behind the existing authenticated HTTPS ingress. The built-in shared token is a deployment safeguard, **not** user-level authorization. Enforce application entitlement and source/row access in the ingress and gateway before using real data. Mount the app at `/` on its own internal hostname; subpath hosting needs corresponding asset/API base-path changes. The default CSP allows framing only by the same origin.

## Verification

All 49 tests pass on Node 24. See the [first red-team review](RED_TEAM_REPORT.md) and [second correctness/simplification pass](docs/SECOND_PASS_REVIEW.md). Tests cover all 36 demo pairings, 150 seeded structural cases, occurrence/evidence edge cases, HTTP/auth/export behavior, and UI state transitions. Run `npm test` and `npm run check` (includes `.js` and `.mjs`).

The second pass reduces the comparison engine's source size by about 6% and replaces whole-tree rescans with a parent queue. An 8,001-occurrence synthetic benchmark decreased from 512 ms to 321 ms median; this is not a live-source or concurrency benchmark. Live source headers now require an upstream `nodeCount`; serial-scoped evidence must match its own snapshot side.

`node scripts/browser-smoke.mjs` runs 14 checks in headless Chromium when Playwright is installed separately (not a runtime dependency). The second-pass environment lacked the Chromium executable, so browser checks could not be rerun here. Perform the human browser steps in [ACCEPTANCE.md](docs/ACCEPTANCE.md) on the target browsers before rollout. Source connectivity, Excel reconciliation, enterprise SSO and production-scale warehouse latency remain work-environment validation items.

## Repository layout

```text
src/          validated model, comparison engine, providers, HTTP service
public/       dependency-free responsive interface and shared formatting
data/demo/    explicitly synthetic snapshots only
test/         engine and API integration tests
docs/         handoff, contracts, semantics and validation
scripts/      syntax check and reproducible fixture generation
```

No source systems are mutated. This app supports engineering review; it does not approve configurations or disposition nonconformances.
