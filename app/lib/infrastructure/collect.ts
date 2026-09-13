import "server-only";
import { hosts } from "../config/hosts";
import { getPrometheusStatus } from "../adapters/prometheus";
import { getLokiStatus } from "../adapters/loki";
import { getProxmoxStatus } from "../adapters/proxmox";
import { getKubernetesStatus } from "../adapters/kubernetes";
import { failed, timestamp } from "../adapters/shared";
import type { AdapterData, AdapterKind, AdapterResults, AdapterStatus, HostConfig, HostSummary, InfrastructureResponse } from "../types/infrastructure";

export type Collectors = { [K in AdapterKind]: (host: HostConfig) => Promise<AdapterStatus<AdapterData[K]>> };
const defaults: Collectors = { prometheus: getPrometheusStatus, loki: getLokiStatus, proxmox: getProxmoxStatus, kubernetes: getKubernetesStatus };

export async function collectInfrastructure(collectors: Collectors = defaults): Promise<InfrastructureResponse> {
  const summaries: HostSummary[] = await Promise.all(hosts.map(async (config) => {
    const entries = await Promise.all(config.adapters.map(async kind => {
      try { return [kind, await collectors[kind](config)]; }
      catch { return [kind, failed(new Error("Adapter failed"))]; }
    }));
    const adapters: AdapterResults = Object.fromEntries(entries);
    // Only explicitly selected identity fields cross the server boundary.
    const { id, name, type, description, vmId } = config;
    return { host: { id, name, type, description, ...(vmId === undefined ? {} : { vmId }) }, status: "unknown", statusSource: null, timestamp: timestamp(), adapters };
  }));
  const apollo = summaries.find(item => item.host.id === "apollo")!;
  const proxmox = apollo.adapters.proxmox;
  const vms = proxmox?.data?.vms.data;
  for (const summary of summaries) {
    if (summary.host.id === "apollo" && proxmox?.status !== undefined && proxmox.status !== "unknown") {
      summary.status = proxmox.status; summary.statusSource = "proxmox/node";
    } else if (summary.host.vmId !== undefined) {
      const vm = vms?.find(item => item.vmId === summary.host.vmId);
      if (vm && vm.status !== "unknown") { summary.status = vm.status; summary.statusSource = "proxmox/vm"; }
    }
    if (summary.status !== "unknown") continue;
    const node = summary.adapters.kubernetes?.data?.nodes.data?.find(item => item.name === "hermes");
    if (node && node.status !== "unknown") { summary.status = node.status; summary.statusSource = "kubernetes/node-ready"; }
    else if (summary.adapters.prometheus?.data?.healthy || summary.adapters.loki?.data?.ready) {
      summary.status = "online"; summary.statusSource = "observability/api";
    }
  }
  return { schemaVersion: 1, ok: true, hosts: summaries, timestamp: timestamp() };
}
