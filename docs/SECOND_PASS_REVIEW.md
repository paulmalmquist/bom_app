# Second pass: correctness with less matching machinery

Reviewed Claude's `a11de18` fixes against the original `de22eaa` build. Kept those protections and public API endpoints. No live data, new packages, frameworks or services were added.

## Confirmed gaps

Each T1–T10 regression failed on `a11de18` before the corresponding fix.

| Test | Blind spot | Correction |
| --- | --- | --- |
| T1 | Identical keyless assemblies were paired by local ID even when keyed descendants established the opposite correspondence; two false moves resulted. | Shared descendant keys constrain lazy subtree signatures. |
| T2 | Repeated reference assignments compared aggregate PN/revision sets; swapping parts or revisions between mapped occurrences appeared unchanged. `@` could also collide inside concatenated keys. | Compare each mapped assignment; use JSON tuples for unmatched sets. |
| T3 | An NC on side B could qualify by naming side A's serial. | A declared serial must match the snapshot carrying that record. |
| T4 | Uncertain parents yielded confident heuristic child matches. Fully declared evidence could remove uncertain rows from review. | Propagate parent uncertainty to dependent heuristic matches; never mark uncertain correspondence explained; retain field-identical uncertain rows in review. |
| T5 | Duplicate source/record identities allowed order-dependent evidence state. | Reject duplicates per occurrence and require upstream consolidation. |
| T6 | Omitting `nodeCount` disabled the new completeness check for real data. | Require a bounded count on live headers and snapshots; retain omission only for synthetic fixtures. |
| T7 | Comparing one mutable snapshot ID with itself fetched it twice and could report differences. | Share one source read for both sides. |
| T8 | A failed catalog refresh disabled Compare, but changing a selector re-enabled it against stale catalog state. | Track catalog readiness and preserve the failure/stale state. |
| T9 | Catalog drift checked only time/count, missing changed serial, revision and configuration; warnings existed only in the view. | Compare relevant header fields against the selection captured at request start; freeze notes in the report for history and JSON export. |
| T10 | Distinct snapshots with equal display metadata had indistinguishable option labels. | Include snapshot ID in each option label. |

## Simplification

- Replaced repeated full-tree grouping passes with a queue that visits each aligned parent once.
- Reused child indexes, hashed subtrees only when needed for repeated candidates, and indexed competing parts instead of repeated sibling scans.
- Replaced quadratic reference membership checks with occurrence-ID maps.
- Consolidated contested/reused/inherited correspondence reasons into one map.
- Centralized catalog-drift comparison so stale-state and captured-report logic agree.
- Extended the existing syntax check to `.mjs`; retained the existing test tools and runtime stack.

`src/compare.js` shrank from 16,652 bytes to approximately 15.7 KB (about 6%). This is a reduction in matching machinery, not minification. Regression coverage grew; total repository size is not claimed to shrink.

## Verification

- **49 automated tests pass** on Node 24.19.0, including the original 38.
- New seeded invariant test: 150 pairs of 45-node trees, five mutations per pair, checking self-comparison, direction symmetry, input order and full occurrence coverage.
- JavaScript/module syntax checks and `git diff --check` pass.
- Synthetic performance case: one root, 100 keyless chains of depth 80, 8,001 total occurrences per side, identical inputs. Three runs per version with explicit GC before each run. Original: 493/512/574 ms (median 512). Revised: 285/321/322 ms (median 321), about 37% less time. Report size remained 27,525,547 bytes. This measures engine execution, not serialization/network time, live-source latency or concurrency.
- Attempted the existing browser smoke script; launch failed because the installed Playwright package has no Chromium executable in this environment. No browser success is claimed for this pass. The earlier review's browser results remain historical evidence only.

## Remaining limits

The full report still repeats paths and lives in memory; the benchmark's 27.5 MB report illustrates why engine speed alone does not solve large-tree serving or tab-memory limits. Different IDs are still separate source reads, so the gateway must publish coherent immutable snapshots. A declared count is only as reliable as its upstream derivation. Field-scoped evidence is a source claim, not proof of the exact transition, configuration applicability, or approval. These need internal mapping and policy validation.

BigQuery discovery/integration, actual Excel parity, enterprise authorization and source semantics remain unverified. No production readiness claim follows from these synthetic tests. Repeat browser checks and the work-environment handoff before a real-data pilot.
