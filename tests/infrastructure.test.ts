import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { hosts, resolveHostAddress } from "../app/lib/config/hosts";
import { collectInfrastructure, type Collectors } from "../app/lib/infrastructure/collect";
import { infrastructureView } from "../app/lib/infrastructure/presentation";
import { getProxmoxStatus, normalizeProxmox } from "../app/lib/adapters/proxmox";
import { getPrometheusStatus, normalizeSample } from "../app/lib/adapters/prometheus";
import { getLokiStatus } from "../app/lib/adapters/loki";
import { getKubernetesStatus, isPrivateAddress, listResources, loadKubernetesConnection, normalizeNode, normalizePod } from "../app/lib/adapters/kubernetes";
import { collected, failed, reading, request, TelemetryFailure, unavailable } from "../app/lib/adapters/shared";
import type { HostConfig, ProxmoxData } from "../app/lib/types/infrastructure";

const initialEnv = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in initialEnv)) delete process.env[key];
  Object.assign(process.env, initialEnv);
});
const host = (id: string) => hosts.find(item => item.id === id)!;
const transport = (handler: (path: string) => unknown): typeof request => async (_base, path) => handler(path);
const offline = () => Promise.resolve(failed<never>(new Error("private credential marker")));
const collectors: Collectors = { proxmox: offline, prometheus: offline, loki: offline, kubernetes: offline };

test("V2 registry and selected network never fall back to LAN", () => {
  assert.deepEqual(hosts.map(item => item.id), ["apollo", "athena", "hermes", "artemis"]);
  assert.equal(host("athena").vmId, 100); assert.equal(host("hermes").vmId, 101);
  assert.deepEqual(host("athena").adapters, ["prometheus", "loki"]);
  assert.deepEqual(host("hermes").adapters, ["kubernetes"]);
  const config: HostConfig = { ...host("hermes"), network: { lan: "10.1.1.1", tailscale: "100.64.1.1" } };
  process.env.OLYMPUS_NETWORK_MODE = "tailscale";
  assert.equal(resolveHostAddress(config, "kubernetes"), null);
  assert.equal(resolveHostAddress(config, "prometheus"), "100.64.1.1");
  assert.equal(resolveHostAddress({ ...config, network: { lan: "10.1.1.1" } }, "prometheus"), null);
  process.env.OLYMPUS_NETWORK_MODE = "lan";
  assert.equal(resolveHostAddress(config, "kubernetes"), "10.1.1.1");
});

test("aggregation isolates exceptions, strips network config, and reports unknown rather than offline", async () => {
  const data = await collectInfrastructure({ ...collectors, proxmox: async () => { throw new Error("private credential marker"); } });
  assert.equal(data.hosts.length, 4);
  assert.ok(data.hosts.every(item => item.status === "unknown"));
  assert.ok(data.hosts.every(item => !('network' in item.host)));
  assert.ok(!JSON.stringify(data).includes("private credential marker"));
  assert.ok(Number.isFinite(Date.parse(data.timestamp)));
  assert.equal(data.schemaVersion, 1);
});

test("confirmed VM states supply host identity and source", async () => {
  const data: ProxmoxData = {
    nodes: await reading(async () => [normalizeProxmox({ node: "apollo", status: "online" }, "node")]),
    vms: await reading(async () => [normalizeProxmox({ type: "qemu", vmid: 100, status: "running" }), normalizeProxmox({ type: "qemu", vmid: 101, status: "stopped" })]),
    storage: await reading(async () => []),
  };
  const result = await collectInfrastructure({ ...collectors, proxmox: async () => collected(data, Object.values(data), "online") });
  assert.equal(result.hosts[1].status, "online"); assert.equal(result.hosts[2].status, "offline");
  assert.equal(result.hosts[2].statusSource, "proxmox/vm");
});

test("Proxmox preserves absent metrics, VM mapping and per-resource permission failures", async () => {
  process.env.PROXMOX_URL = "https://10.1.1.1:8006";
  process.env.PROXMOX_API_TOKEN_ID = "test-id"; process.env.PROXMOX_API_TOKEN_SECRET = "test-only-marker";
  const result = await getProxmoxStatus(host("apollo"), transport(path => {
    if (path.endsWith("/nodes")) return { data: [{ node: "apollo", status: "online", cpu: 0, mem: 1024, maxmem: 2048 }] };
    if (path.includes("type=storage")) throw new TelemetryFailure("unauthorized", "Source returned HTTP 403.");
    return { data: [{ type: "qemu", vmid: 100, status: "running" }, { type: "qemu", vmid: 101, status: "stopped" }] };
  }));
  assert.equal(result.state, "partial"); assert.equal(result.status, "online");
  assert.equal(result.data?.nodes.data?.[0].cpuRatio, 0);
  assert.equal(result.data?.nodes.data?.[0].storageTotalBytes, null);
  assert.deepEqual(result.data?.vms.data?.map(vm => vm.hostId), ["athena", "hermes"]);
  assert.equal(result.data?.storage.data, null);
  assert.ok(!JSON.stringify(result).includes("test-only-marker"));
});

test("malformed Proxmox inventory is unavailable, never a fabricated empty list", async () => {
  process.env.PROXMOX_URL = "https://10.1.1.1:8006"; process.env.PROXMOX_API_TOKEN_ID = "test"; process.env.PROXMOX_API_TOKEN_SECRET = "test";
  const result = await getProxmoxStatus(host("apollo"), transport(() => ({ data: null })));
  assert.equal(result.data, null); assert.equal(result.error?.code, "invalid_response");
});

test("Proxmox missing endpoint or credentials never attempts a request", async () => {
  const apollo = { ...host("apollo"), network: {} };
  const neverRequest: typeof request = async () => { assert.fail("Unexpected Proxmox request"); };
  delete process.env.PROXMOX_URL;
  assert.equal((await getProxmoxStatus(apollo, neverRequest)).state, "unconfigured");
  process.env.PROXMOX_URL = "https://10.1.1.1:8006";
  for (const missing of ["PROXMOX_API_TOKEN_ID", "PROXMOX_API_TOKEN_SECRET"]) {
    process.env.PROXMOX_API_TOKEN_ID = "fixture@pve!reader";
    process.env.PROXMOX_API_TOKEN_SECRET = "fixture-secret";
    delete process.env[missing];
    const result = await getProxmoxStatus(apollo, neverRequest);
    assert.equal(result.state, "unconfigured"); assert.equal(result.status, "unknown");
    assert.equal(result.data, null);
  }
});

test("Proxmox unreachable and invalid credentials return sanitized failures", async () => {
  process.env.PROXMOX_URL = "https://10.1.1.1:8006";
  process.env.PROXMOX_API_TOKEN_ID = "fixture@pve!reader";
  process.env.PROXMOX_API_TOKEN_SECRET = "fixture-secret";
  for (const error of [new Error("fixture-secret at https://10.1.1.1:8006"), new TelemetryFailure("unauthorized", "Source returned HTTP 401."), new TelemetryFailure("unauthorized", "Source returned HTTP 403.")]) {
    const result = await getProxmoxStatus(host("apollo"), transport(() => { throw error; }));
    assert.equal(result.state, error instanceof TelemetryFailure ? "error" : "unreachable");
    assert.equal(result.error?.code, error instanceof TelemetryFailure ? "unauthorized" : "unreachable");
    assert.equal(result.status, "unknown"); assert.equal(result.data, null);
    assert.ok(!JSON.stringify(result).includes("fixture-secret"));
    assert.ok(!JSON.stringify(result).includes("10.1.1.1"));
  }
});

test("Proxmox rejects malformed resource identities but preserves successful empty lists", async () => {
  process.env.PROXMOX_URL = "https://10.1.1.1:8006";
  process.env.PROXMOX_API_TOKEN_ID = "fixture@pve!reader"; process.env.PROXMOX_API_TOKEN_SECRET = "fixture-secret";
  for (const value of [{}, null, { node: "", type: "qemu", vmid: -1 }, { type: "qemu", vmid: "100" }]) {
    const result = await getProxmoxStatus(host("apollo"), transport(() => ({ data: [value] })));
    assert.equal(result.error?.code, "invalid_response"); assert.equal(result.data, null);
  }
  const empty = await getProxmoxStatus(host("apollo"), transport(() => ({ data: [] })));
  assert.equal(empty.state, "ok"); assert.equal(empty.status, "unknown");
  assert.deepEqual(empty.data?.vms.data, []);
});

test("Proxmox authentication paths and normalized resources reach the existing Apollo cards", async () => {
  process.env.PROXMOX_URL = "https://10.1.1.1:8006/";
  process.env.PROXMOX_NODE_NAME = "physical-node";
  process.env.PROXMOX_API_TOKEN_ID = "fixture@pve!reader"; process.env.PROXMOX_API_TOKEN_SECRET = "fixture-secret";
  const paths: string[] = [];
  const adapter = await getProxmoxStatus(host("apollo"), async (base, path, options) => {
    assert.equal(base, "https://10.1.1.1:8006");
    assert.equal(options?.headers?.Authorization, "PVEAPIToken=fixture@pve!reader=fixture-secret");
    paths.push(path);
    if (path.endsWith("/nodes")) return { data: [{ node: "physical-node", status: "online", cpu: 0.25, maxcpu: 8, mem: 1024, maxmem: 4096, disk: 512, maxdisk: 1024, uptime: 7200, password: "fixture-secret" }] };
    if (path.endsWith("type=storage")) return { data: [{ id: "storage/physical-node/local", type: "storage", node: "physical-node", disk: 512, maxdisk: 1024 }] };
    return { data: [{ type: "qemu", vmid: 100, name: "athena-live-name", status: "running", mem: 256, maxmem: 1024 }, { type: "qemu", vmid: 101, name: "hermes-live-name", status: "stopped" }] };
  });
  assert.deepEqual(paths.sort(), ["/api2/json/cluster/resources?type=storage", "/api2/json/cluster/resources?type=vm", "/api2/json/nodes"]);
  const result = await collectInfrastructure({ ...collectors, proxmox: async () => adapter });
  const view = infrastructureView(result);
  assert.equal(view.status("apollo"), "online");
  assert.equal(view.cpu, 25); assert.equal(view.memory, 25); assert.equal(view.storage, 50);
  assert.equal(view.apollo?.cpuCount, 8); assert.equal(view.apollo?.uptimeSeconds, 7200);
  assert.equal(view.proxmox?.vms.data?.[0].name, "athena-live-name");
  assert.equal(view.proxmox?.vms.data?.[0].memoryUsedBytes, 256);
  assert.equal(view.status("athena"), "online"); assert.equal(view.status("hermes"), "offline");
  assert.equal(view.proxmox?.storage.data?.[0].storageTotalBytes, 1024);
  assert.ok(!JSON.stringify(result).includes("fixture-secret"));
  assert.ok(!JSON.stringify(result).includes("fixture@pve"));
});

test("Apollo failure preserves healthy independent host adapters", async () => {
  const result = await collectInfrastructure({ ...collectors,
    proxmox: async () => failed(new TelemetryFailure("unauthorized", "Source returned HTTP 401.")),
    loki: async () => collected({ ready: true, labelCount: await reading(async () => 2) }, []),
  });
  assert.equal(result.hosts[0].status, "unknown");
  assert.equal(result.hosts[0].adapters.proxmox?.error?.code, "unauthorized");
  assert.equal(result.hosts[1].status, "online");
  assert.equal(result.hosts[1].adapters.loki?.data?.ready, true);
});

test("Prometheus sample rejects empty, ambiguous, NaN, and malformed vectors", () => {
  for (const result of [[], [{ value: [1, "1"] }, { value: [1, "2"] }], [{ value: [1, "NaN"] }], [{ value: [1, ""] }]]) {
    assert.throws(() => normalizeSample({ status: "success", data: { resultType: "vector", result } }));
  }
  assert.equal(normalizeSample({ status: "success", data: { resultType: "vector", result: [{ value: [100, "0"] }] } }).value, 0);
});

test("Prometheus collects real targets/alerts and leaves unconfigured host metrics unavailable", async () => {
  process.env.PROMETHEUS_URL = "http://10.1.1.2:9090";
  process.env.PROMETHEUS_ATHENA_CPU_QUERY = "test_host_cpu_percent";
  const result = await getPrometheusStatus(host("athena"), transport(path => {
    if (path === "/-/healthy") return "healthy";
    if (path.endsWith("targets")) return { status: "success", data: { activeTargets: [{ health: "down", labels: { job: "node", instance: "athena", secret: "private-marker" }, scrapeUrl: "http://private-marker" }] } };
    if (path.endsWith("alerts")) return { status: "success", data: { alerts: [{ labels: { alertname: "TargetDown", secret: "private-marker" }, annotations: { summary: "private-marker" }, state: "firing" }] } };
    return { status: "success", data: { resultType: "vector", result: [{ value: [100, "12.5"] }] } };
  }));
  assert.equal(result.state, "partial");
  assert.equal(result.data?.targets.data?.[0].health, "offline");
  assert.equal(result.data?.alerts.data?.[0].state, "firing");
  assert.equal(result.data?.metrics.athena.cpuPercent.data?.value, 12.5);
  assert.equal(result.data?.metrics.hermes.memoryPercent.data, null);
  assert.ok(!JSON.stringify(result).includes("private-marker"));
});

test("malformed Prometheus targets do not become zero healthy targets", async () => {
  process.env.PROMETHEUS_URL = "http://10.1.1.2:9090";
  const result = await getPrometheusStatus(host("athena"), transport(path => path === "/-/healthy" ? "healthy" : { status: "success", data: {} }));
  assert.equal(result.data?.targets.state, "unavailable"); assert.equal(result.data?.alerts.data, null);
});

test("Loki keeps readiness when optional labels fail and strips raw errors", async () => {
  process.env.LOKI_URL = "http://10.1.1.2:3100";
  const result = await getLokiStatus(host("athena"), transport(path => { if (path === "/ready") return "ready"; throw new Error("private upstream body"); }));
  assert.equal(result.state, "partial"); assert.equal(result.data?.ready, true);
  assert.equal(result.data?.labelCount.data, null); assert.ok(!JSON.stringify(result).includes("private upstream body"));
});

test("Kubernetes node and container status are projected without specs/credentials", () => {
  const node = normalizeNode({ metadata: { name: "hermes", labels: { "node-role.kubernetes.io/control-plane": "true" } }, status: { conditions: [{ type: "Ready", status: "True" }], capacity: { cpu: "2", memory: "2048Ki" }, nodeInfo: { kubeletVersion: "v1.36.4+k3s1" } } });
  assert.equal(node.status, "online"); assert.deepEqual(node.roles, ["control-plane"]);
  const pod = normalizePod({ metadata: { name: "olympus", namespace: "test", annotations: { secret: "private-marker" } }, spec: { containers: [{ name: "web", env: [{ name: "TOKEN", value: "private-marker" }] }], initContainers: [{ name: "init" }] }, status: { phase: "Pending", containerStatuses: [{ name: "web", ready: false, restartCount: 3, state: { waiting: { reason: "CrashLoopBackOff", message: "private-marker" } } }] } });
  assert.equal(pod.containers[0].state, "waiting"); assert.equal(pod.containers[0].restartCount, 3);
  assert.equal(pod.containers[1].state, "unknown"); assert.ok(!JSON.stringify(pod).includes("private-marker"));
  assert.equal(normalizeNode({ metadata: { name: "hermes" } }).status, "unknown");
});

test("Kubernetes private endpoint classifier rejects public addresses", () => {
  for (const address of ["10.0.0.1", "172.16.1.1", "192.168.1.1", "100.64.0.1", "127.0.0.1", "::1", "fd00::1"]) assert.ok(isPrivateAddress(address));
  for (const address of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "0.0.0.0", "2001:4860:4860::8888"]) assert.ok(!isPrivateAddress(address));
});

test("Kubernetes pagination follows continuation tokens and rejects truncated inventories", async () => {
  let count = 0;
  const result = await listResources("https://10.1.1.3", "/api/v1/pods", {}, transport(path => {
    count++;
    if (count === 1) return { items: [1], metadata: { continue: "token/value" } };
    assert.ok(path.includes("continue=token%2Fvalue")); return { items: [2], metadata: {} };
  }));
  assert.deepEqual(result, [1, 2]);
  await assert.rejects(listResources("https://10.1.1.3", "/api/v1/pods", {}, transport(() => ({ items: [], metadata: { continue: "always" } }))));
});

test("Kubernetes collection tolerates absent metrics-server API and permission errors", async () => {
  let closed = false;
  const result = await getKubernetesStatus(host("hermes"), async () => ({ base: "https://10.1.1.3", options: {}, close: async () => { closed = true; } }), transport(path => {
    if (path === "/version") return { gitVersion: "v1.36.4+k3s1" };
    if (path.includes("metrics.k8s.io")) throw new TelemetryFailure("upstream", "Source returned HTTP 404.");
    if (path.includes("deployments")) throw new TelemetryFailure("unauthorized", "Source returned HTTP 403.");
    return { items: [], metadata: {} };
  }));
  assert.equal(result.state, "partial"); assert.equal(result.data?.apiReachable, true);
  assert.equal(result.data?.nodeMetrics.data, null); assert.equal(result.data?.deployments.error?.code, "unauthorized");
  assert.deepEqual(result.data?.pods.data, []); assert.ok(closed);
});

test("Kubernetes loads only an explicit context and rejects public or insecure configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "olympus-kube-test-"));
  const path = join(directory, "config");
  process.env.KUBERNETES_KUBECONFIG = path;
  const config = (server: string, insecure = false) => JSON.stringify({ apiVersion: "v1", kind: "Config", "current-context": "hermes", clusters: [{ name: "hermes", cluster: { server, "insecure-skip-tls-verify": insecure } }], users: [{ name: "reader", user: { token: "test-only-token" } }], contexts: [{ name: "hermes", context: { cluster: "hermes", user: "reader" } }] });
  try {
    await writeFile(path, config("https://8.8.8.8:6443")); await assert.rejects(loadKubernetesConnection(), /private/);
    await writeFile(path, config("https://10.1.1.3:6443", true)); await assert.rejects(loadKubernetesConnection(), /verified TLS/);
    await writeFile(path, config("https://10.1.1.3:6443"));
    process.env.KUBERNETES_CONTEXT = "missing"; await assert.rejects(loadKubernetesConnection(), /context/);
    process.env.KUBERNETES_CONTEXT = "hermes";
    const connection = await loadKubernetesConnection(); assert.equal(connection.base, "https://10.1.1.3:6443"); await connection.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("unconfigured Kubernetes does not attempt a cluster request", async () => {
  delete process.env.KUBERNETES_KUBECONFIG; delete process.env.KUBERNETES_IN_CLUSTER;
  const result = await getKubernetesStatus(host("hermes"));
  assert.equal(result.state, "unconfigured"); assert.equal(result.data, null);
});

test("HTTP transport redacts error bodies, validates JSON, and cancels aborted requests", async () => {
  const previous = getGlobalDispatcher(); const agent = new MockAgent(); agent.disableNetConnect(); setGlobalDispatcher(agent);
  const pool = agent.get("http://telemetry.test");
  pool.intercept({ path: "/forbidden" }).reply(403, "private-token-marker");
  pool.intercept({ path: "/bad" }).reply(200, "invalid JSON");
  try {
    const forbidden = await reading(() => request("http://telemetry.test", "/forbidden"));
    assert.equal(forbidden.error?.code, "unauthorized"); assert.ok(!JSON.stringify(forbidden).includes("private-token-marker"));
    const bad = await reading(() => request("http://telemetry.test", "/bad")); assert.equal(bad.error?.code, "invalid_response");
    const aborted = await reading(() => request("http://telemetry.test", "/aborted", { signal: AbortSignal.abort() })); assert.equal(aborted.error?.code, "timeout");
  } finally { setGlobalDispatcher(previous); await agent.close(); }
});

test("presentation never substitutes fake metrics or alert counts", async () => {
  const result = await collectInfrastructure(collectors);
  const view = infrastructureView(result);
  assert.equal(view.cpu, null); assert.equal(view.memory, null); assert.equal(view.storage, null);
  assert.equal(view.firingAlerts, null); assert.equal(view.serviceStatus("Grafana"), "unknown");
  assert.equal(unavailable("unavailable", "No data").data, null);
});
