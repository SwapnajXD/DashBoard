import type { InfrastructureResponse } from "../types/infrastructure";

type Check = (value: unknown) => boolean;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text: Check = value => typeof value === "string";
const number: Check = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const bool: Check = value => typeof value === "boolean";
const oneOf = (...values: unknown[]): Check => value => values.includes(value);
const nullable = (check: Check): Check => value => value === null || check(value);
const optional = (check: Check): Check => value => value === undefined || check(value);
const list = (check: Check): Check => value => Array.isArray(value) && value.every(check);
const object = (fields: Record<string, Check>): Check => value => record(value) && Object.entries(fields).every(([key, check]) => check(value[key]));
const time: Check = value => typeof value === "string" && Number.isFinite(Date.parse(value));
const status = oneOf("online", "offline", "unknown");
const error = nullable(object({ code: oneOf("unconfigured", "unreachable", "timeout", "unauthorized", "upstream", "invalid_response", "unavailable", "configuration"), message: text }));
const reading = (data: Check): Check => value => record(value) && time(value.timestamp) && error(value.error) && (value.state === "available" ? value.error === null && data(value.data) : value.state === "unavailable" && value.data === null && value.error !== null);
const resource = object({ id: text, node: text, name: nullable(text), type: text, vmId: nullable(number), hostId: nullable(text), status, cpuRatio: nullable(number), cpuCount: nullable(number), memoryUsedBytes: nullable(number), memoryTotalBytes: nullable(number), storageUsedBytes: nullable(number), storageTotalBytes: nullable(number), uptimeSeconds: nullable(number) });
const usageFields = { cpu: nullable(text), memory: nullable(text), error: optional(error) };
const sampleFields = { sampledAt: nullable(time), window: nullable(text) };
const container = object({ name: text, kind: oneOf("container", "init", "ephemeral"), ready: nullable(bool), restartCount: nullable(number), state: oneOf("running", "waiting", "terminated", "unknown"), reason: nullable(text) });
const metric = reading(object({ value: number, sampledAt: time }));
const metrics = object({ cpuPercent: metric, memoryPercent: metric, storagePercent: metric });
const dataChecks: Record<string, Check> = {
  proxmox: object({ nodes: reading(list(resource)), vms: reading(list(resource)), storage: reading(list(resource)) }),
  prometheus: object({ healthy: oneOf(true), targets: reading(list(object({ job: nullable(text), instance: nullable(text), health: status, lastScrape: nullable(time) }))), alerts: reading(list(object({ name: text, state: text, activeAt: nullable(time) }))), metrics: object({ apollo: metrics, athena: metrics, hermes: metrics }), containers: optional(reading(list(object({ name: text, lastSeenAt: time, cpuCores: optional(metric), memoryWorkingSetBytes: optional(metric) })))) }),
  loki: object({ ready: oneOf(true), labelCount: reading(number), recentLogs: optional(reading(object({ latestEntryAt: nullable(time), inspectedEntries: number, windowSeconds: number }))) }),
  kubernetes: object({
    apiReachable: oneOf(true), version: reading(text),
    nodes: reading(list(object({ name: text, status, roles: list(text), kubeletVersion: nullable(text), capacity: object({ cpu: nullable(text), memory: nullable(text) }), allocatable: object({ cpu: nullable(text), memory: nullable(text) }) }))),
    namespaces: reading(list(text)), pods: reading(list(object({ name: text, namespace: text, node: nullable(text), phase: nullable(text), containers: list(container) }))),
    deployments: reading(list(object({ name: text, namespace: text, desired: nullable(number), ready: nullable(number), available: nullable(number) }))),
    services: reading(list(object({ name: text, namespace: text, type: nullable(text), ports: list(object({ port: number, protocol: nullable(text) })) }))),
    ingresses: reading(list(object({ name: text, namespace: text, className: nullable(text), hosts: list(text) }))),
    nodeMetrics: reading(list(object({ name: text, ...sampleFields, ...usageFields }))),
    podMetrics: optional(reading(list(object({ name: text, namespace: text, ...sampleFields, error: optional(error), containers: list(object({ name: text, ...usageFields })) })))),
  }),
};

// Validate before replacing a last-known-good browser snapshot; reject malformed nested render values.
export function isInfrastructureResponse(value: unknown): value is InfrastructureResponse {
  if (!record(value) || value.schemaVersion !== 1 || value.ok !== true || !time(value.timestamp) || !Array.isArray(value.hosts) || !value.hosts.length || Date.parse(value.timestamp as string) > Date.now() + 5000) return false;
  const ids = new Set<string>();
  return value.hosts.every(summary => {
    if (!record(summary) || !record(summary.host) || !oneOf("apollo", "athena", "hermes", "artemis")(summary.host.id) || ids.has(summary.host.id as string) || !text(summary.host.name) || !status(summary.status) || !nullable(text)(summary.statusSource) || !time(summary.timestamp) || !record(summary.adapters)) return false;
    ids.add(summary.host.id as string);
    return Object.entries(summary.adapters).every(([kind, adapter]) => {
      if (!record(adapter) || !dataChecks[kind] || !oneOf("ok", "partial", "error", "unreachable", "unconfigured")(adapter.state) || !status(adapter.status) || !time(adapter.timestamp) || !error(adapter.error)) return false;
      return adapter.data === null ? !["ok", "partial"].includes(adapter.state as string) : dataChecks[kind](adapter.data);
    });
  });
}
