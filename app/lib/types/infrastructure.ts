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
