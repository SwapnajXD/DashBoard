import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { bytes, duration, quantity, valueOf, listOf, freshness, deploymentReadiness, readingLabel, adapterLabel, isInfrastructureResponse } from "../app/lib/infrastructure/overview";
import { ratioPercent } from "../app/lib/infrastructure/presentation";
import { normalizeContainers, normalizeRecentLogs } from "../app/lib/adapters/observations";
import { getLokiStatus } from "../app/lib/adapters/loki";
import { getPrometheusStatus } from "../app/lib/adapters/prometheus";
import { collectInfrastructure } from "../app/lib/infrastructure/collect";
import { hosts } from "../app/lib/config/hosts";
import { collected, failed, reading, TelemetryFailure, unavailable } from "../app/lib/adapters/shared";
import { normalizeProxmox } from "../app/lib/adapters/proxmox";
import type { KubernetesData } from "../app/lib/types/infrastructure";

const env = { ...process.env };
afterEach(() => { for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); });
const athena = hosts.find(h => h.id === "athena")!;
const end = 1700000100000;
const streams = (result: unknown[]) => ({ status: "success", data: { resultType: "streams", result } });
const containerVector = (result: unknown[]) => ({ status: "success", data: { resultType: "vector", result } });

test("overview converts Kubernetes quantities without manufacturing missing usage", () => {
  for (const [raw, value] of [["33277469n", .033277469], ["400m", .4], ["912416Ki", 934313984], ["4", 4], ["1Gi", 1073741824], ["1e3", 1000]] as const) assert.ok(Math.abs(quantity(raw)! - value) < 1e-8);
  for (const raw of [undefined, "", "NaN", "-1", "10invalid", "1e999", "Infinity"]) assert.equal(quantity(raw), null);
  assert.equal(bytes(null), "Unavailable"); assert.equal(bytes(0), "0 B");
  assert.equal(duration(null), "Unavailable"); assert.equal(duration(90061), "1d 1h");
  assert.equal(ratioPercent(null, 100), null); assert.equal(ratioPercent(-1, 100), null); assert.equal(ratioPercent(101, 100), null); assert.equal(ratioPercent(0, 100), 0);
});

test("overview preserves empty lists, zero values, unavailable and error distinctions", async () => {
  assert.equal(valueOf(await reading(async () => 0)), 0);
  assert.deepEqual(listOf(await reading(async () => [])), []);
  assert.equal(listOf(unavailable<unknown[]>("unconfigured", "Missing")), null);
  assert.equal(readingLabel(unavailable("unconfigured", "Missing")), "Not configured");
  assert.equal(readingLabel(unavailable("invalid_response", "Malformed")), "Error");
  assert.equal(adapterLabel(failed(new Error("Connection failed"))), "Unavailable");
  assert.equal(readingLabel(undefined), "Unavailable");
});

test("freshness never presents old or future samples as current", () => {
  const at = new Date(end).toISOString();
  assert.equal(freshness(new Date(end - 20000).toISOString(), at), "Recent at sync");
  assert.equal(freshness(new Date(end - 300000).toISOString(), at), "Older at sync");
  assert.equal(freshness(new Date(end + 60000).toISOString(), at), "Invalid timestamp");
  assert.equal(freshness(null, at), "Unavailable");
  assert.deepEqual(deploymentReadiness([{ desired: 1, ready: null }, { desired: 1, ready: 1 }, { desired: 0, ready: 0 }]), { total: 3, ready: 2, unknown: 1 });
  assert.equal(deploymentReadiness(null), null);
});

test("Loki metadata discards log bodies and labels and respects window/entry limits", () => {
  const result = normalizeRecentLogs(streams([{ stream: { secret: "private-fixture" }, values: [[String(BigInt(end - 1000) * BigInt(1000000)), "private-fixture"]] }]), end);
  assert.equal(result.inspectedEntries, 1); assert.equal(result.latestEntryAt, new Date(end - 1000).toISOString());
  assert.ok(!JSON.stringify(result).includes("private-fixture"));
  assert.equal(normalizeRecentLogs(streams([]), end).latestEntryAt, null);
  for (const pair of [["bad", "line"], [String(BigInt(end + 60000) * BigInt(1000000)), "line"], ["1", "line"], [String(BigInt(end) * BigInt(1000000)), null]]) assert.throws(() => normalizeRecentLogs(streams([{ values: [pair] }]), end));
  assert.throws(() => normalizeRecentLogs(streams([{ values: Array.from({ length: 21 }, () => [String(BigInt(end) * BigInt(1000000)), "line"]) }]), end));
  assert.throws(() => normalizeRecentLogs({ status: "success", data: { resultType: "vector", result: [] } }, end));
});

test("cAdvisor projection rejects ambiguous names and malformed timestamps without leaking labels", () => {
  const row = { metric: { name: "web", secret: "private-fixture" }, value: [end / 1000, String((end - 1000) / 1000)] };
  const result = normalizeContainers(containerVector([row]), end);
  assert.deepEqual(result, [{ name: "web", lastSeenAt: new Date(end - 1000).toISOString() }]);
  assert.ok(!JSON.stringify(result).includes("private-fixture"));
  assert.deepEqual(normalizeContainers(containerVector([]), end), []);
  assert.throws(() => normalizeContainers(containerVector([row, row]), end));
  for (const value of ["NaN", "", "-1", String(end / 1000 + 100)]) assert.throws(() => normalizeContainers(containerVector([{ ...row, value: [end / 1000, value] }]), end));
});

test("optional Loki observation failures preserve readiness and label availability", async () => {
  process.env.LOKI_URL = "https://loki.test"; process.env.LOKI_RECENT_LOG_QUERY = '{container=~".+"}';
  const result = await getLokiStatus(athena, async (_base, path) => {
    if (path === "/ready") return "ready";
    if (path.endsWith("/labels")) return { status: "success", data: ["container"] };
    const url = new URL(path, "https://loki.test");
    assert.equal(url.searchParams.get("limit"), "20"); assert.equal(url.searchParams.get("direction"), "backward");
    assert.equal(BigInt(url.searchParams.get("end")!) - BigInt(url.searchParams.get("start")!), BigInt(900000000000));
    throw new TelemetryFailure("unauthorized", "Source returned HTTP 403.");
  });
  assert.equal(result.state, "partial"); assert.equal(result.data?.ready, true); assert.equal(result.data?.labelCount.data, 1);
  assert.equal(result.data?.recentLogs?.data, null); assert.equal(result.data?.recentLogs?.error?.code, "unauthorized");
});

test("optional container query failure preserves Prometheus health and targets", async () => {
  process.env.PROMETHEUS_URL = "https://prometheus.test"; process.env.PROMETHEUS_CONTAINER_QUERY = 'container_last_seen{job="cadvisor"}';
  const result = await getPrometheusStatus(athena, async (_base, path) => {
    if (path === "/-/healthy") return "healthy";
    if (path.endsWith("targets")) return { status: "success", data: { activeTargets: [] } };
    if (path.endsWith("alerts")) return { status: "success", data: { alerts: [] } };
    throw new Error("private-fixture");
  });
  assert.equal(result.data?.healthy, true); assert.deepEqual(result.data?.targets.data, []);
  assert.equal(result.data?.containers?.data, null); assert.ok(!JSON.stringify(result).includes("private-fixture"));
});

test("overview accepts independently successful hosts and rejects malformed resource payloads", async () => {
  const px = { nodes: await reading(async () => [normalizeProxmox({ node: "apollo", cpu: 0.2 }, "node")]), vms: await reading(async () => []), storage: await reading(async () => []) };
  const kd: KubernetesData = { apiReachable: true, version: await reading(async () => "v1.fixture"), nodes: await reading(async () => []), namespaces: await reading(async () => ["default"]), pods: await reading(async () => []), deployments: await reading(async () => []), services: await reading(async () => []), ingresses: await reading(async () => []), nodeMetrics: await reading(async () => []) };
  const result = await collectInfrastructure({ proxmox: async () => collected(px, [], "online"), prometheus: async () => failed(new Error("private-fixture")), loki: async () => collected({ ready: true, labelCount: await reading(async () => 3) }, []), kubernetes: async () => collected(kd, []) });
  assert.ok(isInfrastructureResponse(result)); assert.equal(result.hosts[0].status, "online");
  assert.equal(result.hosts[2].adapters.kubernetes?.data?.apiReachable, true);
  assert.ok(!JSON.stringify(result).includes("private-fixture"));
  for (const invalid of [null, {}, { ...result, hosts: null }, { ...result, timestamp: "invalid" }, { ...result, hosts: [...result.hosts, result.hosts[0]] }]) assert.equal(isInfrastructureResponse(invalid), false);
  const malformed = JSON.parse(JSON.stringify(result));
  malformed.hosts[2].adapters.kubernetes.data.pods.data = [{}];
  assert.equal(isInfrastructureResponse(malformed), false);
});
