import "server-only";
import type { ContainerObservation, MetricSample, Reading } from "../types/infrastructure";
import { normalizeContainers } from "./observations";
import { array, object, reading, request, TelemetryFailure, unavailable, type TransportOptions } from "./shared";

// Join by source and container identity only on the server; never serialize raw labels.
function identity(value: unknown): string {
  const labels = object(value);
  const parts = [labels.job, labels.instance, labels.id, labels.name];
  if (!parts.every(part => typeof part === "string" && part.trim())) {
    throw new TelemetryFailure("invalid_response", "Container metric identity is incomplete.");
  }
  return JSON.stringify(parts);
}

function metrics(value: unknown): Map<string, MetricSample> {
  const body = object(value); const data = object(body.data);
  if (body.status !== "success" || data.resultType !== "vector") throw new TelemetryFailure("invalid_response", "Container resource query must return a successful vector.");
  const rows = array(data.result);
  if (rows.length > 4000) throw new TelemetryFailure("unavailable", "Container series exceed the collection limit.");
  const result = new Map<string, MetricSample>();
  for (const row of rows) {
    const item = object(row); const key = identity(item.metric); const pair = array(item.value);
    const value = typeof pair[1] === "string" && pair[1].trim() ? Number(pair[1]) : NaN;
    const date = new Date(typeof pair[0] === "number" ? pair[0] * 1000 : NaN);
    if (result.has(key) || !Number.isFinite(value) || value < 0 || !Number.isFinite(date.getTime()) || date.getTime() <= 0 || date.getTime() > Date.now() + 5000) {
      throw new TelemetryFailure("invalid_response", "Container resource samples are invalid or ambiguous.");
    }
    result.set(key, { value, sampledAt: date.toISOString() });
  }
  return result;
}

export async function getContainerObservations(base: string, expression: string, options: TransportOptions, transport = request): Promise<Reading<ContainerObservation[]>> {
  return reading(async () => {
    const now = Date.now();
    const query = (query: string) => transport(base, `/api/v1/query?${new URLSearchParams({ query, time: String(now / 1000), timeout: "4s" })}`, options);
    // Reuse the configured observation scope, never guess a different host or exporter.
    const selector = /^container_last_seen(\{[^{}]+\})$/.exec(expression)?.[1];
    const cpu = selector ? `container_cpu_usage_seconds_total${selector.slice(0, -1)},cpu="total"}` : null;
    const memory = selector ? `container_memory_working_set_bytes${selector}` : null;
    const resource = (expression: string | null) => expression
      ? reading(async () => metrics(await query(expression)))
      : Promise.resolve(unavailable<Map<string, MetricSample>>("unavailable", "Container resource queries require a direct last-seen selector."));
    const [observed, cpuReadings, memoryReadings] = await Promise.all([
      query(expression),
      // Reject old source samples even if Prometheus still returns a recent evaluation time.
      resource(cpu ? `rate(${cpu}[5m]) and (timestamp(${cpu}) > time() - 120)` : null),
      resource(memory ? `${memory} and (timestamp(${memory}) > time() - 120)` : null),
    ]);
    const containers = normalizeContainers(observed, now);
    const rows = array(object(object(observed).data).result);
    return containers.map((container, index) => {
      const sample = (source: Reading<Map<string, MetricSample>>): Reading<MetricSample> => {
        if (source.state === "unavailable") return { ...source, data: null };
        if (now - Date.parse(container.lastSeenAt) > 120000) return unavailable("unavailable", "Container has no recent last-seen observation.");
        try {
          const value = source.data?.get(identity(object(rows[index]).metric));
          return value ? { ...source, data: value } : unavailable("unavailable", "No recent matching container resource sample.");
        } catch {
          return unavailable("invalid_response", "Container observation identity is incomplete.");
        }
      };
      return { ...container, cpuCores: sample(cpuReadings), memoryWorkingSetBytes: sample(memoryReadings) };
    });
  });
}
