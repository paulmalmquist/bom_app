# Work-environment handoff: BigQuery discovery + Excel reconciliation

Paste the following prompt into your work coding agent with the `bom_app` checkout and the existing BOM comparison workbook. Supply any already-known project/dataset names; the agent must discover and verify the rest. If the workbook is unavailable, complete the source/app work and clearly record Excel validation as blocked.

---

You are implementing the internal data integration for Dreamcatcher BOM Compare, ticket AI-1192, in this existing repository. Inspect the app, tests, README and `docs/` before changing it. Preserve the working interface and occurrence-aware comparison engine. Finish the integration, tests, and reconciliation; do not stop at a proposal.

**Objective:** find the authoritative BOM data in our BigQuery environment, connect the app to it, and compare the app's output with the results in the supplied Excel BOM comparison tool. The app must show where differences occur, not just a flattened list of different part numbers.

## 1. Discover the actual warehouse model

- Use the available work-environment credentials and approved projects. Inventory accessible datasets and their locations, table/view descriptions, columns, partitioning, row counts and freshness. Use existing catalogs, dbt manifests, OpenMetadata and scoped `INFORMATION_SCHEMA` queries where available. Do not invent table names or query every project indiscriminately.
- Search metadata for BOM, bill of materials, assembly, component, occurrence, parent-child, Teamcenter, Manufacturo, part/item, revision, release, serial, configuration, effectivity, ref des, reference designator, nonconformance/NC/NCR, disposition and engineering change/ECO. Include naming variants and source-system identifiers.
- Resolve curated tables/views first. If the needed semantics only exist in staging or integration tables, document that gap and propose a governed serving view. Do not silently bind this app to an unstable staging contract. Avoid `SELECT *`, including CTEs.
- Profile promising candidates with narrow, bounded queries. Establish grain, duplicate behavior, natural/surrogate keys, joins and cardinalities. Preserve string part numbers and serials with leading zeros. Identify repeated uses of the same part and distinguish node/occurrence identity from part identity.
- Identify how each source resolves eBOM, mBOM and aBOM; released versus unreleased revisions; root assembly; revision/configuration rules; exact serialized units; effective dates; and historical snapshots. Inspect source lineage and refresh latency. A loaded row's timestamp is not automatically the source's effective timestamp.
- Discover the actual quality/change tables and supported relationship from an occurrence and serial to the NC, disposition or change record that explains a difference. A nearby NC, matching part number or temporal coincidence is insufficient to assert causation.
- Write `docs/DATA_DISCOVERY.md` with the exact fully qualified tables, relevant columns, validated joins, grain, sampled evidence, freshness and remaining gaps. Keep internal discoveries in the internal checkout; this origin repository is public.

## 2. Implement the warehouse adapter

- Document the mapping in `docs/BIGQUERY_MAPPING.md`. Map the discovered fields into the validated snapshot contract in `src/model.js` and `docs/INTEGRATION.md`.
- Prefer a governed BigQuery serving model consumed through our existing backend/gateway. If direct server-side BigQuery access is the established pattern here, add a provider using approved authentication and dependencies. Keep project/dataset/table allowlists in server configuration and credentials out of source and browser code. Never accept SQL or arbitrary table names from the client.
- Implement catalog lookup and complete snapshot retrieval for the selected root, view, revision, release state, configuration and serial. Use parameterized value filters, dry runs/byte limits where supported, correct dataset locations, sensible partition predicates and documented query costs.
- Resolve effectivity upstream and fail clearly when a requested serial or configuration cannot be represented. Do not silently return the latest generic BOM. A query may not truncate a structure and present it as complete; preserve and validate all its parent-child links.
- Establish canonical cross-view occurrence mappings from real lineage or an explicit mapping table. Use confidence-labeled fallback only where the engine's conservative rules permit it. Do not globally join on part number, aggregate away repeated occurrences, or fabricate stable IDs that hide moves/replacements.
- Ensure one consistent source snapshot/version is used for all component queries. Prefer immutable published snapshot IDs; preserve capture time, source references, extraction time, revision rule and effectivity context. If several warehouse tables refresh independently, expose the consistency/freshness limitation.
- Map explicit NC/ECO explanations as `relationship: "explains"`; map contextual links as `"related"`. Include source IDs, status, summary, and authorized deep links. Declare each explanatory record's scope with `changes` (the change types its disposition actually accounts for) and `serialNumber` for unit-specific records; the app counts nothing as explained without them. Send `nodeCount` on every snapshot so truncated extractions are rejected. See `RED_TEAM_REPORT.md` for the defects these contracts close.
- Keep the current demo mode usable. Live mode must show actual source status and error clearly; it must never fall back to synthetic data on failure.

## 3. Reconcile against the existing Excel tool

- Follow `docs/EXCEL_VALIDATION.md`. Read the workbook without overwriting it. Inventory visible/hidden sheets, tables, formulas, cached formula results, named ranges, macros/external links, filters and comparison outputs. Record which A/B inputs, revisions, serials and comparison direction it actually represents.
- Inspect its comparison logic before using its output as a benchmark. Determine whether it compares flattened parts, occurrences, quantities, revisions, reference assignments or only flags presence. Determine whether duplicate parts are collapsed and how blanks, units, suppressed lines and assemblies are handled.
- Confirm the Excel inputs and BigQuery inputs are the same source snapshots, or quantify input drift first. If they differ, separate source-data differences from algorithm differences. Do not claim a failed engine or successful parity based on mismatched inputs.
- Extract each expected result with workbook/sheet/cell-or-row provenance. Preserve raw cell text and normalized values. Document a reproducible mapping of Excel columns and statuses to app output. Do not equate part number with occurrence identity when the workbook lacks occurrence paths.
- Run the app engine against those exact normalized inputs. Produce a row-level reconciliation that classifies every expected/app result as matched, value mismatch, Excel-only, app-only, ambiguous correspondence, different input snapshot, or unsupported Excel semantics. Preserve both paths, part numbers, revisions, quantities/units, reference designators, record IDs and the source workbook location.
- Check every category, including unchanged rows and negative controls. Include repeated parts in separate subassemblies, ambiguous duplicates, serial-specific alternates, released/unreleased revisions, moves, one-sided branches and ref-des reassignments. Where Excel only supports eBOM↔eBOM, establish parity there and validate cross-view behavior independently.
- Investigate discrepancies. Correct app defects with regression tests. Record Excel limitations/defects with evidence; do not distort the app solely to match them. Do not invent a reconciliation percentage before actual execution.

## 4. Complete and demonstrate

- Run the repository tests plus the new adapter and real-workbook regression tests. Check the interface in desktop and narrow layouts, source selection, serial filters, tree scoping, detail records and exports. Verify inaccessible data is not exposed through catalog, compare or export.
- Add a reproducible validation command and emit `validation/reconciliation.csv`, `validation/summary.json` and `validation/README.md` in the internal environment. Include snapshot identifiers/hashes, workbook hash, compared timestamp, engine version, mapping version, row denominators and unresolved cases. Avoid publishing internal workbook extracts, project IDs, queries with sensitive literals, part data or source links to the public origin.
- Acceptance: all in-scope Excel rows are accounted for; every discrepancy is fixed or explicitly adjudicated; unresolved/ambiguous cases are visible; serial, release, effectivity and repeated-part semantics are correct; configuration is reproducible; all source access is authorized.
- Finish with a concise handoff: tables selected and why, app changes, commands to run, tested cases, reconciliation counts, remaining blockers, and the exact configuration required for internal deployment. If a required source or workbook is missing, complete all independent work and state the precise missing artifact or field.

Use judgment for routine implementation choices. Ask me only when a missing business definition or inaccessible required artifact prevents a defensible result.
