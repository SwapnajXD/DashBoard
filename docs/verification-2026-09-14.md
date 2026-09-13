# Olympus V2: Athena follow-up and Hermes verification

Verified on 2026-09-14 Asia/Kolkata (2026-09-13 22:38–22:41 UTC). These are point-in-time observations, not hardcoded application data or ongoing health guarantees.

## Scope and existing implementation

Apollo is the Proxmox host, Athena is observability VM 100, Hermes is K3s VM 101, and Artemis is the management workstation. The existing server-only Prometheus, Loki and Kubernetes adapters already normalize their responses and preserve independent failures through `/api/infrastructure`. No adapter, API schema, UI, dependency, infrastructure configuration or local credential changes were required for this verification.

All live requests were reads using existing local configuration. No software was installed, no alerts were created or changed, and no cluster resources or service configurations were modified. No raw log lines, certificates, keys, token values or kubeconfig contents are included here.

## Athena

### Loki ingestion and label validation

- `/loki/api/v1/labels` returned HTTP 200 and success with `container`, `host`, and `service_name`. All three are nonempty strings, satisfying the current adapter's real label validation.
- A backward `/loki/api/v1/query_range` request for `{container=~".+"}`, limited to 20 entries over the last 15 minutes, returned 20 nonempty log lines in two streams.
- The first sample spanned `2026-09-13T22:37:18.923Z` through `2026-09-13T22:38:24.222Z`. Its newest entry was approximately 17 seconds old when checked.
- A later bounded query returned 20 entries with a newest timestamp of `2026-09-13T22:39:50.010Z`, approximately 24 seconds old. The advancing timestamp confirms newly observable log entries between checks, beyond API readiness alone.
- Log bodies were inspected only for nonempty content and were neither printed nor stored. These checks do not prove coverage for every container or measure transport latency: Loki entry timestamps are log timestamps, not necessarily receipt timestamps.
- The public API continues to expose readiness and validated label count only. No raw-log endpoint or new freshness schema was needed for this verification milestone.

### Prometheus and metric attribution

All five existing scrape jobs (`cadvisor`, `node`, `probes`, `prometheus`, `proxmox`) were up on recheck. The current alert list was successfully empty. Both configured Athena percentage queries returned one finite sample without warnings, selecting Proxmox Exporter's `qemu/100` identity:

| Configured reading | Observation | Meaning |
| --- | --- | --- |
| CPU | Approximately 1.87% | Hypervisor-observed Athena VM CPU |
| Memory | Approximately 82.51% | Hypervisor-observed Athena VM memory |

These values remain explicitly distinct from guest measurements; the queries were not replaced or relabeled.

Node Exporter's existing `job="node"`, `instance="node-exporter:9100"` series support the following candidate calculations:

| Candidate | Existing series verified | Attribution decision |
| --- | --- | --- |
| Guest CPU | `node_cpu_seconds_total`, idle rate over five minutes | Unavailable as a verified Athena guest reading |
| Guest memory | `node_memory_MemAvailable_bytes` / `node_memory_MemTotal_bytes` | Unavailable as a verified Athena guest reading |
| Guest uptime | `time() - node_boot_time_seconds` | Unavailable as a verified Athena guest reading |
| Guest filesystem | Root `node_filesystem_avail_bytes` / `node_filesystem_size_bytes` | Unavailable as a verified Athena guest reading |

Each candidate returned a finite sample, but `node_uname_info` identifies a container-style nodename, not Athena. The existing local configuration and API evidence do not establish the exporter's host `/proc`, `/sys`, or root filesystem mount attribution. Matching resource sizes or uptime alone is insufficient evidence. Guest values were therefore not configured or exposed as verified Athena telemetry. Athena storage remains explicitly unavailable in the current API; guest uptime has no field in its existing percentage-only metrics contract. Hypervisor readings are not a fallback for these unverified guest readings.

### Grafana alert access

No Grafana endpoint or credential is configured in the existing local environment or V2 adapter registry. A bounded check of Athena's private address at the default Grafana port 3000 failed with `ECONNREFUSED`. Requests intended for `/api/health`, `/api/prometheus/grafana/api/v1/rules`, and `/api/alertmanager/grafana/api/v2/alerts` could not establish a connection.

This does not establish that Grafana is down: it may use another port, bind address or proxy. Grafana-managed rule/alert state is unavailable with the current access configuration. Prometheus's empty alert list is not evidence that Grafana has no alerts. No guessed credentials, login attempts, port scan, alert migration or configuration changes were made.

Prometheus and Loki verification was sufficient to proceed to Hermes with these explicit guest-attribution and Grafana-access limits.

## Hermes

The existing Kubernetes adapter was inspected before use. It loads only the configured kubeconfig/context or explicit in-cluster credentials, requires HTTPS and private endpoint resolution, and collects resources independently with pagination, request budgets and sanitized projections.

Live collection used the existing local Hermes context and client-certificate credentials, with TLS verification enabled. The adapter completed with `state: ok`; every collected resource reading was available.

| Resource | Verified observation |
| --- | --- |
| Kubernetes/K3s version | `v1.36.4+k3s1` |
| Node | One `hermes` control-plane node; Ready=True |
| CPU capacity / allocatable | `4` / `4` cores |
| Memory capacity / allocatable | `4009128Ki` / `4009128Ki` |
| Metrics-server CPU | `33277469n` (approximately 33.28 millicores) |
| Metrics-server memory | `912416Ki` (approximately 891.03 MiB) |
| Metrics timestamp/window | `2026-09-13T22:40:27Z`, window `20.013s`; approximately 10 seconds old at collection |
| Namespaces | `default`, `kube-node-lease`, `kube-public`, `kube-system` |
| Pods | Seven total: five Running, two Succeeded Traefik installation jobs |
| Deployments | coredns, local-path-provisioner, metrics-server, traefik; each desired/ready/available = 1 |
| Services | kubernetes, kube-dns, metrics-server, traefik |
| Ingress resources | Successful empty list |

The five Running pods were CoreDNS, local-path-provisioner, metrics-server, the Traefik ServiceLB pod and Traefik; their reported containers were ready. Completed installation jobs were retained as Succeeded, not mislabeled as failing workloads. Metrics-server CPU is current usage over its reported window, not capacity or historical utilization.

No Kubernetes components were installed or changed. No Secrets resource or write operation was requested. The kubeconfig's existing privileges were not changed or certified as least-privilege; Olympus itself made only read requests. Credential material and the kubeconfig path were absent from the normalized response.

## API, checks and remaining work

The local web server stopped responding during this follow-up. Verification therefore used the existing adapter and then the actual `/api/infrastructure` GET handler directly, without starting or stopping the user's server. The handler returned HTTP 200, `Cache-Control: no-store`, schema version 1, and independently available live host results. Loki and Kubernetes were `ok`; Prometheus remained `partial` for intentionally unconfigured queries. Configured token values and Kubernetes credential material were absent from serialized results.

The existing regression suite covers independent failures, missing metrics-server permissions, malformed resources, pagination, private endpoint enforcement, unsafe kubeconfig rejection and credential projection. This milestone requires no runtime changes or additional fixture tests. All 27 tests passed, `npm run typecheck` passed, and `npm run build` completed successfully. Tests and the build ran outside the execution sandbox to allow the required subprocesses. Diff review found no configured token values, retired-host references, container socket/TCP access, or credential blocks. `.env.local` remains ignored; the existing kubeconfig is outside the repository. The pre-existing development `next-env.d.ts` contents were preserved and excluded from the commit.

Remaining work is to establish Node Exporter's guest mount/identity attribution using trusted deployment information and identify Grafana's existing private endpoint with suitable read access. Neither requires changing Athena merely to accommodate Olympus. Once those limits are resolved, consider explicit provenance and log-freshness fields before adding richer UI views. Keep raw logs and credentials out of the existing public response.
