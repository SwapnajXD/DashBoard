# Olympus V2 repository audit

Audited baseline: `850b2c8` (2026-09-14). This pass changes only Olympus code, tests and documentation. It does not contact or change Apollo, Athena or Hermes. Earlier live observations remain documented in the dated verification records; this audit does not reconfirm them.

## Source-of-truth inventory

| Displayed values | Source / transformation | Time semantics |
| --- | --- | --- |
| Apollo/Athena/Hermes names, roles, section numbers; Artemis management role; VM 100/101 mapping | Intentional V2 registry/presentation metadata | Static identity, not discovered telemetry |
| Host state and state-source label | Proxmox node/VM state first; otherwise Hermes Ready condition or Athena observability API health | Evidence in current aggregation; collection time is not a power-state transition time |
| Apollo CPU/count, memory, disk, uptime | Proxmox node fields; CPU ratio × 100, byte/duration formatting; disk used/capacity ratio | Local completion time of node reading; Proxmox does not supply a sample timestamp here |
| VM names/IDs/node/state, CPU, memory, disk allocation, uptime | Proxmox inventory; VM disk is allocated capacity, not guest filesystem use | VM inventory observation time |
| Storage identities, node, used/capacity/utilization | Proxmox storage inventory; utilization derived only from valid used/total values | Storage inventory observation time |
| Athena connection health | Prometheus health and Loki readiness responses | Observation or failed-attempt time; independent sources |
| Athena VM CPU/memory | Configured Prometheus queries of Proxmox Exporter VM 100 series, explicitly hypervisor-observed | Instant-query evaluation time, not the original exporter scrape time |
| Scrape targets, job/instance, health, up/total | Prometheus targets API; counts derived from returned list | Collection time plus each reported last-scrape time |
| Prometheus alert names/state/active-since and firing count | Prometheus alerts API; firing count derived | Collection time and upstream activation time; not Grafana-managed alerts |
| Loki label count, inspected-entry count/latest entry, freshness | Validated labels API and bounded query metadata; no log bodies | Log entry timestamp, not ingestion/receipt time; recent/older relative to sync |
| cAdvisor names/last-seen/freshness | Configured Prometheus container-last-seen series; no Docker access | Series value records last-seen time; recent/older relative to sync |
| K3s version; node names/roles/readiness; namespaces; pods/phase/node; containers/kind/state/readiness/restarts | Kubernetes API projections | Resource-list observation time; not state transition times |
| Node CPU/memory capacity and allocatable | Kubernetes node status quantities | Node-list observation time, separately from usage samples |
| Node CPU/memory usage | Kubernetes Metrics API nodes, quantity conversion | Upstream timestamp and sampling window; older samples remain visibly older |
| Pod CPU/memory | Sum of Metrics API container samples, only with exact namespace/name and complete relevant-container coverage | Upstream pod-metric timestamp/window; never inventory collection time |
| Individual container CPU/memory | Named container entries from Metrics API pods, joined to declared pod inventory | Parent pod-metric timestamp/window; never estimated from pod totals |
| Pod/deployment/service/ingress counts, running/completed pods, readiness totals | Derived from corresponding available Kubernetes inventories | Each collection observation; missing lists never imply zero |
| Deployment desired/ready/available; service type/ports; ingress class/hosts | Kubernetes API projections | Corresponding resource-list observation time |
| Last successful sync and stale snapshot notice | Aggregation completion and browser clock | Whole response time; not a guarantee all adapters succeeded |

Athena guest CPU/memory/uptime/filesystem attribution and Grafana-managed alerts remain **not verified**. Artemis is static management context, not a monitored workload. No Olympus-on-Hermes placement is asserted.

## Findings and changes

- Hermes node usage existed in the API and node table but lacked a concise summary; allocatable values were not displayed. Node summary now presents usage and capacity/allocatable with separate sources.
- The installed Kubernetes client defines the existing Metrics API `/apis/metrics.k8s.io/v1beta1/pods` response with per-container CPU/memory. Olympus now reads that endpoint independently of node metrics and inventory, projects only sanitized fields, and displays pod totals plus expandable container details. **Live authorization/availability of this new path was not checked in this repository-only pass.** Missing/forbidden Metrics API data is unavailable/error, never synthetic usage.
- Partial resource values survive independently. Missing container samples prevent a full pod total; valid individual container samples remain usable. Duplicate identities, invalid continuation tokens and missing namespaces are rejected instead of risking incorrect attribution. Missing/malformed timestamps or windows cannot produce apparently current usage. Stale samples keep their original time.
- The previous browser shape check allowed malformed nested render values. The schema-1 boundary now validates the displayed nested fields before replacing the last good snapshot. The contract remains additive (`podMetrics` is optional for older producers; metric errors are optional). No raw Kubernetes resource or authentication data is added.
- Refresh is guarded against overlapping invocations. Failure notices remain visible throughout a retry and clear only on success. A failed HTTP/shape check retains the last good snapshot and its time. A successful aggregation intentionally replaces the snapshot, including current per-source failures; Olympus does not silently reuse an older source inside a fresh response.
- Proxmox negative readings become unavailable, malformed optional Prometheus dates become null, Kubernetes counts/ports are validated, and a legacy presentation helper no longer overrides direct Apollo data with Prometheus readings.
- README claims that Apollo was still pending verification and Prometheus overrode Apollo cards were stale and have been corrected. The future Hermes deployment assumption was removed.

## States and limits

`Unavailable` means no usable observation; `Not configured` means required configuration is absent; `Not verified` denotes known provenance/verification gaps. `Error` indicates malformed responses, configuration/authorization or upstream errors; connection/timeouts are unavailable with a specific safe error message. Successful empty inventories are empty, not unavailable. Zero is shown only when actually returned or derived from complete available data.

`Recent at sync` / `Older at sync` compare a source timestamp to its observation time; they do not promise continued freshness. The entire snapshot becomes stale after five minutes or a failed refresh. Prometheus evaluation timestamps do not establish exporter freshness; target last-scrape and cAdvisor last-seen are separate evidence. Manual synchronization, the five-minute threshold, Loki's 15-minute/20-entry bound, formatting units, and inventory limits are intentional policy constants, not infrastructure readings.

Per-adapter and per-list failures are isolated. Identity ambiguity can make the affected list unavailable; it does not replace it with an empty list or hide other sources. Existing five-second HTTP limits, 15-second Kubernetes budget, 8 MiB response cap, and inventory pagination bounds remain. Pod metrics add one bounded list, without serializing pod specs, labels, logs or raw authentication material. Some inventory/metrics duplication is intentional to keep independent availability and timestamps; this audit does not redesign schema 1.

## Security and production limits

Adapters/configuration remain server-only. The browser fetches only `/api/infrastructure`; it receives selected identities, telemetry and safe errors. Kubeconfig/certificates/token values and configuration paths are not response fields. Local credentials remain ignored. No dependency, infrastructure configuration, monitoring component, public port, or deployment resource is added.

Kubernetes requires verified TLS and private addresses. Proxmox requires HTTPS and defaults to verified TLS; its pre-existing explicit `PROXMOX_ALLOW_SELF_SIGNED` bypass remains a production risk if enabled. Keep it disabled and use the existing CA trust. Proxmox/observability endpoint configuration still relies on the operator choosing private origins; it does not enforce private-address classification like Kubernetes. Existing private HTTP observability connections are not encrypted. No security control was weakened here.

Olympus still has no application authentication and should remain behind trusted private management access. This audit does not establish readiness for public exposure or introduce authentication. Athena guest attribution and Grafana integration are deferred.

## Verification scope

Run `npm test`, `npm run typecheck`, `npm run build` and `git diff --check`. Added fixtures exercise node/pod/container success, partial/missing/malformed/stale samples, Metrics API failure isolation, identity/pagination validation, nested browser contract validation and projection privacy. Browser checks use intercepted fixture responses without contacting infrastructure. A production build can run in a temporary copy without `.env.local`, preserving the unrelated original `next-env.d.ts` modification.

Continuation verification completed on 2026-09-14: `npm test` passed all four test files; `npm run typecheck` and `git diff --check` passed. `npm run build` passed in a temporary copy with local credentials excluded and dependencies copied locally. The build and Chromium checks required execution outside the sandbox after sandbox subprocess restrictions; the application source did not require changes to pass.

Fixture-only browser checks passed at desktop and mobile sizes: node/container values, expandable container details, pod filtering, retained snapshots after HTTP and malformed-response failures, visible warnings during retry, overlapping refresh prevention, independent source failures, stale observations and no page overflow. There were zero page errors and zero infrastructure connections. The temporary browser harness now rebases saved fixture timestamps together so repeat runs preserve their relative freshness. README credential guidance now includes the pod Metrics API read permission used by the adapter.

Recommended next step: separately authorize read-only live verification of the newly consumed pod/container Metrics API and compare the displayed node/pod/container samples and timestamps. Until then, distinguish tested capability from verified live data. Do not enable new collectors or expand to Athena guest/Grafana work as part of this audit.
