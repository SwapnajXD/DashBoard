import { resolveHostAddress } from "@/app/lib/config/hosts";
import type { AdapterStatus, HostConfig } from "@/app/lib/types/infrastructure";

const PROMETHEUS_PORT = 9090;
const FETCH_TIMEOUT_MS = 3000;

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

type PrometheusTargetsResponse = {
  status: string;
  data: {
    activeTargets: { health: string }[];
  };
};

/**
 * Queries Prometheus on Athena for basic health + target status.
 *
 * Uses whichever address is reachable given the current NetworkMode
 * (Tailscale from Artemis, LAN once deployed on Hestia) — see
 * app/lib/config/hosts.ts. Never called from the browser; this only
 * runs server-side inside API routes.
 */
export async function getPrometheusStatus(
  host: HostConfig,
): Promise<AdapterStatus> {
  const address = resolveHostAddress(host, "prometheus");
  if (!address) {
    return {
      state: "unreachable",
      reason:
        "No address reachable for Prometheus on this host in the " +
        "current network mode.",
    };
  }

  const base = `http://${address}:${PROMETHEUS_PORT}`;

  try {
    const healthRes = await fetchWithTimeout(`${base}/-/healthy`, FETCH_TIMEOUT_MS);
    if (!healthRes.ok) {
      return {
        state: "error",
        message: `Prometheus health check returned HTTP ${healthRes.status}`,
      };
    }

    let targetsUp: number | null = null;
    let targetsTotal: number | null = null;
    try {
      const targetsRes = await fetchWithTimeout(
        `${base}/api/v1/targets`,
        FETCH_TIMEOUT_MS,
      );
      if (targetsRes.ok) {
        const body = (await targetsRes.json()) as PrometheusTargetsResponse;
        const active = body.data?.activeTargets ?? [];
        targetsTotal = active.length;
        targetsUp = active.filter((t) => t.health === "up").length;
      }
    } catch {
      // Targets endpoint is a nice-to-have; health check above already
      // confirmed the server is up, so don't fail the whole call.
    }

    return {
      state: "ok",
      data: {
        healthy: true,
        address,
        targetsUp,
        targetsTotal,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { state: "error", message: `Unable to reach Prometheus: ${message}` };
  }
}
