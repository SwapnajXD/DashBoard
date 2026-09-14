import "server-only";
import { array, object, string, TelemetryFailure } from "./shared";

export function normalizeContainers(value: unknown, observedAt = Date.now()) {
  const body = object(value); const data = object(body.data);
  if (body.status !== "success" || data.resultType !== "vector") throw new TelemetryFailure("invalid_response", "Container query must return a successful vector.");
  const results = array(data.result);
  if (results.length > 4000) throw new TelemetryFailure("unavailable", "Container series exceed the collection limit.");
  const names = new Set<string>();
  return results.map(value => {
    const item = object(value); const name = string(object(item.metric).name);
    const pair = array(item.value); const seconds = typeof pair[1] === "string" && pair[1].trim() ? Number(pair[1]) : NaN;
    const date = new Date(seconds * 1000);
    if (!name?.trim() || names.has(name) || !Number.isFinite(date.getTime()) || seconds <= 0 || date.getTime() > observedAt + 5000) {
      throw new TelemetryFailure("invalid_response", "Container names or last-seen timestamps are invalid or ambiguous.");
    }
    names.add(name);
    return { name, lastSeenAt: date.toISOString() };
  });
}

// Only timestamp/count metadata crosses the boundary; log lines and stream labels never do.
export function normalizeRecentLogs(value: unknown, end: number, windowSeconds = 900) {
  const body = object(value); const data = object(body.data);
  if (body.status !== "success" || data.resultType !== "streams") throw new TelemetryFailure("invalid_response", "Loki query must return successful log streams.");
  let latest = 0; let count = 0;
  for (const stream of array(data.result)) {
    for (const entry of array(object(stream).values)) {
      const pair = array(entry);
      if (typeof pair[0] !== "string" || !/^\d{1,20}$/.test(pair[0]) || typeof pair[1] !== "string" || !pair[1].length) {
        throw new TelemetryFailure("invalid_response", "Loki entry timestamp or content is invalid.");
      }
      const millis = Number(BigInt(pair[0]) / BigInt(1000000));
      if (millis < end - windowSeconds * 1000 || millis > end || ++count > 20) {
        throw new TelemetryFailure("invalid_response", "Loki response exceeds the requested time or entry limits.");
      }
      latest = Math.max(latest, millis);
    }
  }
  return { latestEntryAt: count ? new Date(latest).toISOString() : null, inspectedEntries: count, windowSeconds };
}
