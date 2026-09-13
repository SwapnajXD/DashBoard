import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { hosts } from "../app/lib/config/hosts";
import { getPrometheusStatus } from "../app/lib/adapters/prometheus";
import { getLokiStatus } from "../app/lib/adapters/loki";
import { TelemetryFailure, type request } from "../app/lib/adapters/shared";

const initialEnv = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in initialEnv)) delete process.env[key];
  Object.assign(process.env, initialEnv);
});
const athena = { ...hosts.find(host => host.id === "athena")!, network: {} };
const sample = (value: string) => ({ status: "success", data: { resultType: "vector", result: [{ value: [1700000000, value] }] } });

test("Athena adapters do not request unconfigured endpoints", async () => {
  delete process.env.PROMETHEUS_URL; delete process.env.LOKI_URL;
  const neverRequest: typeof request = async () => { assert.fail("Unexpected upstream request"); };
  for (const adapter of [getPrometheusStatus, getLokiStatus]) {
    const result = await adapter(athena, neverRequest);
    assert.equal(result.state, "unconfigured"); assert.equal(result.data, null);
  }
});

test("Athena Prometheus uses server-side authorization and exact configured queries", async () => {
  process.env.PROMETHEUS_URL = "https://prometheus.test";
  process.env.PROMETHEUS_BEARER_TOKEN = "fixture-bearer";
  for (const key of Object.keys(process.env)) if (/^PROMETHEUS_.*_QUERY$/.test(key)) delete process.env[key];
  const cpu = '100 * pve_cpu_usage_ratio{job="proxmox",id="qemu/100"}';
  const memory = '100 * pve_memory_usage_bytes{id="qemu/100"} / pve_memory_size_bytes{id="qemu/100"}';
  process.env.PROMETHEUS_ATHENA_CPU_QUERY = cpu;
  process.env.PROMETHEUS_ATHENA_MEMORY_QUERY = memory;
  const queries: string[] = [];
  const result = await getPrometheusStatus(athena, async (base, path, options) => {
    assert.equal(base, "https://prometheus.test");
    assert.equal(options?.headers?.Authorization, "Bearer fixture-bearer");
    if (path === "/-/healthy") return "healthy";
    if (path === "/api/v1/targets") return { status: "success", data: { activeTargets: [] } };
    if (path === "/api/v1/alerts") return { status: "success", data: { alerts: [] } };
    const url = new URL(path, base);
    assert.equal(url.pathname, "/api/v1/query"); assert.equal(url.searchParams.get("timeout"), "4s");
    const query = url.searchParams.get("query")!; queries.push(query);
    return sample(query === cpu ? "0" : "82.5");
  });
  assert.deepEqual(queries.sort(), [cpu, memory].sort());
  assert.equal(result.state, "partial");
  assert.equal(result.data?.metrics.athena.cpuPercent.data?.value, 0);
  assert.equal(result.data?.metrics.athena.memoryPercent.data?.value, 82.5);
  assert.equal(result.data?.metrics.athena.storagePercent.data, null);
  assert.equal(result.data?.metrics.apollo.cpuPercent.data, null);
  assert.equal(result.data?.metrics.athena.cpuPercent.data?.sampledAt, "2023-11-14T22:13:20.000Z");
  assert.ok(!JSON.stringify(result).includes("fixture-bearer"));
});

test("Athena percentage failures preserve independent targets and healthy API status", async () => {
  process.env.PROMETHEUS_URL = "https://prometheus.test";
  process.env.PROMETHEUS_ATHENA_CPU_QUERY = "fixture_cpu";
  for (const value of ["-1", "101", "NaN"]) {
    const result = await getPrometheusStatus(athena, async (_base, path) => {
      if (path === "/-/healthy") return "healthy";
      if (path === "/api/v1/targets") return { status: "success", data: { activeTargets: [] } };
      if (path === "/api/v1/alerts") throw new TelemetryFailure("unauthorized", "Source returned HTTP 403.");
      return sample(value);
    });
    assert.equal(result.state, "partial"); assert.equal(result.data?.healthy, true);
    assert.deepEqual(result.data?.targets.data, []);
    assert.equal(result.data?.metrics.athena.cpuPercent.state, "unavailable");
    assert.equal(result.data?.alerts.error?.code, "unauthorized");
  }
});

test("Athena adapter connection and authorization failures remain sanitized", async () => {
  process.env.PROMETHEUS_URL = "https://prometheus.test"; process.env.LOKI_URL = "https://loki.test";
  for (const adapter of [getPrometheusStatus, getLokiStatus]) {
    for (const error of [new Error("fixture-secret"), new TelemetryFailure("unauthorized", "Source returned HTTP 401.")]) {
      const result = await adapter(athena, async () => { throw error; });
      assert.equal(result.state, error instanceof TelemetryFailure ? "error" : "unreachable");
      assert.equal(result.status, "unknown"); assert.equal(result.data, null);
      assert.ok(!JSON.stringify(result).includes("fixture-secret"));
    }
  }
});

test("Loki label metadata validates names and keeps token and tenant server-side", async () => {
  process.env.LOKI_URL = "https://loki.test";
  process.env.LOKI_BEARER_TOKEN = "fixture-bearer"; process.env.LOKI_TENANT_ID = "fixture-tenant";
  for (const labels of [[], ["service_name", "container"], [null], [42], [""], [{}]]) {
    const result = await getLokiStatus(athena, async (base, path, options) => {
      assert.equal(base, "https://loki.test");
      assert.equal(options?.headers?.Authorization, "Bearer fixture-bearer");
      assert.equal(options?.headers?.["X-Scope-OrgID"], "fixture-tenant");
      if (path === "/ready") return "ready";
      assert.equal(path, "/loki/api/v1/labels");
      return { status: "success", data: labels };
    });
    const valid = labels.every(label => typeof label === "string" && label.length > 0);
    assert.equal(result.state, valid ? "ok" : "partial");
    assert.equal(result.data?.ready, true);
    assert.equal(result.data?.labelCount.data, valid ? labels.length : null);
    if (!valid) assert.equal(result.data?.labelCount.error?.code, "invalid_response");
    assert.ok(!JSON.stringify(result).includes("fixture-bearer"));
    assert.ok(!JSON.stringify(result).includes("fixture-tenant"));
  }
});
