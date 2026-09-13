# Olympus Control Plane — V2

Olympus is a Next.js dashboard with a single server-side infrastructure API.

| Host | Role |
| --- | --- |
| Apollo | Proxmox infrastructure host |
| Athena | VM 100: Prometheus, Grafana, Loki, Alloy, Node Exporter, cAdvisor and Proxmox Exporter |
| Hermes | VM 101: single-node K3s/Kubernetes; eventual Olympus deployment target |
| Artemis | Management/admin workstation |

## Run and verify

Use Node.js 22.19+ (required by the existing Undici dependency). Framework versions remain Next.js 16.3.4 and React 19.2.0.

```bash
npm ci
# For a fresh checkout only; preserve any existing local configuration:
cp .env.example .env.local
npm run dev
```

Configure server-side values in the ignored `.env.local`. Never use `NEXT_PUBLIC_` for credentials or adapter configuration. The current Artemis checkout uses only a path to the existing kubeconfig and the `hermes` context; no kubeconfig credentials were copied into the project.

```bash
npm run typecheck
npm test
npm run build
npm start
```

No lint script or earlier persistent test suite was configured. The added regression suite covers topology, aggregation, malformed upstream data, partial failures, privacy, Kubernetes configuration and pagination, and unavailable UI values. Live private-network checks are separate from fixture tests.

### Build failure diagnosis

The previous build failure was an execution-environment restriction, not malformed TypeScript configuration. Next.js 16.3.4 defaults to its TypeScript CLI path and parses the stdout of a child `tsc --showConfig` process. In this sandbox that child produced empty stdout; a direct `spawnSync` probe returned `EPERM`. `JSON.parse("")` then caused “Could not parse output from TypeScript's --showConfig.” Running TypeScript directly worked.

Running `npm run build` with child-process execution permitted completed successfully without changing `tsconfig.json`, framework versions, or disabling type checking. Run builds and tests in an environment that permits their child processes. The sandbox can also report the test file as passing without executing its individual cases; verify the named test cases and count in the output.

## Infrastructure API

```text
Browser → /api/infrastructure
            ├─ Apollo: Proxmox API
            ├─ Athena: Prometheus + Loki
            └─ Hermes: private Kubernetes API
Artemis: registered management workstation, no telemetry adapter
```

`/api/hosts` is a compatibility alias for the same aggregator. All adapter/configuration modules are server-only; the browser calls only the unified endpoint. It runs on page load and manual SYNC. No background monitoring system is added.

The response has `schemaVersion`, `ok`, a collection `timestamp`, and `hosts`. Each host includes public identity (including VM IDs), `status`, `statusSource`, a timestamp, and typed adapter results. Internal network configuration is omitted.

- Host states are `online`, `offline`, or `unknown`. Proxmox's reported node/VM state takes precedence; otherwise Hermes node readiness or Athena API health supplies evidence. Failed requests alone never assert a host is offline. A Kubernetes `Ready=False` means the node is not ready, not proof of physical power state.
- Adapter states are `ok`, `partial`, `unconfigured`, `unreachable`, or `error`. Every adapter includes its timestamp, source status, typed data or `null`, and a sanitized error or `null`.
- Individual resource/metric readings have `available`/`unavailable`, `data`, `timestamp`, and `error`. A successful empty list is `[]`; an inaccessible or malformed list is `null`, never zero. Metric samples also include their source sample timestamp.
- `ok: true` means aggregation succeeded, not that infrastructure is healthy. Independent adapters and resource reads run concurrently, with partial failures preserved. Requests have a five-second timeout covering response bodies and an 8 MiB body limit. Kubernetes collection also has a 15-second request budget, 200-item pages, and a 4,000-item/20-page limit; hitting a limit marks that list unavailable.
- Responses use `Cache-Control: no-store`. Errors expose safe categories and HTTP status, not raw upstream bodies, URLs or credentials. Kubernetes results omit pod environment/specifications, annotations and raw condition messages. Prometheus results omit arbitrary labels/annotations and scrape URLs.

The app has no authentication layer yet. Keep the dashboard behind trusted private management access. No public Kubernetes API, workload changes, cluster installations or deployment manifests are introduced.

## Configuration

`.env.example` contains the full list. Explicit endpoint URLs override address-derived URLs and should use private routing; URLs containing embedded credentials/query strings/fragments are rejected.

| Variable(s) | Purpose |
| --- | --- |
| `OLYMPUS_NETWORK_MODE` | `tailscale` by default on Artemis; `lan` for Hermes deployment |
| `APOLLO_LAN_ADDRESS`, `APOLLO_TAILSCALE_ADDRESS` | Bare Apollo address; Proxmox defaults to HTTPS port 8006 |
| `ATHENA_LAN_ADDRESS`, `ATHENA_TAILSCALE_ADDRESS` | Bare Athena address; Prometheus defaults to HTTP 9090 and Loki to HTTP 3100 |
| `HERMES_LAN_ADDRESS` | Registry address; Kubernetes connection comes from the explicitly selected kubeconfig or service account |
| `PROXMOX_URL`, `PROXMOX_NODE_NAME` | HTTPS base URL without `/api2/json`; node name defaults to `apollo` |
| `PROXMOX_API_TOKEN_ID`, `PROXMOX_API_TOKEN_SECRET` | Read-only Proxmox token, e.g. PVEAuditor permissions for nodes, VMs and storage |
| `PROXMOX_CA_FILE` | Optional trusted CA PEM path for Proxmox |
| `PROXMOX_ALLOW_SELF_SIGNED` | Explicit opt-in `true` for Proxmox-only certificate bypass; defaults to verified TLS |
| `PROMETHEUS_URL`, `PROMETHEUS_BEARER_TOKEN` | Base URL and optional server-side bearer token |
| `LOKI_URL`, `LOKI_BEARER_TOKEN`, `LOKI_TENANT_ID` | Base URL, optional bearer token and optional tenant |
| `PROMETHEUS_{APOLLO,ATHENA,HERMES}_{CPU,MEMORY,STORAGE}_QUERY` | Nine optional host-specific PromQL percentage queries |
| `KUBERNETES_KUBECONFIG`, `KUBERNETES_CONTEXT` | Explicit file path and optional context override; otherwise uses that file's current context |
| `KUBERNETES_IN_CLUSTER` | Explicit `true` uses mounted service-account credentials when no kubeconfig file is configured |

Address-derived requests do not fall back from Tailscale to LAN. Kubernetes can use a private LAN, Tailscale, or loopback endpoint from its explicit context, provided its TLS name/certificate is valid. This lets Artemis use the existing Hermes context without exposing the API publicly. Kubernetes rejects public-address endpoints, insecure TLS, proxy configurations, exec authentication plugins, basic auth and impersonation. Supported credentials are client certificates, bearer tokens and service-account token files. Kubeconfig file-relative certificate/key paths are handled by the official client.

## Telemetry coverage

Latest follow-up: [Athena ingestion, guest attribution, Grafana access and Hermes live verification — 2026-09-14](docs/verification-2026-09-14.md). This records verified data and remaining access limits without changing the V2 API contract or infrastructure.

### Apollo

The read-only Proxmox adapter collects `/nodes`, `/cluster/resources?type=vm`, and `/cluster/resources?type=storage` independently. It normalizes status, CPU ratio/count, memory, storage capacity/use, uptime, and VM identity where returned. VM 100 maps to Athena; VM 101 maps to Hermes. Missing fields remain `null`. API visibility depends on token permissions. Apollo live verification is pending local endpoint/credential configuration.

#### Configure Apollo locally

Preserve existing `.env.local` entries and add the following server-only configuration. This file is gitignored; never paste a token into source code, a commit, a screenshot, or a browser request.

```dotenv
PROXMOX_URL=
PROXMOX_API_TOKEN_ID=
PROXMOX_API_TOKEN_SECRET=
PROXMOX_NODE_NAME=apollo
PROXMOX_CA_FILE=
PROXMOX_ALLOW_SELF_SIGNED=false
```

Set `PROXMOX_URL` to Apollo's private HTTPS origin, typically port 8006, without `/api2/json`. Alternatively supply `APOLLO_TAILSCALE_ADDRESS` or `APOLLO_LAN_ADDRESS` for the selected network mode. Set `PROXMOX_NODE_NAME` to the exact node name returned by Proxmox; the Olympus host identity remains Apollo. Token IDs have the form `user@realm!token-name`. The adapter sends `Authorization: PVEAPIToken=<id>=<secret>` on server-side GET requests only; it does not use password login or session cookies.

Use an existing read-only token where possible. If none exists, an Apollo administrator can create a dedicated user/token in the Proxmox web interface under Datacenter → Permissions → API Tokens. Keep privilege separation enabled and grant the user and token only the necessary read access; `PVEAuditor` at `/` with propagation provides read-only inventory visibility across nodes, VMs and storage. A separated token's effective permissions are limited by its backing user's permissions. Save the token secret locally when it is issued. Olympus does not create users, grant permissions, install software, or change Apollo. See the official [Proxmox user and token documentation](https://github.com/proxmox/pve-docs/blob/master/pveum.adoc) and [per-method API permissions](https://pve.proxmox.com/pve-docs/api-viewer/).

Prefer a trusted certificate or set `PROXMOX_CA_FILE` to a local trusted CA PEM path matching Apollo's certificate. The existing `PROXMOX_ALLOW_SELF_SIGNED=true` setting disables certificate verification for Proxmox only; leave it `false` for verified TLS. Use existing private LAN/Tailscale routing; no public port forwarding is needed. The adapter requires HTTPS but does not enforce private-address classification, so configure a private origin explicitly.

#### Verify Apollo locally

1. Configure the values locally, restart `npm run dev`, and open Olympus on localhost.
2. Press SYNC. In the browser's network panel, inspect only the local `/api/infrastructure` response. Locate `hosts` → Apollo → `adapters.proxmox`; the response must not contain the token, authorization header, or configured endpoint.
3. Confirm `nodes.data` contains the configured Apollo node and actual status/CPU/memory readings. Check `vms.data` for actual VM IDs, names, states and resources, including VM 100/Athena and VM 101/Hermes if visible to the token. Check `storage.data` for visible storage resources. Do not treat an empty permission-filtered inventory as proof that Apollo has no resources.
4. Confirm the existing Apollo cards show CPU/RAM and node disk utilization where supplied, uptime, and observed VM states. Storage pool inventory is available in the API; it is not summed into the node disk card. Missing values remain unavailable. Configured Prometheus samples retain their existing precedence over Proxmox card readings.
5. Diagnose using the sanitized adapter/reading error: `unconfigured` for missing endpoint/token, `unauthorized` for HTTP 401/403, `unreachable`/`timeout` for transport failures, and `invalid_response` for malformed data or resource identities. One failed resource list yields `partial` when another succeeds. An Apollo failure leaves independent host results available and does not prove Apollo is powered off.

Local automated verification: `npm run typecheck`, `npm test`, and `npm run build`. The suite retains the original 17 tests and adds five Apollo-focused tests with injected API fixtures; no real credentials are required. These tests verify the integration contract, not live Apollo telemetry. Live verification remains pending until the local endpoint, read-only credentials and TLS trust are configured.

### Athena

Prometheus is the primary metric source. Collection covers health, scrape targets, current alerts, and configured per-host instant queries. Queries must return exactly one finite sample between 0 and 100. Empty, ambiguous, invalid or missing series are unavailable. Configure queries against the actual exporter label sets; Olympus does not guess host selectors.

For example, adapt the `instance` selector below to a verified Node Exporter target before configuring an Athena CPU query:

```promql
100 * (1 - avg(rate(node_cpu_seconds_total{instance="YOUR_NODE_EXPORTER_INSTANCE",mode="idle"}[5m])))
```

Use Node Exporter or Proxmox Exporter series already scraped by Athena for Apollo, and Hermes series when available. Unconfigured queries remain unavailable. No exporter or other monitoring component is installed by Olympus.

Loki reports readiness and validated label-name count. Grafana/Alloy/exporter service states remain unknown unless a dedicated verified source is added; Prometheus reachability does not imply every observability service is healthy. Prometheus alerts do not represent Grafana-managed alert rules.

#### Athena live verification and local setup

Read-only verification on 2026-09-14 (Asia/Kolkata) succeeded over Athena's existing Tailscale connection. Olympus did not install anything, change Athena, expose a port, access a Docker socket, or introduce another monitoring stack. The repository has no Athena Docker adapter or stack configuration: its Compose file runs Olympus only. Existing container telemetry is available through Prometheus's cAdvisor scrape.

Configure the ignored `.env.local` with `PROMETHEUS_URL` and `LOKI_URL` pointing to Athena's private service origins (existing ports 9090 and 3100). Alternatively set the Athena address for the selected network mode. Optional `PROMETHEUS_BEARER_TOKEN`, `LOKI_BEARER_TOKEN`, and `LOKI_TENANT_ID` apply only if required by the existing service/proxy. The verified private endpoints accepted unauthenticated reads; no tokens were introduced. Credentials and configuration remain server-side.

Verified observations, not application defaults:

- Prometheus health, targets, instant queries and alerts returned HTTP 200. All five scrape targets were up: `cadvisor`, `node`, `probes`, `prometheus`, and `proxmox`. The alert list was successfully empty.
- Proxmox Exporter identified `qemu/100` as `athena` on `apollo`. Athena-specific CPU and memory queries each returned one finite percentage without warnings. An initial sample was approximately 1.88% CPU and 82.76% memory; the source samples were about five seconds old. These are hypervisor-observed VM metrics, not guest process CPU or guest available-memory measurements.
- cAdvisor reported eight named container series: alloy, node-exporter, glances, proxmox-exporter, grafana, cadvisor, prometheus and loki. Their last-seen values were at most approximately 13 seconds old in the check. This verifies recently collected container telemetry, not Docker health checks or application readiness. No container inventory schema or UI was added.
- Node Exporter exposed four CPU idle series, memory and a root filesystem series, but its uname nodename was container-style. Guest filesystem attribution was not established; `PROMETHEUS_ATHENA_STORAGE_QUERY` remains unset. Proxmox VM disk allocation/zero usage is not a substitute for guest filesystem utilization.
- Loki `/ready` and `/loki/api/v1/labels` returned HTTP 200, with three valid label names. The [follow-up verification](docs/verification-2026-09-14.md) subsequently confirmed recent, advancing real log entries; Grafana alert state remains unavailable with the existing connection configuration.
- The running `/api/infrastructure` returned HTTP 200 with `Cache-Control: no-store`, Athena CPU/memory readings, five targets, an empty alert list and Loki label count. No configured token values appeared in the response. Its schema remains unchanged. Prometheus is `partial` because Athena storage and the other hosts' PromQL queries remain unconfigured; Loki is `ok`.

The following query templates match the verified metric families. Replace `VERIFIED_EXPORTER_INSTANCE` with the actual Proxmox scrape instance selected from `/api/v1/targets`, and confirm `pve_guest_info` identifies VM 100 as Athena before configuring them:

```dotenv
PROMETHEUS_ATHENA_CPU_QUERY='100 * pve_cpu_usage_ratio{job="proxmox",instance="VERIFIED_EXPORTER_INSTANCE",id="qemu/100"}'
PROMETHEUS_ATHENA_MEMORY_QUERY='100 * pve_memory_usage_bytes{job="proxmox",instance="VERIFIED_EXPORTER_INSTANCE",id="qemu/100"} / pve_memory_size_bytes{job="proxmox",instance="VERIFIED_EXPORTER_INSTANCE",id="qemu/100"}'
```

After changing local configuration, restart Olympus or confirm the development server reloaded it, then press SYNC. Inspect Athena's `adapters.prometheus.data.metrics.athena`, `targets`, `alerts`, and `adapters.loki` in the local API response. Empty/ambiguous/non-finite/out-of-range percentages remain unavailable. Readiness and individual resource failures remain isolated. The existing UI is preserved; Athena CPU/memory are currently available through the API, while existing integration/service indicators and alerts use their established views.

The regression suite now has 27 tests, including five Athena-focused tests for missing endpoints, exact query/authentication forwarding, percentage failure isolation, sanitized connection/authentication failures, and Loki label validation. Fixtures require no live credentials. Run `npm test`, `npm run typecheck`, and `npm run build` after changes. Protocol details: [Prometheus HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/) and [Loki HTTP API](https://grafana.com/docs/loki/latest/reference/loki-http-api/).

### Hermes

The server-side adapter uses the official JavaScript client's kubeconfig handling and makes read-only API requests for version, nodes, namespaces, pods (including regular/init/ephemeral container state), deployments, services, networking/v1 ingresses and metrics.k8s.io node usage. CPU/memory capacity, allocatable resources and usage retain Kubernetes quantity units and sample timestamps. Prometheus remains the primary historical host telemetry source; metrics-server usage is a current Kubernetes snapshot.

Live read-only verification on 2026-09-12, reconfirmed on 2026-09-14, succeeded using Artemis's existing `hermes` context: K3s `v1.36.4+k3s1`, one Ready `hermes` control-plane node, four namespaces, seven pods, four deployments, four services, zero ingress resources and one node-metrics record. The [latest verification](docs/verification-2026-09-14.md) records CPU/memory usage and resource readiness. These are verification observations, not hardcoded application values. Traefik, CoreDNS, metrics-server, local-path-provisioner, Flannel and K3s ServiceLB are the intended existing cluster components; the adapter discovers API resources instead of manufacturing inventory.

For a future dedicated credential, allow only `get`/`list` for core nodes/namespaces/pods/services, apps deployments, networking.k8s.io ingresses, and metrics.k8s.io nodes, plus read access to `/version`. No Secrets access or write verbs are needed. The adapter does not enforce or grant RBAC permissions; a missing permission marks that resource unavailable. No RBAC or deployment manifests are created in this milestone.

## UI and remaining work

The original layout is preserved. Apollo cards prefer configured Prometheus readings, with explicit Proxmox data as fallback. VM states, cluster counts/version/pod summaries, alert counts/list and adapter states come from the API. No generated demo telemetry remains. Intended host/service inventory and network topology remain static and labeled; absent firewall/NAT/mesh telemetry is unknown. The camera remains an unconfigured placeholder. A failed refresh retains previous readings under a stale/error notice and their last-sync timestamp.

Pending: verify Athena guest filesystem attribution and any additional host PromQL selectors; add richer views for resource data already collected; implement Loki log/event queries, Grafana alert coverage and authentication; then prepare Kubernetes deployment manifests in a later milestone. Nothing has been installed on Hermes.

The Dockerfile builds the application image with `npm ci`; `.dockerignore` excludes local environment files, cluster credentials and archives. Optional local Compose reads `.env.local` and binds localhost. If using local Compose with file-based credentials, supply those files through an explicit read-only mount you control; host file paths do not exist automatically in the container. Production remains targeted at Hermes/K3s.

Protocol references: [Proxmox API](https://pve.proxmox.com/wiki/Proxmox_VE_API), [Prometheus HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/), [Kubernetes API concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/) and [official JavaScript client](https://github.com/kubernetes-client/javascript).
