export type HostId = "apollo" | "athena" | "hermes" | "artemis";
export type HostType = "proxmox" | "vm" | "workstation";
export type HostStatus = "online" | "offline" | "unknown";
export type AdapterKind = "prometheus" | "proxmox" | "kubernetes" | "loki";
export type NetworkMode = "lan" | "tailscale";
export type HostConfig = {
  id: HostId; name: string; type: HostType;
  network: { lan?: string; tailscale?: string };
  adapters: AdapterKind[]; description: string; vmId?: number;
  requiresLan?: AdapterKind[];
};
export type PublicHost = Pick<HostConfig, "id" | "name" | "type" | "description" | "vmId">;
export type TelemetryError = {
  code: "unconfigured" | "unreachable" | "timeout" | "unauthorized" | "upstream" | "invalid_response" | "unavailable" | "configuration";
  message: string;
};
export type Reading<T> = {
  state: "available" | "unavailable";
  data: T | null;
  timestamp: string;
  error: TelemetryError | null;
};
export type AdapterStatus<T> = {
  state: "ok" | "partial" | "error" | "unreachable" | "unconfigured";
  status: HostStatus;
  timestamp: string;
  data: T | null;
  error: TelemetryError | null;
};
export type ProxmoxResource = {
  id: string; node: string; name: string | null; type: string;
  vmId: number | null; hostId: HostId | null; status: HostStatus;
  cpuRatio: number | null; cpuCount: number | null;
  memoryUsedBytes: number | null; memoryTotalBytes: number | null;
  storageUsedBytes: number | null; storageTotalBytes: number | null;
  uptimeSeconds: number | null;
};
export type ProxmoxData = {
  nodes: Reading<ProxmoxResource[]>;
  vms: Reading<ProxmoxResource[]>;
  storage: Reading<ProxmoxResource[]>;
};
export type MetricSample = { value: number; sampledAt: string };
export type HostMetrics = {
  cpuPercent: Reading<MetricSample>;
  memoryPercent: Reading<MetricSample>;
  storagePercent: Reading<MetricSample>;
};
export type PrometheusData = {
  healthy: true;
  targets: Reading<{ job: string | null; instance: string | null; health: HostStatus; lastScrape: string | null }[]>;
  alerts: Reading<{ name: string; state: string; activeAt: string | null }[]>;
  metrics: Record<"apollo" | "athena" | "hermes", HostMetrics>;
};
export type LokiData = { ready: true; labelCount: Reading<number> };
export type KubernetesNode = {
  name: string; status: HostStatus; roles: string[]; kubeletVersion: string | null;
  capacity: { cpu: string | null; memory: string | null };
  allocatable: { cpu: string | null; memory: string | null };
};
export type KubernetesContainer = {
  name: string; kind: "container" | "init" | "ephemeral"; ready: boolean | null;
  restartCount: number | null; state: "running" | "waiting" | "terminated" | "unknown";
  reason: string | null;
};
export type KubernetesPod = {
  name: string; namespace: string; node: string | null; phase: string | null;
  containers: KubernetesContainer[];
};
export type KubernetesData = {
  apiReachable: true;
  version: Reading<string>;
  nodes: Reading<KubernetesNode[]>;
  namespaces: Reading<string[]>;
  pods: Reading<KubernetesPod[]>;
  deployments: Reading<{ name: string; namespace: string; desired: number | null; ready: number | null; available: number | null }[]>;
  services: Reading<{ name: string; namespace: string; type: string | null; ports: { port: number; protocol: string | null }[] }[]>;
  ingresses: Reading<{ name: string; namespace: string; className: string | null; hosts: string[] }[]>;
  nodeMetrics: Reading<{ name: string; sampledAt: string | null; window: string | null; cpu: string | null; memory: string | null }[]>;
};
export type AdapterData = { proxmox: ProxmoxData; prometheus: PrometheusData; loki: LokiData; kubernetes: KubernetesData };
export type AdapterResults = { [K in AdapterKind]?: AdapterStatus<AdapterData[K]> };
export type HostSummary = {
  host: PublicHost; status: HostStatus; statusSource: string | null;
  timestamp: string; adapters: AdapterResults;
};
export type InfrastructureResponse = {
  schemaVersion: 1; ok: true; hosts: HostSummary[]; timestamp: string;
};
