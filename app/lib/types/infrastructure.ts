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
 * Server-side host registry entry. This describes a machine in the
 * homelab and which adapters can be attached to it — it does not itself
 * open any connection.
 */
export type HostConfig = {
  id: string;
  name: string;
  type: HostType;
  address: string;
  adapters: AdapterKind[];
  description?: string;
};

/**
 * Generic wrapper returned by adapters that are registered but not yet
 * wired up to a live integration. Lets `/api/hosts` report an honest
 * "not implemented" state instead of fabricating data.
 */
export type AdapterStatus =
  | { state: "not_implemented" }
  | { state: "ok"; data: unknown }
  | { state: "error"; message: string };

/**
 * A single entry in the host registry response, combining the static
 * config with a best-effort status per attached adapter.
 */
export type HostSummary = {
  host: HostConfig;
  adapters: Partial<Record<AdapterKind, AdapterStatus>>;
};
