import React from "react";
import { ChevronRight } from "lucide-react";
import type { ContainerObservation, KubernetesData, KubernetesPod, ProxmoxResource } from "../lib/types/infrastructure";
import { bytes, duration, freshness, observation, percent, readingLabel, valueOf } from "../lib/infrastructure/overview";
import { ratioPercent } from "../lib/infrastructure/presentation";
import { cpuUsage, podResources } from "../lib/infrastructure/resources";
import { Badge, HostState, Metric } from "./infrastructure";

export function Disclosure({ name, subtitle, summary, children, open = false }: { open?: boolean; name: string; subtitle?: string; summary?: React.ReactNode; children: React.ReactNode }) {
  return <details className="resource-disclosure" open={open}><summary><ChevronRight size={16} className="disclosure-chevron" /><span className="resource-identity"><strong>{name}</strong>{subtitle ? <small>{subtitle}</small> : null}</span><span className="resource-preview">{summary}</span></summary><div className="disclosure-body">{children}</div></details>;
}
export function Preview({ label, children }: { label: string; children: React.ReactNode }) {
  return <span className="preview-value"><small>{label}</small><span>{children}</span></span>;
}
export function Fields({ values }: { values: [string, React.ReactNode][] }) {
  return <dl className="detail-fields">{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? "Unavailable"}</dd></div>)}</dl>;
}
export function SampleNote({ source, sampledAt, observedAt, window }: { source: string; sampledAt?: string | null; observedAt?: string | null; window?: string | null }) {
  return <div className="sample-note"><strong>{source}</strong>{sampledAt ? <span>Sampled {observation(sampledAt)}</span> : null}{window ? <span>Window {window}</span> : null}<span>Observed {observation(observedAt)}</span></div>;
}
export function FreshnessBadge({ state }: { state: string }) {
  return <Badge label={state} tone={state === "Recent at sync" ? "good" : state === "Older at sync" ? "warn" : state === "Error" || state === "Invalid timestamp" ? "bad" : "muted"} />;
}
export function VmDetail({ vm, at }: { vm: ProxmoxResource; at?: string }) {
  return <Disclosure name={vm.name ?? "Unnamed VM"} subtitle={`VM ${vm.vmId ?? "Unavailable"} · ${vm.node}`} summary={<><Preview label="CPU">{percent(vm.cpuRatio == null ? null : vm.cpuRatio * 100)}</Preview><Preview label="Memory">{bytes(vm.memoryUsedBytes)}</Preview><HostState status={vm.status} /></>}>
    <div className="metrics three"><Metric label="VM CPU" value={percent(vm.cpuRatio == null ? null : vm.cpuRatio * 100)} detail={`${vm.cpuCount ?? "Unavailable"} vCPUs`} source="Proxmox VM inventory" utilization={vm.cpuRatio == null ? null : vm.cpuRatio * 100} /><Metric label="Memory used" value={bytes(vm.memoryUsedBytes)} detail={`of ${bytes(vm.memoryTotalBytes)}`} source="Proxmox VM inventory" utilization={ratioPercent(vm.memoryUsedBytes, vm.memoryTotalBytes)} /><Metric label="Disk allocation" value={bytes(vm.storageTotalBytes)} detail="Allocated capacity · guest usage unavailable" source="Proxmox VM inventory" /></div>
    <Fields values={[["VM ID", vm.vmId], ["Hypervisor node", vm.node], ["Uptime", duration(vm.uptimeSeconds)], ["Resource type", vm.type]]} /><SampleNote source="Proxmox · VM inventory" observedAt={at} />
  </Disclosure>;
}
export function StorageDetail({ item, at }: { item: ProxmoxResource; at?: string }) {
  return <Disclosure name={item.name ?? item.id} subtitle={item.node} summary={<><Preview label="Used">{bytes(item.storageUsedBytes)}</Preview><Preview label="Utilization">{percent(ratioPercent(item.storageUsedBytes, item.storageTotalBytes))}</Preview></>}>
    <div className="metrics two"><Metric label="Storage used" value={bytes(item.storageUsedBytes)} detail={`of ${bytes(item.storageTotalBytes)}`} source="Proxmox storage inventory" utilization={ratioPercent(item.storageUsedBytes, item.storageTotalBytes)} /><Metric label="Capacity" value={bytes(item.storageTotalBytes)} source="Proxmox storage inventory" /></div><Fields values={[["Resource ID", item.id], ["Node", item.node], ["Type", item.type], ["Reported state", <HostState status={item.status} />]]} /><SampleNote source="Proxmox · storage inventory" observedAt={at} />
  </Disclosure>;
}
export function AthenaContainerDetail({ item, at, open }: { open?: boolean; item: ContainerObservation; at?: string }) {
  const cpu = valueOf(item.cpuCores), memory = valueOf(item.memoryWorkingSetBytes);
  return <Disclosure open={open} name={item.name} subtitle="Athena · cAdvisor" summary={<><Preview label="CPU · 5m">{cpu ? `${cpu.value.toFixed(4)} cores` : readingLabel(item.cpuCores)}</Preview><Preview label="Working set">{memory ? bytes(memory.value) : readingLabel(item.memoryWorkingSetBytes)}</Preview><FreshnessBadge state={freshness(item.lastSeenAt, at)} /></>}>
    <div className="metrics two"><Metric label="CPU usage" value={cpu ? `${cpu.value.toFixed(4)} cores` : readingLabel(item.cpuCores)} detail="Five-minute average · 1 core = 100% of one CPU" source="Prometheus · cAdvisor" at={cpu?.sampledAt} atLabel="Evaluated" /><Metric label="Memory working set" value={memory ? bytes(memory.value) : readingLabel(item.memoryWorkingSetBytes)} detail="Container capacity is unavailable" source="Prometheus · cAdvisor" at={memory?.sampledAt} atLabel="Evaluated" /></div>
    {item.cpuCores?.error ? <p className="detail-error">CPU: {item.cpuCores.error.message}</p> : null}{item.memoryWorkingSetBytes?.error ? <p className="detail-error">Memory: {item.memoryWorkingSetBytes.error.message}</p> : null}
    <Fields values={[["Last seen", observation(item.lastSeenAt)], ["Availability evidence", "Last-seen telemetry"], ["Lifecycle / health check", "Unavailable"]]} /><SampleNote source="Prometheus · cAdvisor" observedAt={at} /><p className="detail-caption">Evaluation time is not scrape time. Freshness describes the sample at synchronization.</p>
  </Disclosure>;
}
export function PodDetail({ pod, metrics, inventoryAt, open }: { open?: boolean; pod: KubernetesPod; metrics?: KubernetesData["podMetrics"]; inventoryAt?: string }) {
  const usage = podResources(pod, metrics);
  const ready = pod.containers.filter(c => c.kind === "container");
  return <Disclosure open={open} name={pod.name} subtitle={`${pod.namespace} · ${pod.node ?? "Unassigned"}`} summary={<><Preview label="CPU">{cpuUsage(usage.cpu)}</Preview><Preview label="Memory">{bytes(usage.memory)}</Preview><Badge label={pod.phase ?? "Unavailable"} tone={pod.phase === "Failed" ? "bad" : pod.phase === "Succeeded" ? "good" : "muted"} /></>}>
    <div className="detail-toolbar"><span>{usage.complete ? "Pod total · sum of matching container samples" : "Pod totals incomplete, stale or unavailable"}</span><FreshnessBadge state={usage.state} /></div>
    <Fields values={[["Namespace", pod.namespace], ["Scheduled node", pod.node], ["Application containers ready", `${ready.filter(c => c.ready === true).length} / ${ready.length}${ready.some(c => c.ready === null) ? " · some unknown" : ""}`], ["Restarts (all containers)", pod.containers.some(c => c.restartCount === null) ? "Unavailable" : pod.containers.reduce((total, c) => total + c.restartCount!, 0)]]} />
    <div className="container-heading"><h4>Container resources</h4><span>CPU / memory from individual samples</span></div>
    {usage.containers.map(c => <div className="container-line" key={`${c.kind}/${c.name}`}><div><strong>{c.name}</strong><small>{c.kind} · {c.state} · {c.ready === null ? "readiness unknown" : c.ready ? "ready" : "not ready"}</small>{c.reason ? <small>{c.reason}</small> : null}</div><Preview label="CPU">{cpuUsage(c.cpu)}</Preview><Preview label="Memory">{bytes(c.memory)}</Preview>{c.error ? <p className="detail-error">{c.error.message}</p> : null}</div>)}
    {!usage.containers.length ? <p className="empty">No declared containers returned.</p> : null}
    {metrics?.error ? <p className="detail-error">{readingLabel(metrics)}: {metrics.error.message}</p> : null}{usage.sample?.error ? <p className="detail-error">{usage.sample.error.message}</p> : null}
    <SampleNote source="Kubernetes metrics-server" sampledAt={usage.sample?.sampledAt} window={usage.sample?.window} observedAt={metrics?.timestamp} /><p className="detail-caption">Pod inventory observed {observation(inventoryAt)}. Resource samples older than two minutes are unavailable. Completed workloads may have no current sample.</p>
  </Disclosure>;
}
type Service = NonNullable<KubernetesData["services"]["data"]>[number];
export function ServiceDetail({ item, at }: { item: Service; at?: string }) {
  return <Disclosure name={item.name} subtitle={item.namespace} summary={<><Preview label="Type">{item.type ?? "Unavailable"}</Preview><Preview label="Ports">{item.ports.length}</Preview></>}><Fields values={[["Namespace", item.namespace], ["Service type", item.type], ["Exposed ports", item.ports.length ? item.ports.map(p => `${p.port}/${p.protocol ?? "Unknown protocol"}`).join(", ") : "None returned"]]} /><p className="detail-caption">Endpoint addresses and backend health are not included in this inventory.</p><SampleNote source="Kubernetes API · services" observedAt={at} /></Disclosure>;
}
