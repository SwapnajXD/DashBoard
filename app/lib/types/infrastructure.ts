export type HostType = "proxmox" | "vm" | "lxc";

export type HostStatus = "online" | "offline" | "unknown";

export type Host = {
  id: string;
  name: string;
  type: HostType;
  address: string;
  status: HostStatus;
};

export type ContainerStatus =
  | "running"
  | "exited"
  | "paused"
  | "restarting"
  | "unknown";

export type Container = {
  id: string;
  name: string;
  image: string;
  state: ContainerStatus;
  status: string;
  ports: {
    privatePort: number;
    publicPort?: number;
    type: string;
  }[];
  created: number;
  labels: Record<string, string>;
};

export type DockerHost = {
  host: Host;
  containers: Container[];
  timestamp: string;
};

/**
 * Identifies which infrastructure adapter a host can be reached through.
 * A host may support more than one (e.g. Athena runs both Docker and K3s).
 */
export type AdapterKind =
  | "docker"
  | "prometheus"
  | "proxmox"
  | "kubernetes"
  | "loki";

/**
 * Which network path Olympus should use to reach the homelab.
 *
 * "lan"       — Olympus is running inside the homelab (e.g. deployed on
 *               Hestia), so LAN addresses (10.10.10.0/24) are reachable.
 * "tailscale" — Olympus is running outside the homelab (e.g. dev on
 *               Artemis), so only each host's own Tailscale IP is
 *               reachable. Hestia has no Tailscale IP by design, so it is
 *               unreachable in this mode — that's expected, not a bug.
 *
 * Selected via the OLYMPUS_NETWORK_MODE env var (see hosts.ts).
 */
export type NetworkMode = "lan" | "tailscale";

/**
 * A host's known addresses. Not every host has both — e.g. Hestia is
 * intentionally excluded from Tailscale, so it only has `lan`.
 */
export type HostAddresses = {
  lan?: string;
  tailscale?: string;
};

/**
 * Server-side host registry entry. This describes a machine in the
 * homelab and which adapters can be attached to it — it does not itself
 * open any connection.
 */
export type HostConfig = {
  id: string;
  name: string;
  type: HostType;
  network: HostAddresses;
  adapters: AdapterKind[];
  description?: string;
  /**
   * If true, this host must always be reached over LAN regardless of
   * NetworkMode — e.g. Kubernetes, whose certs are only valid for
   * Athena's LAN IP. Adapters for these hosts are simply unreachable
   * from Artemis until Olympus is deployed inside the LAN.
   */
  requiresLan?: AdapterKind[];
};

/**
 * Generic wrapper returned by adapters that are registered but not yet
 * wired up to a live integration. Lets `/api/hosts` report an honest
 * "not implemented" state instead of fabricating data.
 */
export type AdapterStatus =
  | { state: "not_implemented" }
  | { state: "ok"; data: unknown }
  | { state: "error"; message: string }
  /**
   * The adapter is implemented, but this host isn't reachable given the
   * current NetworkMode — e.g. Hestia from Artemis, or Kubernetes on
   * Athena from outside the LAN. Distinct from "error": this is an
   * expected, known-topology limitation, not a failure.
   */
  | { state: "unreachable"; reason: string };

/**
 * A single entry in the host registry response, combining the static
 * config with a best-effort status per attached adapter.
 */
export type HostSummary = {
  host: HostConfig;
  adapters: Partial<Record<AdapterKind, AdapterStatus>>;
};
