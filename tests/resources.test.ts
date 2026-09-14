import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeNodeMetrics, normalizePodMetrics, uniqueMetrics } from "../app/lib/adapters/kubernetes-metrics";
import { getKubernetesStatus, normalizePod, listResources } from "../app/lib/adapters/kubernetes";
import { nodeResources, podResources } from "../app/lib/infrastructure/resources";
import { reading, TelemetryFailure, unavailable } from "../app/lib/adapters/shared";
import { hosts } from "../app/lib/config/hosts";
import { isInfrastructureResponse } from "../app/lib/infrastructure/contract";
import { collectInfrastructure } from "../app/lib/infrastructure/collect";
const now = Date.now();
const timestamp = new Date(now - 10000).toISOString();
const sample = { metadata: { name: "hermes" }, timestamp, window: "30s", usage: { cpu: "200m", memory: "128Mi" } };
const podSample = { metadata: { name: "worker", namespace: "default", token: "test-private-marker" }, timestamp, window: "30s", containers: [{ name: "app", usage: { cpu: "200m", memory: "128Mi" } }, { name: "sidecar", usage: { cpu: "10m", memory: "8Mi" } }] };
const pod = normalizePod({ metadata: { name: "worker", namespace: "default" }, spec: { containers: [{ name: "app" }, { name: "sidecar" }] }, status: { phase: "Running", containerStatuses: ["app", "sidecar"].map(name => ({ name, ready: true, restartCount: 0, state: { running: {} } })) } });

test("node metrics preserve source sampling and convert CPU/memory independently", async () => {
  const result = nodeResources("hermes", await reading(async () => [normalizeNodeMetrics(sample, now)]));
  assert.equal(result.cpu, .2); assert.equal(result.memory, 128 * 1024 ** 2);
  assert.equal(result.sample?.sampledAt, timestamp); assert.equal(result.state, "Recent at sync");
  const partial = normalizeNodeMetrics({ ...sample, usage: { cpu: "invalid", memory: "128Mi" } }, now);
  assert.equal(partial.cpu, null); assert.equal(partial.memory, "128Mi"); assert.equal(partial.error?.code, "invalid_response");
});
test("pod totals use exact namespace/container matches and expose individual container samples", async () => {
  const metrics = normalizePodMetrics(podSample, now);
  const result = podResources(pod, await reading(async () => [metrics]));
  assert.equal(result.cpu, .21000000000000002); assert.equal(result.memory, 136 * 1024 ** 2); assert.ok(result.complete);
  assert.deepEqual(result.containers.map(c => c.cpu), [.2, .01]);
  assert.equal(podResources({ ...pod, namespace: "different" }, await reading(async () => [metrics])).cpu, null);
  assert.ok(!JSON.stringify(metrics).includes("test-private-marker"));
});
test("partial container samples never manufacture totals and preserve usable siblings", async () => {
  for (const containers of [podSample.containers.slice(0, 1), [{ name: "app", usage: { cpu: "bad", memory: "128Mi" } }, podSample.containers[1]]]) {
    const result = podResources(pod, await reading(async () => [normalizePodMetrics({ ...podSample, containers }, now)]));
    assert.equal(result.cpu, null); assert.equal(result.complete, false);
    assert.equal(result.containers[0].memory, 128 * 1024 ** 2);
  }
});
test("missing and failed metrics stay unavailable while real zero usage survives", async () => {
  for (const metrics of [undefined, unavailable<any>("unconfigured", "Not configured"), unavailable<any>("upstream", "Source returned HTTP 404."), await reading(async () => [])]) {
    assert.equal(podResources(pod, metrics).cpu, null); assert.equal(nodeResources("hermes", metrics).memory, null);
  }
  const missing = normalizeNodeMetrics({ ...sample, usage: {} }, now); assert.equal(missing.cpu, null); assert.equal(missing.error?.code, "unavailable");
  assert.equal(nodeResources("hermes", await reading(async () => [normalizeNodeMetrics({ ...sample, usage: { cpu: "0", memory: "0" } }, now)])).cpu, 0);
});
test("stale metrics keep their original timestamp and future/malformed samples cannot look current", async () => {
  const old = new Date(now - 600000).toISOString();
  const result = nodeResources("hermes", await reading(async () => [normalizeNodeMetrics({ ...sample, timestamp: old }, now)]));
  assert.equal(result.state, "Older at sync"); assert.equal(result.cpu, .2); assert.equal(result.sample?.sampledAt, old);
  const pods = podResources(pod, await reading(async () => [normalizePodMetrics({ ...podSample, timestamp: old }, now)]));
  assert.equal(pods.state, "Unavailable"); assert.equal(pods.sample?.sampledAt, old);
  assert.equal(pods.cpu, null); assert.equal(pods.memory, null);
  assert.ok(pods.containers.every(container => container.cpu === null && container.memory === null));
  for (const timestamp of [undefined, "bad", new Date(now + 60000).toISOString()]) {
    const metric = normalizeNodeMetrics({ ...sample, timestamp }, now); assert.equal(metric.cpu, null); assert.equal(metric.error?.code, "invalid_response");
  }
  assert.equal(normalizePodMetrics({ ...podSample, window: "invalid" }, now).containers[0].cpu, null);
});
test("ambiguous or malformed metric identities are rejected without leaking raw material", () => {
  for (const value of [{ ...podSample, metadata: { name: "worker" } }, { ...podSample, containers: [{ name: "app" }, { name: "app" }] }, { ...podSample, containers: null }]) assert.throws(() => normalizePodMetrics(value, now));
  assert.throws(() => uniqueMetrics([normalizePodMetrics(podSample, now), normalizePodMetrics(podSample, now)]));
});
test("Kubernetes metrics endpoints fail independently and preserve inventory and sanitized telemetry", async () => {
  for (const failure of [null, "nodes", "pods"]) {
    const paths: string[] = [];
    const result = await getKubernetesStatus(hosts.find(h => h.id === "hermes")!, async () => ({ base: "https://10.0.0.1", options: {}, close: async () => {} }), async (_base, path) => {
      paths.push(path);
      if (path === "/version") return { gitVersion: "v1.test" };
      if (path.includes("metrics.k8s.io")) {
        if (failure && path.split("?")[0].endsWith(`/${failure}`)) throw new TelemetryFailure("unauthorized", "Source returned HTTP 403.");
        return { items: [path.includes("/pods") ? podSample : sample] };
      }
      return { items: [] };
    });
    assert.ok(paths.some(path => path.startsWith("/apis/metrics.k8s.io/v1beta1/pods")));
    assert.equal(result.data?.nodeMetrics.state, failure === "nodes" ? "unavailable" : "available");
    assert.equal(result.data?.podMetrics?.state, failure === "pods" ? "unavailable" : "available");
    assert.deepEqual(result.data?.pods.data, []); assert.ok(!JSON.stringify(result).includes("test-private-marker"));
  }
});
test("invalid pagination cannot silently truncate Kubernetes inventory", async () => {
  await assert.rejects(listResources("https://10.0.0.1", "/api/v1/pods", {}, async () => ({ items: [], metadata: { continue: 123 } })));
});
test("browser contract rejects nested render hazards while accepting unavailable independent sources", async () => {
  const result = await collectInfrastructure({ proxmox: async () => { throw Error("private-marker"); }, prometheus: async () => { throw Error("private-marker"); }, loki: async () => { throw Error("private-marker"); }, kubernetes: async () => getKubernetesStatus(hosts.find(h => h.id === "hermes")!, async () => ({ base: "https://10.0.0.1", options: {}, close: async () => {} }), async (_base, path) => path === "/version" ? { gitVersion: "v1.test" } : { items: path.includes("metrics.k8s.io") ? [path.includes("/pods") ? podSample : sample] : [] }) });
  assert.ok(isInfrastructureResponse(result));
  for (const mutate of [(d: any) => { d.nodeMetrics.data[0].cpu = {}; }, (d: any) => { d.podMetrics.data[0].containers[0].memory = []; }, (d: any) => { d.nodes.data = [{}]; }, (d: any) => { d.pods.state = "unavailable"; }]) {
    const copy = structuredClone(result); mutate(copy.hosts[2].adapters.kubernetes!.data); assert.equal(isInfrastructureResponse(copy), false);
  }
  assert.ok(!JSON.stringify(result).includes("private-marker"));
});

test("missing namespaces cannot attribute Kubernetes workloads to default", () => {
  assert.throws(() => normalizePod({ metadata: { name: "worker" }, spec: { containers: [] } }));
});
