import "server-only";
import { quantity } from "../quantities";
import type { KubernetesPodMetrics, KubernetesUsage, TelemetryError } from "../types/infrastructure";
import { array, object, string, TelemetryFailure } from "./shared";

const invalid = (message: string): TelemetryError => ({ code: "invalid_response", message });
function identity(value: unknown) {
  const item = object(value); const meta = object(item.metadata);
  const name = string(meta.name);
  if (!name?.trim()) throw new TelemetryFailure("invalid_response", "Kubernetes metric resource has no name.");
  return { item, meta, name };
}
function sampling(item: Record<string, unknown>, now: number) {
  const time = string(item.timestamp); const millis = time ? Date.parse(time) : NaN;
  const sampledAt = Number.isFinite(millis) && millis > 0 && millis <= now + 5000 ? new Date(millis).toISOString() : null;
  const rawWindow = string(item.window);
  const window = rawWindow && /^(?:\d+(?:\.\d+)?(?:h|m|s|ms|us|µs|ns))+$/.test(rawWindow) && /[1-9]/.test(rawWindow) ? rawWindow : null;
  return { sampledAt, window, error: !sampledAt || !window ? invalid("Metrics timestamp or sampling window is missing or invalid.") : null };
}
function usage(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { cpu: null, memory: null, error: value == null ? { code: "unavailable" as const, message: "Resource usage was not reported." } : invalid("Resource usage has an invalid structure.") };
  const item = value as Record<string, unknown>;
  const cpu = typeof item.cpu === "string" && quantity(item.cpu) !== null ? item.cpu : null;
  const memory = typeof item.memory === "string" && quantity(item.memory) !== null ? item.memory : null;
  const malformed = (item.cpu != null && cpu === null) || (item.memory != null && memory === null);
  return { cpu, memory, error: malformed ? invalid("Resource usage contains an invalid quantity.") : cpu === null || memory === null ? { code: "unavailable" as const, message: "Some resource usage was not reported." } : null };
}
export function normalizeNodeMetrics(value: unknown, now = Date.now()): KubernetesUsage & { name: string } {
  const { item, name } = identity(value); const sample = sampling(item, now); const resources = usage(item.usage);
  return { name, ...resources, ...sample, cpu: sample.error ? null : resources.cpu, memory: sample.error ? null : resources.memory, error: sample.error ?? resources.error };
}
export function normalizePodMetrics(value: unknown, now = Date.now()): KubernetesPodMetrics {
  const { item, meta, name } = identity(value); const namespace = string(meta.namespace);
  if (!namespace?.trim()) throw new TelemetryFailure("invalid_response", "Pod metrics require an explicit namespace.");
  const sample = sampling(item, now); const names = new Set<string>();
  if (!sample.error && now - Date.parse(sample.sampledAt!) > 120000) {
    sample.error = { code: "unavailable", message: "Pod resource sample is older than two minutes." };
  }
  const containers = array(item.containers).map(value => {
    const container = object(value); const name = string(container.name);
    if (!name?.trim() || names.has(name)) throw new TelemetryFailure("invalid_response", "Container metric identity is missing or ambiguous.");
    names.add(name); const resources = usage(container.usage);
    return { name, ...resources, cpu: sample.error ? null : resources.cpu, memory: sample.error ? null : resources.memory };
  });
  return { name, namespace, ...sample, containers };
}
export function uniqueMetrics<T extends { name: string; namespace?: string }>(items: T[]): T[] {
  const names = new Set<string>();
  for (const item of items) {
    const key = `${item.namespace ?? ""}/${item.name}`;
    if (names.has(key)) throw new TelemetryFailure("invalid_response", "Metric resource identity is ambiguous.");
    names.add(key);
  }
  return items;
}
