import "server-only";
import { resolveHostAddress } from "../config/hosts";
import type { AdapterStatus, HostConfig, HostMetrics, MetricSample, PrometheusData, Reading } from "../types/infrastructure";
import { array, collected, endpoint, failed, object, reading, request, string, TelemetryFailure, unavailable } from "./shared";
import { getContainerObservations } from "./cadvisor";

const timestamp = (value: unknown) => { const text = string(value); return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : null; };

// A single finite sample is required: silently taking the first series can assign another host's metrics.
export function normalizeSample(value: unknown): MetricSample {
  const body = object(value);
  if (body.status !== "success") throw new TelemetryFailure("upstream", "Prometheus query did not succeed.");
  const data = object(body.data);
  const results = array(data.result);
  if (data.resultType !== "vector" || results.length !== 1) throw new TelemetryFailure("unavailable", "Metric query must return exactly one series; check its host selector.");
  const pair = array(object(results[0]).value);
  if (typeof pair[0] !== "number" || typeof pair[1] !== "string" || pair[1].trim() === "") throw new TelemetryFailure("invalid_response", "Metric sample is invalid.");
  const numeric = Number(pair[1]);
  const date = new Date(pair[0] * 1000);
  if (!Number.isFinite(numeric) || !Number.isFinite(date.getTime())) throw new TelemetryFailure("unavailable", "Metric has no finite sample.");
  return { value: numeric, sampledAt: date.toISOString() };
}

export async function getPrometheusStatus(host: HostConfig, transport = request): Promise<AdapterStatus<PrometheusData>> {
  try {
    const address = resolveHostAddress(host, "prometheus");
    const base = endpoint(process.env.PROMETHEUS_URL, address ? `http://${address}:9090` : null);
    const options = { headers: process.env.PROMETHEUS_BEARER_TOKEN ? { Authorization: `Bearer ${process.env.PROMETHEUS_BEARER_TOKEN}` } : undefined };
    await transport(base, "/-/healthy", options, false);
    const query = (name: string): Promise<Reading<MetricSample>> => {
      const expression = process.env[name]?.trim();
      if (!expression) return Promise.resolve(unavailable("unconfigured", `${name} is not configured.`));
      return reading(async () => {
        const sample = normalizeSample(await transport(base, `/api/v1/query?${new URLSearchParams({ query: expression, timeout: "4s" })}`, options));
        if (sample.value < 0 || sample.value > 100) throw new TelemetryFailure("invalid_response", "Percentage query must return a value between 0 and 100.");
        return sample;
      });
    };
    const metricsFor = async (name: string): Promise<HostMetrics> => {
      const [cpuPercent, memoryPercent, storagePercent] = await Promise.all([query(`PROMETHEUS_${name}_CPU_QUERY`), query(`PROMETHEUS_${name}_MEMORY_QUERY`), query(`PROMETHEUS_${name}_STORAGE_QUERY`)]);
      return { cpuPercent, memoryPercent, storagePercent };
    };
    const api = async (path: string) => {
      const body = object(await transport(base, `/api/v1/${path}`, options));
      if (body.status !== "success") throw new TelemetryFailure("upstream", "Prometheus API did not succeed.");
      return object(body.data);
    };
    const containerQuery = process.env.PROMETHEUS_CONTAINER_QUERY?.trim();
    const [targets, alerts, apollo, athena, hermes, containers] = await Promise.all([
      reading(async () => array((await api("targets")).activeTargets).map(value => {
        const target = object(value); const labels = object(target.labels);
        return { job: string(labels.job), instance: string(labels.instance), health: target.health === "up" ? "online" as const : target.health === "down" ? "offline" as const : "unknown" as const, lastScrape: timestamp(target.lastScrape) };
      })),
      reading(async () => array((await api("alerts")).alerts).map(value => {
        const alert = object(value); const labels = object(alert.labels);
        return { name: string(labels.alertname) ?? "Unnamed alert", state: string(alert.state) ?? "unknown", activeAt: timestamp(alert.activeAt) };
      })),
      metricsFor("APOLLO"), metricsFor("ATHENA"), metricsFor("HERMES"),
      containerQuery ? getContainerObservations(base, containerQuery, options, transport) : undefined,
    ]);
    return collected({ healthy: true, targets, alerts, metrics: { apollo, athena, hermes }, ...(containers ? { containers } : {}) }, [targets, alerts, ...Object.values(apollo), ...Object.values(athena), ...Object.values(hermes), ...(containers ? [containers] : []), ...(containers?.data?.flatMap(container => [container.cpuCores!, container.memoryWorkingSetBytes!]) ?? [])]);
  } catch (error) { return failed(error); }
}
