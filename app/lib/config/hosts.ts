import "server-only";
import type { AdapterKind, HostConfig, NetworkMode } from "@/app/lib/types/infrastructure";

// Server-side V2 registry. Addresses must be supplied for the selected network.
export const hosts: HostConfig[] = [
  {
    id: "apollo", name: "Apollo", type: "proxmox",
    network: { lan: process.env.APOLLO_LAN_ADDRESS, tailscale: process.env.APOLLO_TAILSCALE_ADDRESS },
    adapters: ["proxmox"],
    description: "Proxmox infrastructure host for Athena and Hermes.",
  },
  {
    id: "athena", name: "Athena", type: "vm", vmId: 100,
    network: { lan: process.env.ATHENA_LAN_ADDRESS, tailscale: process.env.ATHENA_TAILSCALE_ADDRESS },
    adapters: ["prometheus", "loki"],
    description: "Observability VM: Prometheus, Grafana, Loki, Alloy and exporters.",
  },
  {
    id: "hermes", name: "Hermes", type: "vm", vmId: 101,
    network: { lan: process.env.HERMES_LAN_ADDRESS },
    adapters: ["kubernetes"], requiresLan: ["kubernetes"],
    description: "K3s/Kubernetes VM and Olympus deployment target.",
  },
  {
    id: "artemis", name: "Artemis", type: "workstation",
    network: {}, adapters: [],
    description: "Management and administration workstation; not a workload host.",
  },
];

export function getNetworkMode(): NetworkMode {
  return process.env.OLYMPUS_NETWORK_MODE?.toLowerCase() === "lan" ? "lan" : "tailscale";
}

export function resolveHostAddress(host: HostConfig, adapter: AdapterKind): string | null {
  const mode = getNetworkMode();
  if (mode !== "lan" && host.requiresLan?.includes(adapter)) return null;
  return host.network[mode]?.trim() || null;
}
