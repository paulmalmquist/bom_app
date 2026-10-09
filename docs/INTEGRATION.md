# Source and deployment contract

## Warehouse-first integration

The app does not require people to export BOMs. `gateway` mode retrieves the catalog and both snapshots automatically on each comparison. An internal gateway can query BigQuery serving models or use approved Teamcenter/Manufacturo APIs. This repository intentionally does not invent proprietary endpoint names, authentication flows or warehouse tables.

For this environment, use the BigQuery discovery handoff to locate governed equivalents first. The upstream `source` remains Teamcenter/Manufacturo even if transport is BigQuery; add `transport`, `sourceVersion`, `revisionRule`, `effectivity` and lineage metadata to the snapshot header as needed. Extra header fields survive into JSON reports.

## Gateway endpoints

Configure `BOM_MODE=gateway`, `BOM_GATEWAY_URL=https://internal-gateway/api`, and optionally `BOM_GATEWAY_TOKEN`. The app sends a server-side bearer credential. Redirects are rejected, requests time out after 15 seconds, and individual responses are limited to 25 MB.

| Request | Response |
| --- | --- |
| `GET {base}/boms` | JSON array of unique snapshot headers, maximum 5,000; same required header fields as below, including `nodeCount` for live data; omit `nodes`. |
| `GET {base}/boms/{encoded-id}` | Complete normalized snapshot. Response ID must equal the requested ID. |

IDs should refer to immutable, fully resolved structures. If a source is mutable, issue a new snapshot ID whenever its contents change and publish the exact captured time. Never silently truncate catalog pages or component pages. The gateway must aggregate authorized pages into a complete response within the contract, or explicitly reject the request. No synthetic fallback occurs.

## Snapshot example

```json
{
  "id": "demo-ebom-a-20261009",
  "name": "Demonstrator assembly",
  "partNumber": "DEMO-1000",
  "revision": "A",
  "type": "eBOM",
  "source": "Teamcenter",
  "releaseStatus": "Released",
  "serialNumber": null,
  "configuration": "Approved demo revision rule / all units",
  "capturedAt": "2026-10-09T13:00:00Z",
  "synthetic": true,
  "nodes": [
    {
      "id": "root",
      "parentId": null,
      "occurrenceKey": "demo:root",
      "partNumber": "DEMO-1000",
      "revision": "A",
      "name": "Demonstrator assembly",
      "quantity": 1,
      "unit": "EA",
      "refDes": [],
      "records": []
    },
    {
      "id": "valve-use-1",
      "parentId": "root",
      "occurrenceKey": "demo:valve-use-1",
      "partNumber": "DEMO-2100",
      "revision": "B",
      "name": "Isolation valve",
      "quantity": 1,
      "unit": "EA",
      "refDes": ["V-OX-01"],
      "records": [
        {
          "id": "DEMO-NC-001",
          "type": "NC",
          "status": "Closed",
          "source": "Synthetic QMS",
          "summary": "Explicit synthetic disposition for this occurrence.",
          "relationship": "explains"
        }
      ]
    }
  ]
}
```

### Invariants

- `type`: exactly `eBOM`, `mBOM`, or `aBOM`. `releaseStatus`: `Released` or `Unreleased`. The gateway documents how native lifecycle states map to these two states.
- aBOM always requires a nonempty **exact** `serialNumber`. A generic or serial-specific mBOM is supported. Engineering effectivity still belongs in configuration metadata.
- `capturedAt` is an ISO timestamp with timezone for the source snapshot. It is distinct from app comparison time. `synthetic` is explicitly `true` or `false`.
- Snapshot IDs use letters, digits, `_`, `.`, `:`, or `-`, maximum 500 characters. Header identity/configuration fields are required nonempty strings.
- Nodes describe **occurrences**, not unique part masters. 1–20,000 nodes, exactly one root, existing parents, no cycles, maximum depth 128. Preserve identifiers as strings.
- `occurrenceKey` is optional but must be unique inside a snapshot and stable across the compared views. It identifies the same physical/logical usage position, not a PN or an arbitrary row number. A reliable canonical mapping enables move detection.
- Local `quantity` is finite and nonnegative, and `unit` is explicit. No implicit multiplication by parent quantities, aggregation, unit conversion, or zero-vs-blank coercion occurs.
- `refDes` and `records` are arrays, even when empty. Each `refDes` entry is one trimmed designator with no spaces or list delimiters (`,` `;` `|`); split lists and normalize upstream. Duplicate reference values on one node are invalid; repeated references across nodes remain visible with a warning.
- Live (`synthetic: false`) headers and snapshots must declare `nodeCount` between 1 and 20,000, equal to the full snapshot node count. Derive it from the complete upstream structure before pagination or row limits. A count recomputed from truncated rows does not establish completeness. Synthetic fixtures may omit it.
- Record fields `id`, `type`, `status`, `summary`, `source`, `relationship` are required. Optional `url` must be HTTP(S) without embedded credentials. `explains` requires an explicit source association; `related` never counts as explanatory evidence.
- Optional record scope: `changes` lists the change types the source says the record accounts for (`Added`, `Removed`, `Replaced`, `Revision`, `Quantity`, `Unit`, `Reference`, `Moved`, `Description`); `serialNumber` limits the record to one serialized unit. A changed occurrence counts as explained only when qualifying records declare every one of its change types. An `explains` record with no `changes` is shown as a link with undeclared scope and is not counted. Records present unchanged (same source, id and status) on both snapshots, and records whose declared serial does not match the side carrying the record, are shown but not counted. None of this is an approval.
- Each occurrence must have unique record identities (`source`, `id`); merge duplicate joined records upstream. Unresolved correspondence is never counted as explained.
- Additional fields are retained. Do not forward sensitive fields the app does not need.

Missing source fields must be resolved or rejected by the gateway. Do not label unknown lifecycle state as Released, missing quantity as 0, or unknown revision as a real revision.

## App API

| Endpoint | Behavior |
| --- | --- |
| `GET /healthz` | Public process liveness only; does not claim the source is healthy. |
| `GET /api/catalog` | Retrieves and validates current catalog, returns provider mode and retrieval time. |
| `POST /api/compare` | JSON `{ "leftId": "...", "rightId": "..." }`; fetches current selected snapshots and returns a complete comparison report; a same-ID comparison reads that source only once. |
| `POST /api/export` | Same request shape; recomputes from sources and returns CSV. |

The UI exports its **already displayed** report to JSON/CSV without re-querying, so it is reproducible even if sources change afterward. Table filters do not truncate exports. API exports recompute and should be used only when a fresh comparison is intended. JSON is the full audit format, including frozen catalog-drift warnings from the UI. CSV includes snapshot hashes and occurrence identities, but omits the complete headers and comparison warnings.

Errors: 400 malformed request or invalid snapshot, 401 missing/invalid application token, 502 gateway transport/contract error, 500 other source failures. Neither catalogs nor results are persisted server-side; session history is browser-tab memory only.

## Hosting and authorization

Default bind is localhost. Binding any other interface requires `BOM_APP_TOKEN`. Without a token, API requests must carry a loopback `Host` header (protection against DNS rebinding from other sites open in the same browser); a trusted local reverse proxy can add its hostname to `BOM_ALLOWED_HOSTS`. Use HTTPS and the existing Dreamcatcher SSO/access policy in front of this service for real deployment. The shell is public; catalog/compare/export require the token when configured. The token is held in browser memory and never placed in a query string or browser storage.

The gateway bearer credential represents a service identity. This starter does **not** propagate individual user identity or implement per-user row-level security. Define the exact authorized user group and dataset scope before connecting internal data. If users have different data entitlements, implement trusted identity propagation and enforce warehouse/source access per request; do not rely on hiding UI options. Prevent bypass of the authenticated ingress.

Use platform-managed secrets. Protect exports according to the source data policy. The service is read-only and has no source writeback endpoints. Production ingress should apply request/concurrency limits; CPU-bound comparison work currently runs in the Node request process.

## Source consistency

Canonical IDs, revisions and serial effectivity are the integration's central correctness requirements. A normalized BOM is a resolved tree, not an arbitrary table join. One-to-many parts, phantom assemblies, manufacturing consumables, alternates and permitted substitutions need explicit semantic decisions. Supply a consistent snapshot across the BOM and evidence tables, or prominently expose any consistency limitations.
