import type { AdapterStatus, HostConfig } from "@/app/lib/types/infrastructure";

/**
 * Prometheus adapter foundation.
 *
 * NOT YET IMPLEMENTED. Athena runs Prometheus on :9090. When this is
 * wired up it should query it over the Tailscale network (never from the
 * browser) using a base URL such as `http://10.10.10.10:9090`, sourced
 * from a server-side env var (e.g. `PROMETHEUS_URL`) rather than
 * hardcoded here.
 *
 * Returns an honest "not_implemented" status so callers (e.g. /api/hosts)
 * don't fabricate metrics.
 */
export async function getPrometheusStatus(
  host: HostConfig,
): Promise<AdapterStatus> {
  void host;
  return { state: "not_implemented" };
}
