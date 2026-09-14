import React, { useState } from "react";
import { ArrowUpRight, CircleAlert, ExternalLink, Layers3, Radio, Server, VideoOff } from "lucide-react";
import type { InfrastructureResponse } from "../lib/types/infrastructure";
import type { ExternalTool } from "./dashboard";
import { adapterLabel, bytes, duration, freshness, listOf, observation, percent, valueOf } from "../lib/infrastructure/overview";
import { ratioPercent } from "../lib/infrastructure/presentation";
import { cpuUsage, nodeResources, podResources } from "../lib/infrastructure/resources";
import { Badge, HostState } from "./infrastructure";
import { AthenaContainerDetail, FreshnessBadge, PodDetail, StorageDetail, VmDetail } from "./resource-details";
import { LiveLogs } from "./live-logs";

export type Destination = "overview" | "apollo" | "athena" | "hermes" | "tools";
export type Navigate = (view: Destination, focus?: string) => void;
type Attention = { host: "apollo" | "athena" | "hermes"; title: string; detail: string; severity: "warn" | "bad" | "muted"; focus?: string };
export function attentionFor(data: InfrastructureResponse | null): Attention[] {
  if (!data) return [];
  const items: Attention[]=[];
  for(const host of data.hosts){
    if(!["apollo","athena","hermes"].includes(host.host.id))continue;
    const id=host.host.id as Attention["host"];
    if(host.status!=="online")items.push({host:id,title:host.status==="offline"?`${host.host.name} reports offline`:`${host.host.name} state unavailable`,detail:host.statusSource??"No conclusive host-state observation",severity:host.status==="offline"?"bad":"muted"});
    for(const [source,adapter] of Object.entries(host.adapters))if(adapter.state!=="ok")items.push({host:id,title:`${host.host.name} · ${source} ${adapterLabel(adapter).toLowerCase()}`,detail:adapter.error?.message??"Some source readings are unavailable. Inspect source details.",severity:adapter.state==="error"?"bad":"warn"});
  }
  const m=data.hosts.find(h=>h.host.id==="athena")?.adapters.prometheus?.data;
  for(const t of listOf(m?.targets)??[])if(t.health!=="online")items.push({host:"athena",focus:"@targets",title:`Scrape target ${t.health==="offline"?"down":"unknown"}: ${t.job??"unnamed"}`,detail:`Last scrape ${observation(t.lastScrape)}`,severity:t.health==="offline"?"bad":"muted"});
  for(const a of listOf(m?.alerts)??[])if(a.state==="firing")items.push({host:"athena",focus:"@alerts",title:a.name,detail:`Prometheus firing alert · active since ${observation(a.activeAt)}`,severity:"bad"});
  const k=data.hosts.find(h=>h.host.id==="hermes")?.adapters.kubernetes?.data;
  for(const p of listOf(k?.pods)??[])if(p.phase==="Failed"||(p.phase==="Running"&&p.containers.some(c=>c.kind==="container"&&c.ready===false)))items.push({host:"hermes",focus:`${p.namespace}/${p.name}`,title:p.name,detail:`${p.namespace} · ${p.phase==="Failed"?"Failed pod":"Application container reports not ready"}`,severity:p.phase==="Failed"?"bad":"warn"});
  for(const d of listOf(k?.deployments)??[])if(d.ready!=null&&d.desired!=null&&d.ready<d.desired)items.push({host:"hermes",focus:`@deployments/${d.namespace}/${d.name}`,title:d.name,detail:`${d.namespace} · ${d.ready} / ${d.desired} replicas ready`,severity:"warn"});
  return items.sort((a,b)=>({bad:0,warn:1,muted:2}[a.severity]-{bad:0,warn:1,muted:2}[b.severity]));
}
function Readout({ label, value, detail, ratio }: { label: string; value: React.ReactNode; detail?: string; ratio?: number | null }) {
  const metered = ratio != null && Number.isFinite(ratio) && ratio >= 0 && ratio <= 100;
  return <div className="console-readout"><span>{label}</span><strong>{value}</strong>{metered ? <div className="usage-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={ratio}><span style={{ width: `${ratio}%` }}/></div> : null}{detail ? <small>{detail}</small> : null}</div>;
}
function PanelHeading({ title, subtitle, icon, state, open }: { title: string; subtitle: string; icon: React.ReactNode; state?: React.ReactNode; open?: () => void }) {
  return <header className="console-panel-heading"><div className="panel-identity">{icon}<div>{open ? <button className="panel-title" onClick={open}>{title}<ArrowUpRight size={13}/></button> : <h2>{title}</h2>}<small>{subtitle}</small></div></div>{state}</header>;
}

export function OverviewPanel({ data, stale, syncing, error, tools, navigate }: { data: InfrastructureResponse | null; stale: boolean; syncing: boolean; error: string; tools: ExternalTool[]; navigate: Navigate }) {
  const host = (id: string) => data?.hosts.find(item => item.host.id === id);
  const apolloHost = host("apollo"), athenaHost = host("athena"), hermesHost = host("hermes");
  const p = apolloHost?.adapters.proxmox?.data, m = athenaHost?.adapters.prometheus?.data, k = hermesHost?.adapters.kubernetes?.data;
  const apollo = listOf(p?.nodes)?.find(node => node.hostId === "apollo");
  const node = listOf(k?.nodes)?.find(item => item.name === "hermes");
  const usage = nodeResources("hermes", k?.nodeMetrics);
  const vms = listOf(p?.vms), storage = listOf(p?.storage), containers = listOf(m?.containers), pods = listOf(k?.pods), services = listOf(k?.services), ingresses = listOf(k?.ingresses);
  const [rank, setRank] = useState("memory");
  const [logsOpen, setLogsOpen] = useState(false);
  const issues = attentionFor(data);
  const vmPreview = vms?.slice().sort((a,b) => Number(b.vmId === 100 || b.vmId === 101) - Number(a.vmId === 100 || a.vmId === 101)).slice(0,4);
  const topContainers = containers?.slice().sort((a,b) => (valueOf(rank === "cpu" ? b.cpuCores : b.memoryWorkingSetBytes)?.value ?? -1) - (valueOf(rank === "cpu" ? a.cpuCores : a.memoryWorkingSetBytes)?.value ?? -1)).slice(0,3);
  const topPods = pods?.map(pod => ({ pod, usage: podResources(pod, k?.podMetrics) })).sort((a,b) => (b.usage.memory ?? -1) - (a.usage.memory ?? -1)).slice(0,3);
  const athenaCpu = valueOf(m?.metrics.athena.cpuPercent), athenaMemory = valueOf(m?.metrics.athena.memoryPercent);
  const containerCount = pods?.reduce((total,pod) => total + pod.containers.length,0);
  const configuredTools = tools.filter(tool => tool.href);

  return <div className="cockpit">
    {issues.length || stale || (!data && !syncing) ? <section className="priority-strip" aria-label="Priority observations">
      <div className="priority-label"><CircleAlert size={15}/><strong>Priority</strong><span>{issues.length + (stale ? 1 : 0) + (!data && !syncing && !stale ? 1 : 0)}</span></div>
      <div className="priority-items">
        {stale ? <div className="priority-item warn" role={error ? "alert" : "status"}><Badge label={data ? "Stale snapshot" : "Unavailable"} tone="warn"/><small>{error || "Snapshot is over five minutes old. Sync sources to refresh."}</small></div> : null}
        {!data && !syncing && !stale ? <div className="priority-item"><Badge label="Unavailable"/><small>No valid infrastructure snapshot is available.</small></div> : null}
        {issues.map((item,index) => <button key={`${item.host}/${index}`} className={`priority-item ${item.severity}`} onClick={() => navigate(item.host,item.focus)}><strong>{item.title}<ArrowUpRight size={12}/></strong><small>{item.detail}</small></button>)}
      </div>
    </section> : null}

    <div className="primary-grid">
      <section className="console-panel apollo-console" aria-label="Apollo Proxmox infrastructure">
        <PanelHeading title="Apollo" subtitle="Proxmox / Physical host" icon={<Server size={18}/>} state={<HostState status={apolloHost?.status}/>} open={() => navigate("apollo","@host")}/>
        <div className="console-readouts three">
          <Readout label="Host CPU" value={percent(apollo?.cpuRatio == null ? null : apollo.cpuRatio * 100)} ratio={apollo?.cpuRatio == null ? null : apollo.cpuRatio * 100} detail={`${apollo?.cpuCount ?? "Unavailable"} logical CPUs`}/>
          <Readout label="Memory" value={percent(ratioPercent(apollo?.memoryUsedBytes,apollo?.memoryTotalBytes))} ratio={ratioPercent(apollo?.memoryUsedBytes,apollo?.memoryTotalBytes)} detail={`${bytes(apollo?.memoryUsedBytes)} / ${bytes(apollo?.memoryTotalBytes)}`}/>
          <Readout label="Node disk" value={percent(ratioPercent(apollo?.storageUsedBytes,apollo?.storageTotalBytes))} ratio={ratioPercent(apollo?.storageUsedBytes,apollo?.storageTotalBytes)} detail={`${bytes(apollo?.storageUsedBytes)} / ${bytes(apollo?.storageTotalBytes)}`}/>
        </div>
        <div className="subpanel-heading"><h3>Virtual machines <span>{vms?.length ?? "Unavailable"}</span></h3><button className="inline-link" onClick={() => navigate("apollo")}>All VMs <ArrowUpRight size={12}/></button></div>
        <div className="console-resource-list">{vmPreview?.map(vm => <VmDetail key={vm.id} vm={vm} at={p?.vms.timestamp}/>)}{!vms ? <p className="empty">VM inventory unavailable.</p> : !vms.length ? <p className="empty">No VMs returned.</p> : null}</div>
        <details className="inventory-group"><summary>Storage inventory <span>{storage?.length ?? "Unavailable"}</span></summary><div className="console-resource-list">{storage?.slice(0,4).map(item => <StorageDetail key={item.id} item={item} at={p?.storage.timestamp}/>)}{!storage ? <p className="empty">Storage inventory unavailable.</p> : !storage.length ? <p className="empty">No storage resources returned.</p> : null}<button className="inline-link" onClick={() => navigate("apollo","@storage")}>Open storage inventory <ArrowUpRight size={12}/></button></div></details>
        <div className="console-provenance"><span>Uptime {duration(apollo?.uptimeSeconds)}</span><span>Proxmox · {observation(p?.nodes.state === "available" ? p.nodes.timestamp : null)}</span><span>State: {apolloHost?.statusSource ?? "Not observed"}</span></div>
      </section>

      <section className="console-panel camera-console" aria-label="Camera 01 unconfigured">
        <PanelHeading title="Camera 01" subtitle="Visual monitoring / Input unassigned" icon={<VideoOff size={18}/>} state={<Badge label="Not configured"/>}/>
        <div className="camera-viewport"><span className="camera-corner">CAM / 01</span><div><VideoOff size={28} strokeWidth={1}/><p>No camera stream configured.</p><small>Reserved for a future live feed</small></div><span className="camera-corner bottom">NO SOURCE</span></div>
        <div className="console-provenance"><span>Video input</span><span>Not configured</span></div>
      </section>
    </div>

    <div className="workload-grid">
      <section className="console-panel athena-console" aria-label="Athena observability">
        <PanelHeading title="Athena" subtitle="VM 100 / Observability" icon={<Radio size={18}/>} state={<HostState status={athenaHost?.status}/>} open={() => navigate("athena")}/>
        <div className="source-chips">
          {(["prometheus","loki"] as const).map(source => { const adapter = athenaHost?.adapters[source]; return <button key={source} onClick={() => navigate("athena",source === "loki" ? "@live-logs" : "@targets")}><span>{source}</span><Badge label={adapterLabel(adapter)} tone={adapter?.state === "ok" ? "good" : adapter?.state === "partial" ? "warn" : adapter?.state === "error" ? "bad" : "muted"}/></button>; })}
          {tools.filter(tool => tool.name === "Grafana" || tool.name === "Alloy").map(tool => tool.href ? <a key={tool.name} href={tool.href} target="_blank" rel="noopener noreferrer" aria-label={`Open ${tool.name} in a new tab`}>{tool.name}<ExternalLink size={12}/></a> : <span className="unconfigured-chip" key={tool.name}>{tool.name}<Badge label="Not configured"/></span>)}
          {containers?.filter(item => ["alloy","cadvisor"].includes(item.name.toLowerCase()) && !tools.some(tool => tool.href && tool.name.toLowerCase() === item.name.toLowerCase())).map(item => <button key={`observed/${item.name}`} onClick={() => navigate("athena",item.name)}><span>{item.name}</span><FreshnessBadge state={freshness(item.lastSeenAt,m?.containers?.timestamp)}/></button>)}
        </div>
        <div className="console-readouts three">
          <Readout label="VM CPU" value={percent(athenaCpu?.value)} detail="Hypervisor-observed"/>
          <Readout label="VM memory" value={percent(athenaMemory?.value)} detail="Hypervisor-observed"/>
          <Readout label="Containers" value={containers?.length ?? "Unavailable"} detail="cAdvisor observations"/>
        </div>
        <div className="subpanel-heading"><h3>Top containers</h3><label className="sort-field">Rank <select value={rank} onChange={event => setRank(event.target.value)}><option value="memory">Memory</option><option value="cpu">CPU</option></select></label></div>
        <div className="console-resource-list">{topContainers?.map(item => <AthenaContainerDetail key={item.name} item={item} at={m?.containers?.timestamp}/>)}{!containers ? <p className="empty">Container observations unavailable.</p> : !containers.length ? <p className="empty">No containers returned.</p> : null}</div>
        <div className="console-actions"><span>Top 3 · unavailable readings rank last</span><button className="inline-link" onClick={() => navigate("athena")}>All containers <ArrowUpRight size={12}/></button></div>
        <details className="inventory-group log-drawer" onToggle={event => setLogsOpen(event.currentTarget.open)}><summary>Recent live logs <span>Loki</span></summary>{logsOpen ? <LiveLogs compact/> : null}<button className="inline-link" onClick={() => navigate("athena","@live-logs")}>Open full live logs <ArrowUpRight size={12}/></button></details>
        <div className="console-provenance"><span>VM CPU evaluated {observation(athenaCpu?.sampledAt)}</span><span>State: {athenaHost?.statusSource ?? "Not observed"}</span></div>
      </section>

      <section className="console-panel hermes-console" aria-label="Hermes Kubernetes">
        <PanelHeading title="Hermes" subtitle={`VM 101 / ${valueOf(k?.version) ?? "K3s version unavailable"}`} icon={<Layers3 size={18}/>} state={<HostState status={hermesHost?.status}/>} open={() => navigate("hermes")}/>
        <div className="node-state"><button className="inline-link" onClick={() => navigate("hermes","@nodes")}>Node {node?.name ?? "Unavailable"}<ArrowUpRight size={12}/></button><Badge label={node?.status === "online" ? "Ready" : node?.status === "offline" ? "Not ready" : "Unavailable"} tone={node?.status === "online" ? "good" : node?.status === "offline" ? "bad" : "muted"}/><FreshnessBadge state={usage.state}/></div>
        <div className="kube-counts">
          <button onClick={() => navigate("hermes")}><strong>{pods?.length ?? "Unavailable"}</strong><span>Pods</span></button>
          <button onClick={() => navigate("hermes")}><strong>{containerCount ?? "Unavailable"}</strong><span>Declared containers</span></button>
          <button onClick={() => navigate("hermes","@services")}><strong>{services?.length ?? "Unavailable"}</strong><span>Services</span></button>
          <button onClick={() => navigate("hermes","@ingresses")}><strong>{ingresses?.length ?? "Unavailable"}</strong><span>Ingresses</span></button>
        </div>
        <div className="console-readouts two"><Readout label="Node CPU" value={cpuUsage(usage.cpu)}/><Readout label="Node memory" value={bytes(usage.memory)}/></div>
        <div className="subpanel-heading"><h3>Pods / resource usage</h3><span>Top 3 by memory</span></div>
        <div className="console-resource-list">{topPods?.map(({pod}) => <PodDetail key={`${pod.namespace}/${pod.name}`} pod={pod} metrics={k?.podMetrics} inventoryAt={k?.pods.timestamp}/>)}{!pods ? <p className="empty">Pod inventory unavailable.</p> : !pods.length ? <p className="empty">No pods returned.</p> : null}</div>
        <div className="console-actions"><span>Namespace-aware · expand for containers</span><button className="inline-link" onClick={() => navigate("hermes")}>All pods <ArrowUpRight size={12}/></button></div>
        <div className="console-provenance"><span>metrics-server · {observation(usage.sample?.sampledAt)}</span><span>State: {hermesHost?.statusSource ?? "Not observed"}</span></div>
      </section>
    </div>

    <section className="console-panel services-console" aria-label="Control plane services">
      <div className="subpanel-heading"><h2>Control plane</h2><span>Workspaces · configured tools · discovered services</span></div>
      <div className="service-tiles">
        {(["apollo","athena","hermes"] as const).map(id => <button className="service-tile" key={id} onClick={() => navigate(id)}><span className="service-tile-title">{id}<ArrowUpRight size={12}/></span><HostState status={host(id)?.status}/><small>Host workspace</small></button>)}
        {configuredTools.map(tool => <a className="service-tile" href={tool.href!} target="_blank" rel="noopener noreferrer" key={tool.name} aria-label={`Open ${tool.name} in a new tab`}><span className="service-tile-title">{tool.name}<ExternalLink size={12}/></span><small>{tool.host} / External tool</small><small>Configured link · health not inferred</small></a>)}
        {services?.slice(0,8).map(service => <button className="service-tile" key={`${service.namespace}/${service.name}`} onClick={() => navigate("hermes",`@services/${service.namespace}/${service.name}`)}><span className="service-tile-title">{service.name}<ArrowUpRight size={12}/></span><small>{service.namespace} / {service.type ?? "Type unavailable"}</small><small>Inventory · health not collected</small></button>)}
      </div>
      {services && services.length > 8 ? <button className="inline-link" onClick={() => navigate("hermes","@services")}>All {services.length} Kubernetes services <ArrowUpRight size={12}/></button> : null}
    </section>
  </div>;
}
