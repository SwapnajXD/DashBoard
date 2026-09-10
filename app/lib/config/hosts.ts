import type { HostConfig } from "@/app/lib/types/infrastructure";

/**
 * Server-side registry of known homelab hosts.
 *
 * This is intentionally static configuration — it does not open any
 * connection and must never be imported into client components. Adapters
 * are attached later by matching a host's `adapters` list to an adapter
 * module in `app/lib/adapters/`.
 *
 * Addresses are Tailscale / LAN addresses and are only ever used
 * server-side (see app/api routes).
 */
export const hosts: HostConfig[] = [
  {
    id: "apollo",
    name: "Apollo",
    type: "proxmox",
    address: "100.81.86.51",
    adapters: ["proxmox"],
    description: "Proxmox VE host. Hestia runs on it as LXC 101.",
  },
  {
    id: "athena",
    name: "Athena",
    type: "vm",
    address: "10.10.10.10",
    adapters: ["docker", "kubernetes", "prometheus", "loki"],
    description: "VM running Docker, K3s, and the observability stack.",
  },
  {
    id: "hestia",
    name: "Hestia",
    type: "lxc",
    address: "10.10.10.2",
    adapters: ["docker"],
    description: "LXC hosting Homepage (stopped) and Vaultwarden.",
  },
];

export function getHost(id: string): HostConfig | undefined {
  return hosts.find((host) => host.id === id);
}
