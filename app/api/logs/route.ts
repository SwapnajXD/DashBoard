import { NextResponse } from "next/server";
import { hosts, resolveHostAddress } from "../../lib/config/hosts";
import { array, endpoint, object, request, safeError, TelemetryFailure } from "../../lib/adapters/shared";
import type { LogEntry, LogSnapshot } from "../../lib/types/logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const limit = 100;
const windowSeconds = 900;

// This dedicated view intentionally returns log text. The infrastructure snapshot remains metadata-only.
export async function GET(incoming: Request) {
  try {
    const query = process.env.LOKI_RECENT_LOG_QUERY?.trim();
    if (!query) throw new TelemetryFailure("unconfigured", "Configure LOKI_RECENT_LOG_QUERY to select the log streams shown here.");
    const athena = hosts.find(host => host.id === "athena")!;
    const address = resolveHostAddress(athena, "loki");
    const base = endpoint(process.env.LOKI_URL, address ? `http://${address}:3100` : null);
    const auth: Record<string, string> = {};
    if (process.env.LOKI_BEARER_TOKEN) auth.Authorization = `Bearer ${process.env.LOKI_BEARER_TOKEN}`;
    if (process.env.LOKI_TENANT_ID) auth["X-Scope-OrgID"] = process.env.LOKI_TENANT_ID;
    const end = Date.now();
    const startNs = BigInt(end - windowSeconds * 1000) * BigInt(1000000);
    const endNs = BigInt(end) * BigInt(1000000);
    const params = new URLSearchParams({ query, start: String(startNs), end: String(endNs), limit: String(limit), direction: "backward" });
    const body = object(await request(base, `/loki/api/v1/query_range?${params}`, { headers: auth, signal: incoming.signal }));
    const data = object(body.data);
    if (body.status !== "success" || data.resultType !== "streams") throw new TelemetryFailure("invalid_response", "The configured query must return log streams.");
    const entries: LogEntry[] = [];
    for (const raw of array(data.result)) {
      const stream = object(raw);
      const labels = object(stream.stream);
      const source = ["host", "namespace", "pod", "container", "service_name"]
        .flatMap(key => typeof labels[key] === "string" && labels[key] ? [`${key}=${String(labels[key]).slice(0,160)}`] : []).join(" · ") || "Unlabelled stream";
      for (const rawEntry of array(stream.values)) {
        const pair = array(rawEntry);
        if (typeof pair[0] !== "string" || !/^\d{1,20}$/.test(pair[0]) || typeof pair[1] !== "string") throw new TelemetryFailure("invalid_response", "Loki returned an invalid log entry.");
        const ns = BigInt(pair[0]);
        if (ns < startNs || ns > endNs || entries.length >= limit) throw new TelemetryFailure("invalid_response", "Loki returned entries outside the requested limits.");
        entries.push({ timestamp: pair[0], source, line: pair[1].slice(0,8192), truncated: pair[1].length > 8192 });
      }
    }
    entries.sort((a,b) => BigInt(a.timestamp) > BigInt(b.timestamp) ? -1 : BigInt(a.timestamp) < BigInt(b.timestamp) ? 1 : 0);
    const snapshot: LogSnapshot = { entries, observedAt: new Date(end).toISOString(), limit, windowSeconds };
    return NextResponse.json(snapshot, { headers });
  } catch (error) {
    const safe = safeError(error);
    return NextResponse.json({ error: safe.message }, { status: safe.code === "unconfigured" ? 503 : 502, headers });
  }
}
