import "server-only";
import { Agent, fetch as upstreamFetch } from "undici";
import type { AdapterStatus, Reading, TelemetryError } from "../types/infrastructure";

export class TelemetryFailure extends Error {
  constructor(public code: TelemetryError["code"], message: string) { super(message); }
}
export const timestamp = () => new Date().toISOString();
export const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TelemetryFailure("invalid_response", "Upstream response has an invalid structure.");
  return value as Record<string, unknown>;
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TelemetryFailure("invalid_response", "Expected an upstream resource list.");
  return value;
}
export const string = (value: unknown): string | null => typeof value === "string" ? value : null;
export function safeError(error: unknown): TelemetryError {
  if (error instanceof TelemetryFailure) return { code: error.code, message: error.message };
  return { code: "unreachable", message: "Unable to reach the configured source; check private routing and TLS trust." };
}
export function unavailable<T>(code: TelemetryError["code"], message: string): Reading<T> {
  return { state: "unavailable", data: null, timestamp: timestamp(), error: { code, message } };
}
export async function reading<T>(read: () => Promise<T>): Promise<Reading<T>> {
  try { return { state: "available", data: await read(), timestamp: timestamp(), error: null }; }
  catch (error) { return { state: "unavailable", data: null, timestamp: timestamp(), error: safeError(error) }; }
}
export function failed<T>(error: unknown): AdapterStatus<T> {
  const safe = safeError(error);
  return { state: safe.code === "unconfigured" ? "unconfigured" : safe.code === "unreachable" || safe.code === "timeout" ? "unreachable" : "error", status: "unknown", timestamp: timestamp(), data: null, error: safe };
}
export function collected<T>(data: T, readings: Reading<unknown>[], status: AdapterStatus<T>["status"] = "online"): AdapterStatus<T> {
  return { state: readings.some(item => item.state === "unavailable") ? "partial" : "ok", status, timestamp: timestamp(), data, error: null };
}
export function endpoint(raw: string | undefined, fallback: string | null): string {
  const value = raw?.trim() || fallback;
  if (!value) throw new TelemetryFailure("unconfigured", "Source endpoint is not configured for the selected network.");
  let url: URL;
  try { url = new URL(value); } catch { throw new TelemetryFailure("configuration", "Source URL is invalid."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new TelemetryFailure("configuration", "Use an HTTP(S) endpoint without embedded credentials, query or fragment.");
  }
  return url.href.replace(/\/$/, "");
}
export type TransportOptions = { headers?: Record<string, string>; dispatcher?: Agent; signal?: AbortSignal };
// Timeouts cover headers AND response bodies. Never return upstream error bodies or URLs.
export async function request(base: string, path: string, options: TransportOptions = {}, json = true): Promise<unknown> {
  const timeout = AbortSignal.timeout(5000);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  try {
    const response = await upstreamFetch(`${base}${path}`, { ...options, signal, redirect: "error" });
    if (!response.ok) {
      await response.body?.cancel();
      throw new TelemetryFailure(response.status === 401 || response.status === 403 ? "unauthorized" : "upstream", `Source returned HTTP ${response.status}.`);
    }
    // Limit collection size; large or malformed responses must not consume unbounded memory.
    const reader = response.body?.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 8 * 1024 * 1024) {
          await reader.cancel();
          throw new TelemetryFailure("invalid_response", "Source response exceeds the collection size limit.");
        }
        chunks.push(chunk.value);
      }
    }
    const body = Buffer.concat(chunks).toString("utf8");
    if (!json) return body;
    try { return JSON.parse(body); } catch { throw new TelemetryFailure("invalid_response", "Source returned invalid JSON."); }
  } catch (error) {
    if (signal.aborted) throw new TelemetryFailure("timeout", "Source request timed out.");
    throw error;
  }
}
