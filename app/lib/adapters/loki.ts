import "server-only";
import { resolveHostAddress } from "../config/hosts";
import type { AdapterStatus, HostConfig, LokiData } from "../types/infrastructure";
import { array, collected, endpoint, failed, object, reading, request, TelemetryFailure } from "./shared";
import { normalizeRecentLogs } from "./observations";

export async function getLokiStatus(host: HostConfig, transport = request): Promise<AdapterStatus<LokiData>> {
  try {
    const address = resolveHostAddress(host, "loki");
    const base = endpoint(process.env.LOKI_URL, address ? `http://${address}:3100` : null);
    const headers: Record<string, string> = {};
    if (process.env.LOKI_BEARER_TOKEN) headers.Authorization = `Bearer ${process.env.LOKI_BEARER_TOKEN}`;
    if (process.env.LOKI_TENANT_ID) headers["X-Scope-OrgID"] = process.env.LOKI_TENANT_ID;
    await transport(base, "/ready", { headers }, false);
    const logQuery = process.env.LOKI_RECENT_LOG_QUERY?.trim();
    const [labelCount, recentLogs] = await Promise.all([reading(async () => {
      const body = object(await transport(base, "/loki/api/v1/labels", { headers }));
      if (body.status !== "success") throw new TelemetryFailure("upstream", "Loki label query did not succeed.");
      const labels = array(body.data);
      if (labels.some(label => typeof label !== "string" || !label.trim())) {
        throw new TelemetryFailure("invalid_response", "Loki label names are invalid.");
      }
      return labels.length;
    }), logQuery ? reading(async () => {
      const end = Date.now();
      const params = new URLSearchParams({ query: logQuery, start: String(BigInt(end - 900000) * BigInt(1000000)), end: String(BigInt(end) * BigInt(1000000)), limit: "20", direction: "backward" });
      return normalizeRecentLogs(await transport(base, `/loki/api/v1/query_range?${params}`, { headers }), end);
    }) : undefined]);
    return collected({ ready: true, labelCount, ...(recentLogs ? { recentLogs } : {}) }, [labelCount, ...(recentLogs ? [recentLogs] : [])]);
  } catch (error) { return failed(error); }
}
