import { resolveHostAddress } from "@/app/lib/config/hosts";
import type { AdapterStatus, HostConfig } from "@/app/lib/types/infrastructure";

const LOKI_PORT = 3100;
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

type LokiLabelsResponse = {
  status: string;
  data: string[];
};

/**
 * Queries Loki on Athena for readiness + known labels.
 *
 * Loki's `/ready` can legitimately return a transient "Ingester not
 * ready: waiting for Ns after being ready" message right after startup —
 * that's normal, not a failure, so a non-200 here is reported as `error`
 * (so the UI can show it) rather than silently treated as down.
 *
 * Uses whichever address is reachable given the current NetworkMode
 * (Tailscale from Artemis, LAN once deployed on Hestia) — see
 * app/lib/config/hosts.ts. Never called from the browser; this only
 * runs server-side inside API routes.
 */
export async function getLokiStatus(
  host: HostConfig,
): Promise<AdapterStatus> {
  const address = resolveHostAddress(host, "loki");
  if (!address) {
    return {
      state: "unreachable",
      reason:
        "No address reachable for Loki on this host in the current " +
        "network mode.",
    };
  }

  const base = `http://${address}:${LOKI_PORT}`;

  try {
    const readyRes = await fetchWithTimeout(`${base}/ready`, FETCH_TIMEOUT_MS);
    if (!readyRes.ok) {
      const body = await readyRes.text().catch(() => "");
      return {
        state: "error",
        message: `Loki not ready (HTTP ${readyRes.status})${
          body ? `: ${body}` : ""
        }`,
      };
    }

    let labelCount: number | null = null;
    try {
      const labelsRes = await fetchWithTimeout(
        `${base}/loki/api/v1/labels`,
        FETCH_TIMEOUT_MS,
      );
      if (labelsRes.ok) {
        const body = (await labelsRes.json()) as LokiLabelsResponse;
        labelCount = Array.isArray(body.data) ? body.data.length : null;
      }
    } catch {
      // Labels endpoint is a nice-to-have; readiness above already
      // confirmed the server is up, so don't fail the whole call.
    }

    return {
      state: "ok",
      data: {
        ready: true,
        address,
        labelCount,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { state: "error", message: `Unable to reach Loki: ${message}` };
  }
}
