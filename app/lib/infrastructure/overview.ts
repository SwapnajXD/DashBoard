import type { AdapterStatus, Reading, TelemetryError } from "../types/infrastructure";

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
  if (error?.code === "unavailable" || error?.code === "unreachable" || error?.code === "timeout") return unavailable;
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

export { quantity } from "../quantities";
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

export { isInfrastructureResponse } from "./contract";
