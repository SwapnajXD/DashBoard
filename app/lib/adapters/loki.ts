import type { AdapterStatus, HostConfig } from "@/app/lib/types/infrastructure";

/**
 * Loki adapter foundation.
 *
 * NOT YET IMPLEMENTED. Athena runs Loki on :3100, fed by Alloy on both
 * Athena and Hestia. A real implementation should query Loki's HTTP API
 * (e.g. `/loki/api/v1/query_range`) using a base URL from a server-side
 * env var (e.g. `LOKI_URL`), never from the browser.
 *
 * Returns an honest "not_implemented" status so callers don't fabricate
 * log data.
 */
export async function getLokiStatus(
  host: HostConfig,
): Promise<AdapterStatus> {
  void host;
  return { state: "not_implemented" };
}
