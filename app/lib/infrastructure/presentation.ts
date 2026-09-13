import type { HostStatus, InfrastructureResponse } from "../types/infrastructure";

export function ratioPercent(used: number | null | undefined, total: number | null | undefined): number | null {
  return used != null && total != null && Number.isFinite(used) && Number.isFinite(total) && total > 0 ? used / total * 100 : null;
}
export function infrastructureView(response: InfrastructureResponse | null) {
  const host = (id: string) => response?.hosts.find(item => item.host.id === id);
  const proxmox = host("apollo")?.adapters.proxmox?.data;
  const prometheus = host("athena")?.adapters.prometheus?.data;
  const kubernetes = host("hermes")?.adapters.kubernetes?.data;
  const apollo = proxmox?.nodes.data?.find(node => node.hostId === "apollo");
  const status = (id: string): HostStatus => host(id)?.status ?? "unknown";
  const serviceStatus = (name: string): HostStatus => {
    if (name === "Prometheus") return prometheus?.healthy ? "online" : "unknown";
    if (name === "Loki") return host("athena")?.adapters.loki?.data?.ready ? "online" : "unknown";
    if (name === "K3s") return kubernetes?.apiReachable ? "online" : "unknown";
    return "unknown";
  };
  return {
    proxmox, prometheus, kubernetes, apollo, status, serviceStatus,
    cpu: prometheus?.metrics.apollo.cpuPercent.data?.value ?? (apollo?.cpuRatio == null ? null : apollo.cpuRatio * 100),
    memory: prometheus?.metrics.apollo.memoryPercent.data?.value ?? ratioPercent(apollo?.memoryUsedBytes, apollo?.memoryTotalBytes),
    storage: prometheus?.metrics.apollo.storagePercent.data?.value ?? ratioPercent(apollo?.storageUsedBytes, apollo?.storageTotalBytes),
    firingAlerts: prometheus?.alerts.data?.filter(alert => alert.state === "firing").length ?? null,
  };
}
