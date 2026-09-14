import React, { useState } from "react";
import { ArrowUpRight, CircleAlert, Layers3, Radio, Server } from "lucide-react";
import type { InfrastructureResponse } from "../lib/types/infrastructure";
import { adapterLabel, bytes, freshness, listOf, observation, percent, quantity, valueOf } from "../lib/infrastructure/overview";
import { ratioPercent } from "../lib/infrastructure/presentation";
import { cpuUsage, nodeResources, podResources } from "../lib/infrastructure/resources";
import { Badge, HostState } from "./infrastructure";
import { FreshnessBadge } from "./resource-details";
import { ViewSwitcher } from "./host-workspaces";

export type Destination = "overview" | "apollo" | "athena" | "hermes" | "tools";
export type Navigate = (view: Destination, focus?: string) => void;
type Attention = { host: "apollo" | "athena" | "hermes"; title: string; detail: string; severity: "warn" | "bad" | "muted" };
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
  for(const t of listOf(m?.targets)??[])if(t.health!=="online")items.push({host:"athena",title:`Scrape target ${t.health==="offline"?"down":"unknown"}: ${t.job??"unnamed"}`,detail:`Last scrape ${observation(t.lastScrape)}`,severity:t.health==="offline"?"bad":"muted"});
  for(const a of listOf(m?.alerts)??[])if(a.state==="firing")items.push({host:"athena",title:a.name,detail:`Prometheus firing alert · active since ${observation(a.activeAt)}`,severity:"bad"});
  const k=data.hosts.find(h=>h.host.id==="hermes")?.adapters.kubernetes?.data;
  for(const p of listOf(k?.pods)??[])if(p.phase==="Failed"||(p.phase==="Running"&&p.containers.some(c=>c.kind==="container"&&c.ready===false)))items.push({host:"hermes",title:p.name,detail:`${p.namespace} · ${p.phase==="Failed"?"Failed pod":"Application container reports not ready"}`,severity:p.phase==="Failed"?"bad":"warn"});
  for(const d of listOf(k?.deployments)??[])if(d.ready!=null&&d.desired!=null&&d.ready<d.desired)items.push({host:"hermes",title:d.name,detail:`${d.namespace} · ${d.ready} / ${d.desired} replicas ready`,severity:"warn"});
  return items.sort((a,b)=>({bad:0,warn:1,muted:2}[a.severity]-{bad:0,warn:1,muted:2}[b.severity]));
}
function Utilization({ label, value, detail }: {label:string;value:number|null;detail:string}) {
  const valid=value!=null&&Number.isFinite(value)&&value>=0&&value<=100;
  return <div className="compact-utilization"><div><span>{label}</span><strong>{percent(value)}</strong></div>{valid?<div className="usage-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><span style={{width:`${value}%`}} /></div>:<div className="usage-unknown">Unavailable</div>}<small>{detail}</small></div>;
}
export function OverviewPanel({ data, stale, navigate }: {data:InfrastructureResponse|null;stale:boolean;navigate:Navigate}) {
  const host=(id:string)=>data?.hosts.find(h=>h.host.id===id);
  const p=host("apollo")?.adapters.proxmox?.data,m=host("athena")?.adapters.prometheus?.data,k=host("hermes")?.adapters.kubernetes?.data;
  const apollo=listOf(p?.nodes)?.find(n=>n.hostId==="apollo"),hermesNode=listOf(k?.nodes)?.find(n=>n.name==="hermes"),hermesUsage=nodeResources("hermes",k?.nodeMetrics);
  const vms=listOf(p?.vms),pods=listOf(k?.pods),containers=listOf(m?.containers),targets=listOf(m?.targets);
  const [scope,setScope]=useState("athena"),[sort,setSort]=useState("memory"),[allIssues,setAllIssues]=useState(false);
  const issues=attentionFor(data);
  const coverage=[host("apollo")?.adapters.proxmox,host("athena")?.adapters.prometheus,host("athena")?.adapters.loki,host("hermes")?.adapters.kubernetes];
  const connected=coverage.filter(a=>a?.state==="ok"||a?.state==="partial").length;
  const stateKnown=["apollo","athena","hermes"].filter(id=>host(id)?.status==="online"||host(id)?.status==="offline").length;
  const ranked=scope==="athena"?containers?.map(c=>({focus:c.name,name:c.name,detail:"Athena · cAdvisor",cpu:valueOf(c.cpuCores)?.value??null,memory:valueOf(c.memoryWorkingSetBytes)?.value??null,at:valueOf(sort==="cpu"?c.cpuCores:c.memoryWorkingSetBytes)?.sampledAt,timing:"Evaluated",state:freshness(c.lastSeenAt,m?.containers?.timestamp)})):pods?.map(p=>{const r=podResources(p,k?.podMetrics);return {focus:`${p.namespace}/${p.name}`,name:p.name,detail:`${p.namespace} · metrics-server`,cpu:r.cpu,memory:r.memory,at:r.sample?.sampledAt,timing:"Sampled",state:r.state};});
  const ordered=ranked?.slice().sort((a,b)=>(b[sort==="cpu"?"cpu":"memory"]??-1)-(a[sort==="cpu"?"cpu":"memory"]??-1)).slice(0,5);
  return <>
    <div className="overview-strip"><div><span className="eyebrow">Reported state</span><strong>{data?`${stateKnown} / 3`:"Unavailable"}</strong><small>Host states known</small></div><div><span className="eyebrow">Source reachability</span><strong>{data?`${connected} / 4`:"Unavailable"}</strong><small>Includes partial sources</small></div><div><span className="eyebrow">Active inventory</span><strong>{pods?pods.filter(p=>p.phase==="Running").length:"Unavailable"}<span className="unit"> pods</span></strong><small>Kubernetes phase: Running</small></div><div><span className="eyebrow">Attention</span><strong className={issues.length?"warning":""}>{data?issues.length:"Unavailable"}<span className="unit"> signals</span></strong><small>{stale?"Snapshot is stale":"From available observations"}</small></div></div>
    <div className="section-label"><h2>Infrastructure</h2><span>Host state and telemetry coverage are separate signals</span></div>
    <div className="system-grid">
      <button className="system-card apollo" onClick={()=>navigate("apollo")}><div className="system-top"><Server size={19}/><span>01 / PHYSICAL HOST</span><ArrowUpRight size={17}/></div><div className="system-title"><h3>Apollo</h3><HostState status={host("apollo")?.status}/></div><p>Virtualization & storage</p><Utilization label="CPU" value={apollo?.cpuRatio==null?null:apollo.cpuRatio*100} detail={`${apollo?.cpuCount??"Unavailable"} logical CPUs`} /><Utilization label="Memory" value={ratioPercent(apollo?.memoryUsedBytes,apollo?.memoryTotalBytes)} detail={`${bytes(apollo?.memoryUsedBytes)} / ${bytes(apollo?.memoryTotalBytes)}`} /><div className="system-foot"><span>{vms?`${vms.length} VMs`:"VMs unavailable"} · {listOf(p?.storage)?.length??"Unavailable"} storage</span><small>Proxmox · observed {observation(p?.nodes.state === "available" ? p.nodes.timestamp : null)}</small><small>State: {host("apollo")?.statusSource??"Not observed"}</small></div></button>
      <button className="system-card athena" onClick={()=>navigate("athena")}><div className="system-top"><Radio size={19}/><span>02 / VM 100</span><ArrowUpRight size={17}/></div><div className="system-title"><h3>Athena</h3><HostState status={host("athena")?.status}/></div><p>Observability & container telemetry</p><Utilization label="VM CPU" value={valueOf(m?.metrics.athena.cpuPercent)?.value??null} detail="Hypervisor-observed · Proxmox Exporter"/><Utilization label="VM memory" value={valueOf(m?.metrics.athena.memoryPercent)?.value??null} detail="Hypervisor-observed · Proxmox Exporter"/><div className="system-foot"><span>{containers?`${containers.length} containers`:"Containers unavailable"} · {targets?`${targets.filter(t=>t.health==="online").length}/${targets.length} targets up`:"Targets unavailable"}</span><small>Prometheus · evaluated {observation(valueOf(m?.metrics.athena.cpuPercent)?.sampledAt)}</small><small>State: {host("athena")?.statusSource??"Not observed"}</small></div></button>
      <button className="system-card hermes" onClick={()=>navigate("hermes")}><div className="system-top"><Layers3 size={19}/><span>03 / VM 101</span><ArrowUpRight size={17}/></div><div className="system-title"><h3>Hermes</h3><HostState status={host("hermes")?.status}/></div><p>K3s workloads & cluster resources</p><div className="compact-usage"><span>Node CPU</span><strong>{cpuUsage(hermesUsage.cpu)}</strong><small>Capacity {quantity(hermesNode?.capacity.cpu)??"Unavailable"} cores</small></div><div className="compact-usage"><span>Node memory</span><strong>{bytes(hermesUsage.memory)}</strong><small><FreshnessBadge state={hermesUsage.state}/></small></div><div className="system-foot"><span>{pods?`${pods.length} pods`:"Pods unavailable"} · {valueOf(k?.version)??"Version unavailable"}</span><small>metrics-server · sampled {observation(hermesUsage.sample?.sampledAt)}</small><small>State: {host("hermes")?.statusSource??"Not observed"}</small></div></button>
    </div>
    <div className="overview-bottom"><section className="panel consumers"><div className="panel-heading"><div><span className="eyebrow">Current snapshot</span><h2>Resource consumers</h2></div><label className="sort-field">Rank by <select value={sort} onChange={e=>setSort(e.target.value)}><option value="memory">Memory</option><option value="cpu">CPU</option></select></label></div><ViewSwitcher value={scope} onChange={setScope} items={[{id:"athena",label:"Athena containers"},{id:"hermes",label:"Hermes pods"}]} />
      <div className="consumer-heading"><span>Resource / source</span><span>{sort==="cpu"?"CPU usage":"Memory usage"}</span></div>{ordered?.map((item,i)=><button className="consumer-row" key={item.name+item.detail} onClick={()=>navigate(scope as "athena"|"hermes",item.focus)}><span className="rank">{String(i+1).padStart(2,"0")}</span><span className="consumer-name"><strong>{item.name}</strong><small>{item.detail}</small><small>{item.timing} {observation(item.at)} · {item.state}</small></span><strong className="consumer-value">{sort==="cpu"?cpuUsage(item.cpu):bytes(item.memory)}</strong><ChevronArrow/></button>)}{!ordered?<p className="empty">Resource readings are unavailable.</p>:ordered.length===0?<p className="empty">No resources returned by this source.</p>:null}<div className="panel-foot"><span>Top five returned resources · unavailable values rank last</span><button onClick={()=>navigate(scope as "athena"|"hermes")}>Explore all <ArrowUpRight size={13}/></button></div>
    </section><section className="panel attention"><div className="panel-heading"><div><span className="eyebrow">Operational signals</span><h2>Needs attention</h2></div><Badge label={data?`${issues.length} signals`:"Unavailable"} tone={issues.length?"warn":"muted"}/></div><p className="panel-description">Reported issues and collection gaps. This is not an end-to-end health check.</p>
      {(allIssues?issues:issues.slice(0,5)).map((item,i)=><button className={`attention-row ${item.severity}`} key={`${item.title}/${i}`} onClick={()=>navigate(item.host)}><CircleAlert size={16}/><span><strong>{item.title}</strong><small>{item.detail}</small></span><ArrowUpRight size={14}/></button>)}{!data?<p className="empty">Synchronize sources to inspect infrastructure state.</p>:!issues.length?<p className="empty">No issues reported by the available observations.{stale?" The snapshot is stale.":""}</p>:null}{issues.length>5?<button className="show-more" onClick={()=>setAllIssues(!allIssues)}>{allIssues?"Show fewer signals":`Show all ${issues.length} signals`}</button>:null}
    </section></div>
  </>;
}
function ChevronArrow(){return <ArrowUpRight size={14}/>;}
