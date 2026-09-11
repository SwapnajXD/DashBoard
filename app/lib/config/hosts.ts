import type {
  AdapterKind,
  HostConfig,
  NetworkMode,
} from "@/app/lib/types/infrastructure";

/**
 * Server-side registry of known homelab hosts.
 *
 * This is intentionally static configuration — it does not open any
 * connection and must never be imported into client components.
 *
 * Addresses are only ever used server-side (see app/api routes and
 * app/lib/adapters).
 *
 * NOTE ON DUAL ADDRESSING:
 * Where Olympus itself is running determines which address is reachable:
 *  - Deployed on Hestia (production) → inside the LAN → use `lan`.
 *  - Running on Artemis (dev)        → outside the LAN → use `tailscale`.
 * Hestia has no Tailscale IP by design (intentionally excluded from the
 * mesh to minimize its attack surface), so it is only ever reachable via
 * LAN — meaning Hestia-hosted adapters cannot be exercised from Artemis
 * until Olympus is actually deployed there.
 */
export const hosts: HostConfig[] = [
  {
    id: "apollo",
    name: "Apollo",
    type: "proxmox",
    network: {
      lan: "10.10.10.1",
      tailscale: "100.81.86.51",
    },
    adapters: ["proxmox"],
    description: "Proxmox VE host and NAT gateway. Hestia runs on it as LXC 101.",
  },
  {
    id: "athena",
    name: "Athena",
    type: "vm",
    network: {
      lan: "10.10.10.10",
      tailscale: "100.117.35.70",
    },
    adapters: ["docker", "kubernetes", "prometheus", "loki"],
    // K3s certs are only valid for Athena's LAN IP — kubectl/K8s API
    // access does not work over the Tailscale IP even though Athena
    // itself is on the tailnet.
    requiresLan: ["kubernetes"],
    description: "VM running Docker, K3s, and the observability stack.",
  },
  {
    id: "hestia",
    name: "Hestia",
    type: "lxc",
    network: {
      lan: "10.10.10.2",
      // Intentionally excluded from Tailscale — no tailscale address.
    },
    adapters: ["docker"],
    description:
      "LXC hosting Homepage and Vaultwarden. Not on Tailscale; reachable " +
      "only via LAN or Apollo's DNAT (ports 3000/8080 only).",
  },
];

export function getHost(id: string): HostConfig | undefined {
  return hosts.find((host) => host.id === id);
}

/**
 * Resolves which network mode Olympus should assume it's operating in.
 * Set OLYMPUS_NETWORK_MODE=lan in the environment when deploying inside
 * the homelab (e.g. on Hestia). Defaults to "tailscale", which is the
 * safe default for local/dev use on Artemis.
 */
export function getNetworkMode(): NetworkMode {
  const raw = process.env.OLYMPUS_NETWORK_MODE?.toLowerCase();
  return raw === "lan" ? "lan" : "tailscale";
}

/**
 * Resolves the address to use for a given host + adapter, given the
 * current network mode. Returns null if the host is genuinely
 * unreachable in the current mode (e.g. Hestia from Artemis, or
 * Kubernetes on Athena from anywhere outside the LAN) — callers should
 * treat null as "not reachable from here," not throw a generic error.
 */
export function resolveHostAddress(
  host: HostConfig,
  adapter: AdapterKind,
): string | null {
  const mode = getNetworkMode();
  const mustUseLan = host.requiresLan?.includes(adapter) ?? false;

  if (mode === "lan" || mustUseLan) {
    return host.network.lan ?? null;
  }

  return host.network.tailscale ?? host.network.lan ?? null;
}
