# AI-1192 acceptance matrix

| Ticket need | Delivered | Work-environment dependency |
| --- | --- | --- |
| No manual Teamcenter export | Gateway pulls catalog and selected snapshots automatically; directory provider supports controlled pipeline output. | Discover BigQuery models or implement approved source API mappings. |
| Pull from Teamcenter or Manufacturo | Source labels/provenance and federated normalized gateway contract. | Actual endpoints, identity and field mapping. No native connection is claimed. |
| Released/unreleased BOMs | Filter and compare either lifecycle state; unreleased-context warning. | Native release-state mapping. |
| eBOM/mBOM/aBOM comparison | All view pairings; six demo snapshots; all 36 pairing directions tested. | Cross-view occurrence correspondence and intended semantic exclusions. |
| Exact serialized unit | Serial filter and snapshot-scoped selection; aBOM schema requires serial. | Serial effectivity/resolution in warehouse or source. |
| Find differences in subassemblies | A/B trees, branch filters, full occurrence paths and move detection. | Stable cross-view occurrence IDs for reliable relocation matching. |
| Show NC triggering a delta | Explicit explanatory source relationships with NC/ECO detail, disposition summary and optional link. | Actual NC/serial/occurrence relationship; related records alone do not establish cause. |
| Compare reference assignments | Separate assignment-set view with added/removed/reassigned and duplicate references. | Source designator scope/normalization rules. |
| Validate against existing Excel | Detailed discovery and row-level reconciliation handoff. | Actual workbook and comparable input snapshots; not yet run. |

## Verified during this build

- Node engine, validation, formatting and API integration tests.
- Every synthetic pairing direction, duplicate/move/replacement cases and independent local quantity semantics.
- Catalog and comparison retrieval, CSV output, input rejection, API auth and unavailable gateway behavior.
- 5,000 repeated unmatched parts on each side to exercise ambiguity handling.
- JavaScript syntax and complete static-asset availability.

Browser QA was unavailable in this environment. Docker was provided but not built here. No live source, BigQuery or workbook access was available for integration validation.

## Browser smoke steps for the work environment

1. Start in demo mode. Confirm eight changed lines, four source-explained lines, six reference changes in the initial eBOM A → aBOM SN120 result.
2. Open the alternate valve. Confirm A/B full paths, PN change, revision change and `DEMO-NC-1042` synthetic disposition. Close with Escape.
3. Select Power & controls on A. Confirm controller and moved harness appear; on B, locate harness under Primary structure. Expand/collapse branches.
4. Search `V-OX-01`, reset, filter Moved, enable Needs source explanation, include unchanged rows, and reset again.
5. Open the reference tab and confirm `V-OX-01` reassignment and `TT-202` removal / `TT-203` addition. Check full path tooltips.
6. Switch to eBOM unreleased B and to mBOM. Choose SN121. Verify stale-result notice appears until Compare runs. Swap A/B and verify addition/removal direction.
7. Export JSON and CSV. Confirm they represent all current run rows despite table filters. Restore a prior run from Session history and verify exported provenance matches that run.
8. Check keyboard focus, dialogs, horizontal table scroll, reduced motion, and layouts at 1440 px and 390 px. Verify no clipped selectors or body overflow.
9. Test unavailable source, empty catalog and invalid snapshot handling. No source failure may silently show demo results as live.
10. Start with `BOM_APP_TOKEN` and confirm the token is required for catalog/compare/export; it must not appear in storage, URLs or logs. Check actual SSO and data entitlements separately.
