# Excel reconciliation protocol

The ticket references an existing spreadsheet but no workbook was provided with this build. No Excel results have been read or validated. This document defines the transfer workflow; the work agent must implement extraction against the real workbook rather than guessing its layout.

## Establish comparable inputs

Record workbook filename/hash, sheet names, external references, calculation/cache freshness, A/B direction, root part, BOM view, release/revision/configuration rules, exact serials, source timestamps and all filters. Treat formulas with absent or stale caches as unknown; use the approved calculation engine to recompute a copy when necessary. Do not execute untrusted workbook macros or modify the original.

Capture the same immutable source inputs for both implementations. If the workbook is a historical export and the warehouse contains only current state, label the exercise **input drift**, not engine parity. Retain raw and normalized values with sheet/cell provenance.

## Mapping decisions to record

| Concern | Required decision |
| --- | --- |
| Direction | Which input is baseline A and comparison B? |
| Grain | Part totals, occurrence, reference assignment, assembly, or another grain? |
| Identity | Canonical occurrence or validated path mapping; never PN alone for repeated uses. |
| Quantities | Local or exploded; precision/tolerance; unit conversion policy. |
| Revisions | Blank vs absent vs concrete revision; release/effectivity rules. |
| Structural lines | Treatment of roots, phantom assemblies, consumed parts, removed branches, suppressed/optional lines. |
| Reference designators | Scope, multi-value delimiters, case and duplicate assignment policy. |
| Workbook formulas | Cached vs recalculated, filtering, lookup precedence and duplicate collapse. |
| Change records | Explicit occurrence/serial relationship or context only. |

Normalize types carefully: `0012` is not automatically `12`; missing quantity is not zero; `EA` is not equivalent to `KG`; blank is not proof of removal. If Excel only stores part totals, perform a separate aggregate comparison and mark occurrence-level validation unavailable.

## Required row-level output

`reconciliation.csv` should include:

```text
case_id,workbook_sha256,sheet,excel_row,excel_cells,
baseline_snapshot,comparison_snapshot,occurrence_key,match_basis,
path_a,path_b,part_a,part_b,revision_a,revision_b,
excel_status,app_changes,excel_quantity_a,app_quantity_a,
excel_quantity_b,app_quantity_b,unit_a,unit_b,
excel_reference_a,app_reference_a,excel_reference_b,app_reference_b,
classification,explanation,adjudication,reviewer
```

Classifications: `matched`, `value_mismatch`, `excel_only`, `app_only`, `ambiguous`, `input_drift`, `unsupported_semantics`. One-to-many comparisons must retain all contributing workbook rows and app occurrences. Do not force ambiguous pairs just to improve the match rate.

`summary.json` must record separate denominators for total expected rows, mapped comparable rows, matched comparable rows, every discrepancy class, excluded rows/reasons, app-only occurrences and unresolved decisions. Include hashes, source times, engine/mapping versions and execution time. A reported match rate applies only to explicitly comparable rows and must be accompanied by excluded and unresolved counts.

## Exit criteria

Every workbook output row and every relevant app row is accounted for. Mismatches are investigated, app defects have regression coverage, input drift is separated, workbook limitations are documented, and unresolved cases have an owner. A representative unchanged baseline and deliberately changed negative controls are required. An Excel-only eBOM benchmark does not validate serial-specific mBOM/aBOM behavior.

Keep actual workbooks, extracts, warehouse mappings and validation reports within the authorized internal environment. Use redacted synthetic regression fixtures in the public repository.
