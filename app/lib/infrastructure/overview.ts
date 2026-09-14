import type { AdapterStatus, InfrastructureResponse, Reading, TelemetryError } from "../types/infrastructure";

export const unavailable = "Unavailable";
export function valueOf<T>(reading: Reading<T> | null | undefined): T | null {
  return reading?.state === "available" ? reading.data ?? null : null;
}
export function listOf<T>(reading: Reading<T[]> | null | undefined): T[] | null {
  const value = valueOf(reading);
  return Array.isArray(value) && value.every(item => item != null) ? value : null;
}
export function reason(error?: TelemetryError | null): string {
  if (error?.code === "unconfigured") return "Not configured";
  if (error?.code === "unavailable") return unavailable;
  return error ? "Error" : unavailable;
}
export function readingLabel(reading?: Reading<unknown> | null): string {
  return reading?.state === "available" && reading.data != null ? "Available" : reason(reading?.error);
}
export function adapterLabel(adapter?: AdapterStatus<unknown>): string {
  if (!adapter) return unavailable;
  return ({ ok: "Connected", partial: "Partial", error: "Error", unreachable: "Unavailable", unconfigured: "Not configured" })[adapter.state] ?? unavailable;
}
export function percent(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? `${value.toFixed(1)}%` : unavailable;
}
export function bytes(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return unavailable;
  if (value === 0) return "0 B";
  const index = Math.min(4, Math.max(0, Math.floor(Math.log(value) / Math.log(1024))));
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${["B", "KiB", "MiB", "GiB", "TiB"][index]}`;
}
export function duration(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return unavailable;
  const days = Math.floor(seconds / 86400); const hours = Math.floor(seconds % 86400 / 3600);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${Math.floor(seconds % 3600 / 60)}m` : `${Math.floor(seconds / 60)}m`;
}
export function observation(value: string | null | undefined): string {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 19)} UTC` : "Not observed";
}

// Kubernetes quantity syntax: SI, binary SI, and decimal exponent. Invalid data stays absent.
export function quantity(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d+(?:\.\d*)?|\.\d+)([eE][+-]?\d+|[numkKMGTPE]|[KMGTPE]i)?$/.exec(value);
  if (!match) return null;
  const factors: Record<string, number> = { n: 1e-9, u: 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18, Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5, Ei: 1024 ** 6 };
  const suffix = match[2] ?? "";
  const result = Number(match[1]) * (suffix ? factors[suffix] ?? 10 ** Number(suffix.slice(1)) : 1);
  return Number.isFinite(result) && result >= 0 ? result : null;
}
export function freshness(sampledAt: string | null | undefined, observedAt: string | null | undefined, threshold = 120): string {
  const sample = sampledAt ? Date.parse(sampledAt) : NaN; const observed = observedAt ? Date.parse(observedAt) : NaN;
  if (!Number.isFinite(sample) || !Number.isFinite(observed)) return unavailable;
  const age = (observed - sample) / 1000;
  if (age < -5) return "Invalid timestamp";
  return age <= threshold ? "Recent at sync" : "Older at sync";
}
export function deploymentReadiness(items: { desired: number | null; ready: number | null }[] | null) {
  if (!items) return null;
  const known = items.filter(item => item.desired != null && item.ready != null);
  return { total: items.length, ready: known.filter(item => item.ready! >= item.desired!).length, unknown: items.length - known.length };
}

export function isInfrastructureResponse(value: unknown): value is InfrastructureResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== 1 || v.ok !== true || typeof v.timestamp !== "string" || !Number.isFinite(Date.parse(v.timestamp)) || !Array.isArray(v.hosts)) return false;
  const ids = new Set<string>();
  return v.hosts.length > 0 && v.hosts.every(item => {
    if (!item || typeof item !== "object" || !item.host || typeof item.host.id !== "string" || ids.has(item.host.id) || !["online", "offline", "unknown"].includes(item.status) || !item.adapters || typeof item.adapters !== "object" || Array.isArray(item.adapters)) return false;
    ids.add(item.host.id);
    return Object.entries(item.adapters).every(([kind, adapter]) => {
      if (!adapter || typeof adapter !== "object" || !("state" in adapter) || !["ok", "partial", "error", "unreachable", "unconfigured"].includes(String(adapter.state))) return false;
      if (!("data" in adapter) || adapter.data == null) return true;
      if (typeof adapter.data !== "object" || Array.isArray(adapter.data)) return false;
      const data = adapter.data as Record<string, unknown>;
      const checks: Record<string, (row: Record<string, unknown>) => boolean> = kind === "kubernetes" ? {
        nodes: row => typeof row.name === "string" && Array.isArray(row.roles) && !!row.capacity && typeof row.capacity === "object",
        pods: row => typeof row.name === "string" && Array.isArray(row.containers) && row.containers.every(c => c && typeof c === "object"),
        deployments: row => typeof row.name === "string",
        services: row => typeof row.name === "string" && Array.isArray(row.ports) && row.ports.every(p => p && typeof p === "object"),
        ingresses: row => typeof row.name === "string" && Array.isArray(row.hosts),
        nodeMetrics: row => typeof row.name === "string",
      } : kind === "proxmox" ? { nodes: row => typeof row.id === "string", vms: row => typeof row.id === "string", storage: row => typeof row.id === "string" } : kind === "prometheus" ? { targets: () => true, alerts: row => typeof row.name === "string", containers: row => typeof row.name === "string" && typeof row.lastSeenAt === "string" } : {};
      for (const [key, check] of Object.entries(checks)) {
        const reading = data[key] as Reading<unknown> | undefined;
        if (reading?.state === "available" && (!Array.isArray(reading.data) || !reading.data.every(row => row && typeof row === "object" && check(row)))) return false;
      }
      const namespaces = data.namespaces as Reading<unknown> | undefined;
      return namespaces?.state !== "available" || (Array.isArray(namespaces.data) && namespaces.data.every(name => typeof name === "string"));
    });
  });
}
