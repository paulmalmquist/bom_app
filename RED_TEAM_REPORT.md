# Red-team report: Dreamcatcher BOM Compare (bom_app)

**Reviewed commit:** `de22eaa` (Build BOM comparison app with occurrence tracing and BigQuery/Excel handoff)
**Review date:** 2026-10-09
**Posture:** skeptical principal-engineer review before the app connects to Relativity's BigQuery environment. Existing tests, documentation and the (absent) Excel tool were treated as claims to verify.
**Environment:** Node 22.22.0 and Node 24.21.0 (the `engines` target), headless Chromium 141 via Playwright 1.56. Synthetic data only.
**Not available:** BigQuery, the internal gateway, real BOM data, the Excel workbook, enterprise SSO. Nothing in this report was tested against them.

## Summary

The existing 22 tests passed, and they were not evidence of correctness. Fourteen defects were confirmed, each with a regression test that fails on `de22eaa` and passes after a targeted fix. The most consequential:

- **Misleading evidence (F6, F7, F12).** One `explains` record marked every change on its occurrence as explained, removing the row from the "Needs source explanation" queue. A record present unchanged on both snapshots, or scoped to another serial, also counted. "Explained" now requires a qualifying record to declare every changed field.
- **Silent incomplete data (F5).** A snapshot truncated at subtree boundaries (a classic pagination bug) passed validation and its missing parts appeared as genuine removals. A declared `nodeCount` now proves completeness.
- **Identical inputs reported as changed (F1).** Comparing a BOM with itself reported changes whenever repeated parts lacked keys: 554 of 1,500 random self-comparisons did. Now 0 of 6,000.
- **Confident but wrong correspondence (F2, F3, F13).** Designator swaps became two "Replaced" lines; a keyed subassembly compared against its parent assembly reported a replacement and moved every child; a reused occurrence key was trusted silently.
- **Unauthorized data access (F8).** With no token (the default on loopback), any website open in the same browser could read catalog and comparison data through DNS rebinding.

Input-order invariance, A/B symmetry and occurrence coverage held before and after the fixes (property tests over 1,500 random tree pairs before and 6,000 after, plus 180 shuffled demo runs each time).

**Verdicts:** synthetic demonstration **ready**; internal pilot with real data **not ready** (no warehouse integration exists, Excel parity unverified); production engineering use **not ready**. Details at the end.

## Method

1. Read the repository, all docs (including `docs/HANDOFF_BIGQUERY_EXCEL.md`) and tests before changing anything.
2. Built adversarial fixtures for each category in the brief and ran them against the unmodified engine, recording observed output.
3. Property-tested the engine with seeded random trees and mutations (quantity, revision, part number, id, move, subtree deletion) for coverage, self-comparison, A/B symmetry and input-order invariance.
4. Ran the real app in headless Chromium against the original code (10 of 12 checks passed) and the fixed code (14 of 14).
5. Wrote a failing regression test for each confirmed defect, applied the smallest fix that made it pass, and reran the full suite on Node 22 and Node 24.

## Findings

Severity reflects the risk of a convincing but incorrect result, misleading evidence or data exposure in a real-data pilot.

| ID | Severity | Area | Finding | Status |
| --- | --- | --- | --- | --- |
| F1 | High | Matching | Identical repeated occurrences without keys reported as added/removed, including self-comparison | Fixed |
| F2 | Medium | Matching | Designator-based pairing asserts "Replaced" when part-number evidence points the other way | Fixed (flagged) |
| F3 | Medium | Matching | Root alignment overrides canonical keys when scopes differ | Fixed |
| F4 | Medium | Validation | Padded or delimited designators (`"R1 "`, `"R1,R2"`) accepted and silently treated as different designators | Fixed |
| F5 | High | Validation / integration | Truncated extraction passes validation; missing subtrees look like removals | Fixed (contract) |
| F6 | High | Evidence | One explanatory record explains every change on the occurrence | Fixed |
| F7 | High | Evidence | A record unchanged on both snapshots, or scoped to another serial, counts as explaining a new difference | Fixed |
| F8 | High | Security | DNS rebinding reads catalog/compare/export when no token is set | Fixed |
| F9 | Medium | Export | CSV cannot identify repeated occurrences, the compared snapshots or explanation status | Fixed |
| F10 | Medium | UX | A failed re-compare leaves the previous result looking current | Fixed |
| F11 | Medium | Security / UX | Gateway-controlled catalog field rendered as HTML; empty selection still sends a compare | Fixed |
| F12 | Medium | Evidence UI | Record column and metric labels overstate what is explained | Fixed |
| F13 | Medium | Matching | Reused or unstable canonical key trusted without any signal | Fixed (flagged) |
| F14 | Low | References | Revision-only change on the same occurrence labelled a designator "Reassigned" | Fixed |

Code locations below refer to the original commit `de22eaa`.

### F1 · High · Identical repeated occurrences reported as changes

- **Location:** `src/compare.js:35-61`, specifically the uniqueness requirement at line 54.
- **Reproduce:** root with three keyless `BOLT` occurrences of identical content, compared with itself.
- **Expected:** 0 changed. **Actual:** `changed: 6` (3 Removed, 3 Added, all "Unresolved correspondence"). Two identical keyless subassemblies compared with themselves: `changed: 8`. In the property run, 554 of 1,500 random self-comparisons reported changes.
- **Consequence:** the headline "Changed occurrences" count is wrong on identical inputs, and repeated fasteners (the most common BOM pattern) flood eBOM↔mBOM comparisons that lack cross-view keys with spurious lines.
- **Fix:** a third fallback pass pairs a repeated same-PN group under an aligned parent only when the entire group is the same multiset of content on both sides (attributes, records and whole subtree, excluding snapshot-local ids). Any pairing among such occurrences produces identical rows. Partial overlaps stay unresolved, so the pass never turns a leftover occurrence into a "unique" match. Pairing is ordered by content hash then id, so it is deterministic.
- **Test:** `F1` in `test/redteam.test.js`.

### F2 · Medium · Designator swap reported as two confident replacements

- **Location:** `src/compare.js:39-59` (reference pass runs first, no conflict check).
- **Reproduce:** A: `RES-10K` at R1, `RES-22K` at R2. B: `RES-10K` at R2, `RES-22K` at R1. No keys.
- **Expected:** correspondence flagged as ambiguous (a designator swap and a part swap are indistinguishable here). **Actual:** two rows `Replaced, Description` via "Reference + aligned parent", `unresolved: 0`.
- **Consequence:** a rework that swaps two components reads as two confirmed part substitutions.
- **Fix:** a designator match that changes PN is marked unresolved, with a `correspondence` note, when a same-PN sibling on either side is not already matched to its own PN. Pairing is unchanged; only the confidence label changes. A plain substitution, including one to a PN already used at a neighbouring designator, stays confident.
- **Test:** `F2`.

### F3 · Medium · Root alignment overrides canonical keys

- **Location:** `src/compare.js:29` (roots paired before canonical keys) and line 81 (`Moved` for a root mapped to a non-root).
- **Reproduce:** A is a keyed engine subassembly (`k:eng`) with two keyed children. B is a vehicle whose child is the same keyed engine.
- **Expected:** engine matched to engine, children unchanged, vehicle structure added, scope warning. **Actual:** engine "Replaced" by the vehicle, every engine child "Moved", engine "Added" in B.
- **Consequence:** comparing a subassembly against the assembly that contains it, a common review task, produces a confidently wrong change list.
- **Fix:** canonical keys are matched first; roots are aligned only if both are still unmatched. A root mapped to a non-root is a scope difference and gets a warning, not a `Moved` flag. A warning is also added when aligned roots carry different keys.
- **Test:** `F3`.

### F4 · Medium · Unnormalized designators accepted

- **Location:** `src/model.js:40-41`; fallback identity `sorted(n.refDes).join('|')` at `src/compare.js:42,47`.
- **Reproduce:** `refDes: ["R1 "]` on B versus `["R1"]` on A; or a single entry `"R1,R2"`.
- **Expected:** rejection, since these are upstream normalization defects. **Actual:** accepted. `"R1 "` produced "R1 Removed / R1 Added" reference changes. A single `"R1|R2"` entry collided with `["R1","R2"]` in the fallback key and paired a capacitor with a diode as "Replaced".
- **Fix:** each designator must be one trimmed value with no whitespace or list delimiters (`,` `;` `|`). The fallback identity is now JSON, so no delimiter collision is possible.
- **Test:** `F4`.

### F5 · High · Truncated extraction passes validation

- **Location:** `src/model.js:25-27` (no completeness check), `src/model.js:13-24` (`nodeCount` header field unvalidated).
- **Reproduce:** drop a subassembly and its children from B while keeping the parent links valid, and declare `nodeCount: 4` with 2 nodes.
- **Expected:** rejection as incomplete. **Actual:** accepted; the missing parts appear as two ordinary "Removed" lines with no warning.
- **Consequence:** a paginated or row-limited warehouse query that stops at a subtree boundary produces a valid-looking tree. This is the most likely silent failure once BigQuery is connected.
- **Fix:** optional `nodeCount` must be a nonnegative integer and, on a snapshot, must equal `nodes.length`. The gateway contract now asks for it on every snapshot. This only protects gateways that send it.
- **Test:** `F5`.

### F6 · High · One explanatory record explains every change

- **Location:** `src/compare.js:95` (`explained` = any `explains` record); `public/format.js:10` (review filter uses it).
- **Reproduce:** a keyed valve is moved, revised A→B and changed from quantity 1 to 3. One NC is attached that covers the revision only.
- **Expected:** quantity and move remain unexplained and the row stays in review. **Actual:** `explained: true`, counted in "Source explained", hidden by "Needs source explanation".
- **Consequence:** the review queue silently loses rows that still need an explanation; the headline count overstates evidence.
- **Fix:** records may declare `changes` (the change types they account for) and `serialNumber`. A row is **Explained** only when qualifying records declare every one of its change types; otherwise it is **Partially explained** (uncovered types listed), **Linked, scope not declared**, **Related records only**, or **No linked record**. Summary adds `partiallyExplained` and `linkedUnscoped`. The demo records now declare their scope, so the demo still shows 4 explained.
- **Test:** `F6`.

### F7 · High · Stale or wrong-serial records count as explanations

- **Location:** `src/compare.js:84,95`.
- **Reproduce:** (a) two historical aBOM snapshots of SN100 carry the same closed NC; B adds a quantity change. (b) an NC scoped to SN121 is attached to an SN120 occurrence that changed.
- **Expected:** neither record explains the difference. **Actual:** both rows `explained: true`.
- **Fix:** a record with the same source, id and status on both sides is pre-existing context and is shown with an exclusion reason, not counted. A record whose status changed between snapshots can still explain. A record scoped to a serial outside the comparison is excluded and a warning is raised.
- **Limit:** a record present only on baseline A can legitimately explain a difference (A may be the deviating unit), so side alone is not used. Without declared `changes`, the app cannot tell whether an A-side record is relevant; it now refuses to count it.
- **Test:** `F7`.

### F8 · High · DNS rebinding exposes API data when no token is set

- **Location:** `src/server.js:28-42` (no `Host` validation; token optional on loopback).
- **Reproduce:** `GET /api/catalog` with `Host: attacker.example` against a loopback server without `BOM_APP_TOKEN`.
- **Expected:** refusal. **Actual:** `200` with the catalog.
- **Consequence:** in directory mode with real snapshots on an engineer's machine, a malicious page in the same browser can rebind a hostname to 127.0.0.1 and read catalog, comparison and export data.
- **Fix:** without a token, API requests need a loopback `Host` or a host listed in `BOM_ALLOWED_HOSTS` (for a trusted local reverse proxy); otherwise `403`. With a token configured, the token remains the guard.
- **Test:** `F8`.

### F9 · Medium · CSV cannot be reconciled or traced

- **Location:** `public/format.js:4-5`.
- **Reproduce:** export CSV for any comparison with repeated parts.
- **Actual:** repeated identical occurrences have identical name-based paths and no ids; the file names neither the compared snapshots nor their fingerprints, and omits explanation status. The server export is always named `bom-comparison.csv`.
- **Consequence:** row-level Excel reconciliation (which the handoff requires) cannot account for every app result, and a CSV cannot be tied to the comparison it came from.
- **Fix:** appended columns: explanation status, changes without declared explanation, occurrence ids and canonical keys for A and B, baseline and comparison snapshot ids and SHA-256 fingerprints. Existing column positions are unchanged.
- **Test:** `F9`.

### F10 · Medium · Failed re-compare leaves an old result looking current

- **Location:** `public/app.js:54` (catch only sets the alert) and `public/app.js:31-34` (stale banner compares ids only).
- **Reproduce (real browser):** compare, then compare again with the same selection while the source returns 503.
- **Actual:** previous results stay visible with no stale indication; only a red alert above the selectors.
- **Fix:** a failed run sets a failure state; the banner reads "The latest comparison failed (...). Results below are from <time> and may not reflect current sources" until a run succeeds.
- **Test:** `F10` in `test/ui.test.js`; browser check "failed re-compare marks prior result as not current".

### F11 · Medium · Catalog field injection and empty compare

- **Location:** `public/app.js:29` (`nodeCount` interpolated unescaped) and `public/app.js:49` (compare sent without both ids).
- **Reproduce (real browser):** a gateway catalog whose `nodeCount` is `<a href=...>Re-enter your token</a>`.
- **Actual:** a live phishing link rendered in both source cards. The CSP blocked script execution, so impact was HTML injection, not XSS. Separately, a catalog without an aBOM made the page send `rightId: ""` on load and show "rightId must identify a catalog snapshot".
- **Fix:** `nodeCount` validated as an integer and escaped; compare does nothing until both sides have a snapshot.
- **Test:** `F11` and `F5`.

### F12 · Medium · Evidence labels overstate explanation

- **Location:** `public/app.js:62` (metric "Explicit links on changed occurrences"), `public/app.js:106` (record column), `public/app.js:117` (detail text).
- **Fix:** record column shows the explaining record id only when fully explained, otherwise "Partially explained · <types> not covered", "Linked · scope not declared", "Related record" or "Unlinked". The metric reads "Every changed field covered by a declared source record" and counts partial or unscoped links separately. Each evidence card states what the record is declared to explain or why it was not counted, and the dialog states that an explanation is not an approval.
- **Test:** `F12`.

### F13 · Medium · Reused canonical key trusted silently

- **Location:** `src/compare.js:30-34`.
- **Reproduce:** key `k7` names a valve under subassembly SA in A and a bracket under SB in B, while a new valve occupies the original spot under a different key.
- **Actual:** "Replaced, Moved, Description" via "Canonical occurrence", nothing unresolved.
- **Fix:** canonical pairing is kept (keys stay authoritative), but the row is marked unresolved with a note when the key now names a different part and an unmatched occurrence of the original part remains under the original location's counterpart.
- **Test:** `F13`.

### F14 · Low · Revision bump labelled a reassignment

- **Location:** `src/compare.js:113`.
- **Actual:** in the demo, PT-101, PT-102 and ECU-01 read "Reassigned" although each stays on the same occurrence and only its revision changed.
- **Fix:** new status **Revised** for revision-only changes on the same mapped occurrences. Total reference changes are unchanged (6 in the demo).
- **Test:** `F14`.

## Adversarial coverage

Observed behavior after the fixes. "Unsupported" means the engine reports structure honestly but does not implement the semantics; those outcomes need a business decision, not a code fix.

| Category | Result |
| --- | --- |
| Repeated PN within and across subassemblies | Never collapsed; identical groups pair; differing repeats remain unresolved (F1) |
| Missing, conflicting, unstable keys | Missing: fallback within aligned parents. Conflicting: never overridden. Reused: flagged (F13) |
| Moves, substitutions, revisions, simultaneous changes | Multiple flags per row; designator/PN conflicts flagged (F2) |
| Added/removed assemblies with descendants | Full paths retained for every descendant |
| Different roots, incompatible configurations | Root PN, configuration, serial and scope warnings (F3) |
| Serial effectivity, historical snapshots, released/unreleased | aBOM requires serial; serial-scoped records enforced (F7); unreleased warning. Effectivity resolution must happen upstream |
| Phantom assemblies and kits | Unsupported. With keys: part shown `Moved` plus kit `Added`. Without keys: unresolved Removed/Added |
| One-to-many eBOM→mBOM (qty 4 split 2+2) | Unsupported. One Removed plus two Added, all unresolved |
| Consumables | Shown as Added |
| Local vs exploded quantity | Local only. Parent 2→3 with child 4 each reports one Quantity change; exploded child total 8→12 is not reported |
| Precision, missing, zero, units | Absolute tolerance 1e-9; missing/blank/null quantity rejected; zero allowed; `1000 G` vs `1 KG` flagged Quantity and Unit, never converted |
| Designator scope, duplicates, delimiters, case | Duplicates warned; delimiters/padding rejected (F4); case-significant by design (`r1` vs `R1` is a change) |
| Cycles, orphans, multiple roots | Rejected |
| Incomplete extraction, pagination | Rejected when `nodeCount` is declared (F5); undetectable otherwise |
| Inconsistent source refresh | UI now notes when the compared snapshot's capture time or node count differs from the catalog entry selected |
| Input order | Invariant (property tests) |

## BigQuery integration

**No BigQuery integration exists in this repository.** There are no queries, table mappings, credentials or provider code to inspect, so nothing here was tested against BigQuery. The app consumes a normalized snapshot contract through `gateway` or `directory` mode. These are the concrete gaps the gateway must close, in priority order:

1. **Grain and duplicate amplification.** Joining occurrence rows to NC/ECO tables multiplies lines. If the gateway generates occurrence ids per output row, the duplicates become distinct, valid occurrences and the app cannot detect them. Aggregate records per occurrence (`ARRAY_AGG`) and assert uniqueness of the occurrence id before emitting.
2. **Completeness.** Compute `nodeCount` from the occurrence set before any join and send it on every snapshot (F5). Never rely on client-library page defaults.
3. **Arbitrary "latest".** `QUALIFY ROW_NUMBER() OVER (... ORDER BY load_ts DESC)` selects by load time, not effectivity. Resolve revision rules and serial effectivity explicitly and fail when they cannot be resolved.
4. **Snapshot consistency.** BOM and quality tables refresh independently. Publish immutable snapshot ids with a source version, or expose the consistency limit. The app cannot prove immutability; the new catalog drift note is advisory only.
5. **Explanation scope.** Map NC/ECO dispositions to `changes` and `serialNumber` (F6, F7). Without them the app counts nothing as explained, which is the intended conservative behavior.
6. **Parameterization and cost.** Allowlisted project/dataset/table identifiers in server configuration only, parameterized value filters, partition predicates, dry-run byte limits, no `SELECT *`. None of this exists yet.
7. **Authorization.** The gateway credential is a service identity. Per-user entitlements and row-level access are not implemented anywhere.
8. **Error classification.** A gateway contract violation currently returns HTTP 400 (as an invalid snapshot) rather than 502. Minor, left unchanged.

## Excel validation

**Unverified.** The workbook was not available in this review, and none was found in the repository (it is correctly excluded by `.gitignore`). No reconciliation was attempted and no parity claim is made. To support the row-level reconciliation the handoff requires, CSV exports now carry occurrence ids, keys and snapshot fingerprints (F9). Run the reconciliation inside the authorized internal environment per `docs/EXCEL_VALIDATION.md`, and expect two systematic differences that are semantics, not defects: Excel tools usually compare exploded part totals while this app compares local occurrence quantities, and the CSV prefixes `'` to any value beginning with `=`, `+`, `-` or `@`.

## User experience and security checks

Real-browser results (headless Chromium) on the original code and after fixes. Script: `scripts/browser-smoke.mjs`.

| Check | Before | After |
| --- | --- | --- |
| Initial demo result 8 changed / 4 explained / 6 reference changes | Pass | Pass |
| Keyboard opens detail, Escape closes | Pass | Pass |
| Selection change and in-flight selection change mark result stale | Pass | Pass |
| History restore: display, JSON and CSV export refer to the same run | Pass | Pass |
| Failed re-compare marks prior result not current | **Fail** | Pass |
| Source failure on load: unavailable, no results, no demo fallback | Pass | Pass |
| Gateway catalog fields cannot inject markup | **Fail** | Pass |
| Hostile source text never executes script | Pass | Pass |
| 390 px: no horizontal page overflow | Pass | Pass |
| Token required, never stored or placed in URLs | Pass | Pass |
| Explanation labels, approval disclaimer | n/a | Pass |

Also verified: API token protection on catalog/compare/export; CSV formula guarding; record URLs limited to HTTP(S) without credentials and opened with `noopener noreferrer`; 8 concurrent demo comparisons complete. The shared token is a deployment safeguard only and provides **no individual-user authorization**. Narrow layouts keep the results table in a horizontal scroll container, so the record column needs a horizontal swipe at 390 px.

## Remaining risks (not fixed)

| Risk | Impact | Owner action |
| --- | --- | --- |
| No warehouse integration | Nothing real can be compared | Build the governed serving view and gateway (see BigQuery section) |
| Excel parity unverified | No benchmark for correctness on real data | Run the reconciliation internally |
| No per-user authorization | Anyone past the ingress sees every snapshot the service identity can read | Identity propagation and source-side row access |
| Availability at contract limits | 20,000×20,000 nodes: about 3 s of blocked event loop and a 120 MB JSON report; the tab keeps up to 8 reports | Worker thread or queue, report paging, ingress concurrency limits |
| Unsupported semantics | Phantoms, kits, one-to-many, exploded quantities and unit conversion appear as structural changes | Business rules per view pairing |
| Explanation scope is self-declared | The app trusts the gateway's `changes`/`serialNumber`; configuration scope is not modelled; an Open NC with declared scope still counts | Gateway mapping review; decide whether status gates counting |
| Heuristic flags are signals, not proof | F2/F13 flag likely conflicts; keyless cross-view correspondence remains weak | Supply canonical cross-view keys |
| Fingerprints are order-sensitive | Equal content in a different array order hashes differently (documented) | Do not use fingerprints as semantic equality |
| Snapshot ids are not provably immutable | A refreshed source behind the same id changes results | Immutable ids with source versions |

## Verification evidence

| Evidence | Result |
| --- | --- |
| Finding tests on `de22eaa` (`test/redteam.test.js`, `test/ui.test.js`) | 14 of 14 finding tests fail, as does the new catalog-drift test; the invariance guard and original UI test pass |
| Full suite after fixes, Node 22.22.0 (`npm test`) | 38 of 38 pass |
| Full suite after fixes, Node 24.21.0 | 38 of 38 pass |
| `npm run check` | Pass |
| Property test, 1,500 random pairs, before | coverage 0, self-compare **554** failures, symmetry 0, order 0 |
| Property test, 6,000 random pairs, after | 0 failures in every invariant |
| Shuffled demo comparisons (36 pairs × 5) | 0 substantive differences, before and after |
| Browser smoke | 10/12 before, 14/14 after |
| 20,000 × 20,000 node comparison | 2.4 s before, 2.8 to 3.1 s after across runs (added content-signature pass) |

Commands: `npm test`, `npm run check`, `PLAYWRIGHT_MODULE=<path> node scripts/browser-smoke.mjs`.

## Changes made

- `src/compare.js`: canonical-before-root matching; identical-content group pairing; contested-designator and reused-key flags; scoped explanation model; `Revised` designator status; new warnings and summary fields; engine version 1.1.0.
- `src/model.js`: designator normalization rules; `nodeCount` validation and completeness check; optional record `changes` and `serialNumber`; record object check.
- `src/server.js`: `Host` allowlist when no token is configured (`BOM_ALLOWED_HOSTS`).
- `public/app.js`, `public/format.js`: failure-aware stale banner; empty-selection guard; escaped catalog fields; catalog drift note; explanation labels and evidence notes; extended CSV columns.
- `scripts/generate-demo.js`, `data/demo/*`: demo records declare scope; demo results unchanged.
- Tests: `test/redteam.test.js` (new), `test/ui.test.js` (harness refactor plus F10 to F12), one summary expectation in `test/compare.test.js` extended for the new fields.
- Docs: `README.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATION.md`, `docs/ACCEPTANCE.md`, `docs/HANDOFF_BIGQUERY_EXCEL.md`, `.env.example`.

No proprietary data, workbook extracts, credentials or internal warehouse details were used or added. All fixtures are synthetic.

## Readiness verdicts

**Synthetic demonstration: Ready.** Tested in a real browser on synthetic data, with honest labels for explanation, correspondence and source state. Keep the "synthetic data" banner and do not present demo counts as validation of real behavior.

**Internal pilot using real data: Not ready.** Blockers:
1. No BigQuery or gateway integration exists; nothing has run against real tables.
2. Excel reconciliation has not been executed; there is no correctness benchmark on real inputs.
3. The gateway must emit `nodeCount`, explanation `changes`/`serialNumber`, de-duplicated occurrence grain and immutable snapshot ids, or the corresponding protections are inactive.
4. Deployment must sit behind the authenticated Dreamcatcher ingress with a defined user group and `BOM_APP_TOKEN` or a host allowlist; the shared token is not user authorization.

A pilot becomes reasonable once items 1 to 4 are done and an eBOM↔eBOM reconciliation has every in-scope row accounted for.

**Production engineering use: Not ready.** In addition to the pilot blockers: per-user authorization and source row access; request isolation and concurrency limits for 20,000-node comparisons; agreed semantics for phantoms, kits, one-to-many mappings and exploded quantities per view pairing; durable comparison records; and reconciliation evidence covering serialized mBOM/aBOM cases, not just eBOM.

**What was actually tested:** the comparison engine, validation, HTTP service, UI script and real-browser behavior on synthetic data, on Node 22 and 24. **What remains unverified:** every live source, BigQuery, the Excel workbook, SSO and entitlements, production latency, and behavior on real BOM structures.
