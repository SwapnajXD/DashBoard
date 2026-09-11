import { Agent } from "undici";
import { resolveHostAddress } from "@/app/lib/config/hosts";
import type { AdapterStatus, HostConfig } from "@/app/lib/types/infrastructure";

const PROXMOX_PORT = 8006;
const FETCH_TIMEOUT_MS = 3000;

/**
 * Apollo's Proxmox web UI uses the default self-signed certificate
 * (confirmed — this is a homelab, not a public-facing service). This
 * agent is scoped to Proxmox API calls only; it never disables TLS
 * verification globally for the rest of Olympus.
 */
const proxmoxAgent = new Agent({
  connect: { rejectUnauthorized: false },
});

type ProxmoxNode = {
  node: string;
  status: string;
  cpu?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  uptime?: number;
};

type ProxmoxNodesResponse = {
  data: ProxmoxNode[];
};

/**
 * Queries Apollo's Proxmox VE API for node status.
 *
 * Requires an API token, set via env vars:
 *   PROXMOX_API_TOKEN_ID     e.g. "olympus@pve!olympus-ro"
 *   PROXMOX_API_TOKEN_SECRET the token's secret UUID
 *
 * The token should use a read-only role (e.g. PVEAuditor) — Olympus only
 * ever reads status here, never issues write/control calls.
 *
 * Uses whichever address is reachable given the current NetworkMode
 * (Tailscale from Artemis, LAN once deployed on Hestia) — see
 * app/lib/config/hosts.ts. Never called from the browser; this only
 * runs server-side inside API routes.
 */
export async function getProxmoxStatus(
  host: HostConfig,
): Promise<AdapterStatus> {
  const address = resolveHostAddress(host, "proxmox");
  if (!address) {
    return {
      state: "unreachable",
      reason:
        "No address reachable for Proxmox on this host in the current " +
        "network mode.",
    };
  }

  const tokenId = process.env.PROXMOX_API_TOKEN_ID;
  const tokenSecret = process.env.PROXMOX_API_TOKEN_SECRET;
  if (!tokenId || !tokenSecret) {
    return {
      state: "error",
      message:
        "Proxmox API token not configured. Set PROXMOX_API_TOKEN_ID and " +
        "PROXMOX_API_TOKEN_SECRET in the environment.",
    };
  }

  const base = `https://${address}:${PROXMOX_PORT}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${base}/api2/json/nodes`, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Authorization: `PVEAPIToken=${tokenId}=${tokenSecret}`,
      },
      // @ts-expect-error — `dispatcher` is a Node/undici fetch extension
      // (not in the DOM fetch types) used here to scope the self-signed
      // cert exception to just this request.
      dispatcher: proxmoxAgent,
    });

    if (res.status === 401 || res.status === 403) {
      return {
        state: "error",
        message: `Proxmox rejected the API token (HTTP ${res.status})`,
      };
    }
    if (!res.ok) {
      return {
        state: "error",
        message: `Proxmox API returned HTTP ${res.status}`,
      };
    }

    const body = (await res.json()) as ProxmoxNodesResponse;
    const nodes = (body.data ?? []).map((n) => ({
      node: n.node,
      status: n.status,
      cpu: n.cpu ?? null,
      maxcpu: n.maxcpu ?? null,
      mem: n.mem ?? null,
      maxmem: n.maxmem ?? null,
      uptime: n.uptime ?? null,
    }));

    return {
      state: "ok",
      data: { address, nodes },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { state: "error", message: `Unable to reach Proxmox: ${message}` };
  } finally {
    clearTimeout(timer);
  }
}
