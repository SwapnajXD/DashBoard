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

### Apollo

The read-only Proxmox adapter collects `/nodes`, `/cluster/resources?type=vm`, and `/cluster/resources?type=storage` independently. It normalizes status, CPU ratio/count, memory, storage capacity/use, uptime, and VM identity where returned. VM 100 maps to Athena; VM 101 maps to Hermes. Missing fields remain `null`. API visibility depends on token permissions. Apollo live verification is pending local endpoint/credential configuration.

### Athena

Prometheus is the primary metric source. Collection covers health, scrape targets, current alerts, and configured per-host instant queries. Queries must return exactly one finite sample between 0 and 100. Empty, ambiguous, invalid or missing series are unavailable. Configure queries against the actual exporter label sets; Olympus does not guess host selectors.

For example, adapt the `instance` selector below to a verified Node Exporter target before configuring an Athena CPU query:

```promql
100 * (1 - avg(rate(node_cpu_seconds_total{instance="YOUR_NODE_EXPORTER_INSTANCE",mode="idle"}[5m])))
```

Use Node Exporter or Proxmox Exporter series already scraped by Athena for Apollo, and Hermes series when available. Unconfigured queries remain unavailable. No exporter or other monitoring component is installed by Olympus.

Loki reports readiness and label count. Grafana/Alloy/exporter service states remain unknown unless a dedicated verified source is added; Prometheus reachability does not imply every observability service is healthy. Athena live verification is pending endpoint and query configuration. Prometheus alerts do not represent Grafana-managed alert rules.

### Hermes

The server-side adapter uses the official JavaScript client's kubeconfig handling and makes read-only API requests for version, nodes, namespaces, pods (including regular/init/ephemeral container state), deployments, services, networking/v1 ingresses and metrics.k8s.io node usage. CPU/memory capacity, allocatable resources and usage retain Kubernetes quantity units and sample timestamps. Prometheus remains the primary historical host telemetry source; metrics-server usage is a current Kubernetes snapshot.

Live read-only verification on 2026-09-12 succeeded using Artemis's existing `hermes` context: K3s `v1.36.4+k3s1`, one Ready `hermes` control-plane node, four namespaces, seven pods, four deployments, four services, zero ingress resources and one node-metrics record. These are verification observations, not hardcoded application values. Traefik, CoreDNS, metrics-server, local-path-provisioner, Flannel and K3s ServiceLB are the intended existing cluster components; the adapter discovers API resources instead of manufacturing inventory.

For a future dedicated credential, allow only `get`/`list` for core nodes/namespaces/pods/services, apps deployments, networking.k8s.io ingresses, and metrics.k8s.io nodes, plus read access to `/version`. No Secrets access or write verbs are needed. The adapter does not enforce or grant RBAC permissions; a missing permission marks that resource unavailable. No RBAC or deployment manifests are created in this milestone.

## UI and remaining work

The original layout is preserved. Apollo cards prefer configured Prometheus readings, with explicit Proxmox data as fallback. VM states, cluster counts/version/pod summaries, alert counts/list and adapter states come from the API. No generated demo telemetry remains. Intended host/service inventory and network topology remain static and labeled; absent firewall/NAT/mesh telemetry is unknown. The camera remains an unconfigured placeholder. A failed refresh retains previous readings under a stale/error notice and their last-sync timestamp.

Pending: configure and verify live Apollo/Athena sources and PromQL selectors; add richer views for resource data already collected; implement Loki log/event queries, Grafana alert coverage and authentication; then prepare Kubernetes deployment manifests in the next milestone. Nothing has been installed on Hermes.

The Dockerfile builds the application image with `npm ci`; `.dockerignore` excludes local environment files, cluster credentials and archives. Optional local Compose reads `.env.local` and binds localhost. If using local Compose with file-based credentials, supply those files through an explicit read-only mount you control; host file paths do not exist automatically in the container. Production remains targeted at Hermes/K3s.

Protocol references: [Proxmox API](https://pve.proxmox.com/wiki/Proxmox_VE_API), [Prometheus HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/), [Kubernetes API concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/) and [official JavaScript client](https://github.com/kubernetes-client/javascript).
