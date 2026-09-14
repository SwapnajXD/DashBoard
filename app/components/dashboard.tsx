"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, ChevronRight, ExternalLink, Layers3, LayoutGrid, Radio, RefreshCw, Server, Terminal } from "lucide-react";
import type { InfrastructureResponse } from "../lib/types/infrastructure";
import { isInfrastructureResponse, observation } from "../lib/infrastructure/overview";
import { Badge, HostState } from "./infrastructure";
import { ApolloWorkspace, AthenaWorkspace, HermesWorkspace } from "./host-workspaces";
import { OverviewPanel, type Destination } from "./overview-panel";

export type ExternalTool = { name: string; host: string; description: string; href: string | null };
const navigation = [
  {id:"overview",name:"Overview",icon:LayoutGrid,description:"Infrastructure at a glance"},
  {id:"apollo",name:"Apollo",icon:Server,description:"Proxmox · physical host"},
  {id:"athena",name:"Athena",icon:Radio,description:"Observability · VM 100"},
  {id:"hermes",name:"Hermes",icon:Layers3,description:"K3s / containerd · VM 101"},
  {id:"tools",name:"External tools",icon:ExternalLink,description:"Existing management interfaces"},
] as const;
function ToolPanel({tools}: {tools:ExternalTool[]}) {
  return <section className="tools-panel"><div className="section-label"><h2>Open your tools</h2><span><ExternalLink size={12}/> External interfaces · new tab</span></div><div className="tool-grid">{tools.map(tool=>{
    const content=<><span className="tool-monogram">{tool.name.slice(0,1)}</span><span><strong>{tool.name}</strong><small>{tool.host} · {tool.description}</small>{tool.href?<small className="tool-destination">{tool.href}</small>:<small className="tool-unavailable">URL not configured</small>}</span>{tool.href?<ExternalLink size={16}/>:<Badge label="Unavailable"/>}</>;
    return tool.href?<a key={tool.name} className="tool-link" href={tool.href} target="_blank" rel="noopener noreferrer" aria-label={`Open ${tool.name} (external, new tab)`}>{content}</a>:<div className="tool-link disabled" key={tool.name}>{content}</div>;
  })}</div></section>;
}
export default function Dashboard({tools}: {tools:ExternalTool[]}) {
  const [data, setData] = useState<InfrastructureResponse | null>(null);
  const [syncing, setSyncing] = useState(true);
  const [error, setError] = useState("");
  const [clock, setClock] = useState<number | null>(null);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setSyncing(true);
    const timer = setTimeout(() => controller.abort("timeout"), 25000);
    try {
      const response = await fetch("/api/infrastructure", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Request failed");
      const result: unknown = await response.json();
      if (!isInfrastructureResponse(result)) throw new Error("Invalid response");
      if (request.current === controller) { setData(result); setClock(Date.now()); setError(""); }
    } catch {
      if (request.current === controller && (!controller.signal.aborted || controller.signal.reason === "timeout")) setError("Synchronization failed. Any retained observations are stale; their timestamps have not changed.");
    } finally {
      clearTimeout(timer);
      if (request.current === controller) { request.current = null; setSyncing(false); }
    }
  }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => setClock(Date.now()), 30000); return () => { request.current?.abort(); request.current = null; clearInterval(timer); }; }, [refresh]);
  const [route,setRoute]=useState<{view:Destination;focus:string}>({view:"overview",focus:""});
  const contentRef=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{
    const update=()=>{
      const [raw,...rest]=window.location.hash.slice(1).split("/");
      const view=navigation.some(item=>item.id===raw)?raw as Destination:"overview";
      let focus="";try{focus=decodeURIComponent(rest.join("/"));}catch{/* Ignore malformed navigation fragments. */}
      setRoute({view,focus});
    };
    update();window.addEventListener("hashchange",update);
    return ()=>window.removeEventListener("hashchange",update);
  },[]);
  const navigate=(view:Destination,focus="")=>{window.location.hash=`${view}${focus?`/${encodeURIComponent(focus)}`:""}`;};
  const mounted=useRef(false);
  useEffect(()=>{if(mounted.current){contentRef.current?.focus();window.scrollTo({top:0,behavior:"instant"});}else mounted.current=true;},[route.view,route.focus]);
  const current=navigation.find(item=>item.id===route.view)!;
  const selected=data?.hosts.find(item=>item.host.id===route.view);
  const stale=Boolean(error||(data&&clock&&clock-Date.parse(data.timestamp)>300000));
  const availableTools=tools.filter(tool=>tool.href).length;
  const titles={overview:"Infrastructure overview",apollo:"Apollo",athena:"Athena",hermes:"Hermes",tools:"External tools"};
  const descriptions={overview:"Your infrastructure, from host to container. Inspect a resource to go deeper.",apollo:"Physical compute, virtual machines and storage. Proxmox is the source of truth.",athena:"Observability services and container usage, with source coverage in view.",hermes:"Kubernetes workloads, placement and current resource usage.",tools:"Open the management interfaces you already use. Each link leaves Olympus."};
  return <div className="console-app">
    <a className="skip-link" href="#workspace-content" onClick={e=>{e.preventDefault();contentRef.current?.focus();}}>Skip to workspace</a>
    <aside className="sidebar"><a className="brand" href="#overview"><span className="brand-mark"><Terminal size={21}/></span><span>OLYMPUS<small>HOMELAB / V2</small></span></a><div className="sidebar-label">WORKSPACE</div><nav aria-label="Main navigation">{navigation.map(({id,name,icon:Icon})=><a href={`#${id}`} key={id} className={route.view===id?"active":""} aria-label={name} aria-current={route.view===id?"page":undefined}><Icon size={17}/><span>{name}</span>{["apollo","athena","hermes"].includes(id)?<span className={`nav-state ${data?.hosts.find(h=>h.host.id===id)?.status??"unknown"}`} title={`Reported host state: ${data?.hosts.find(h=>h.host.id===id)?.status??"unknown"}`}/>:id==="tools"?<span className="nav-count">{availableTools}</span>:null}</a>)}</nav><div className="sidebar-bottom"><span className="workstation-mark">A</span><div><strong>Artemis</strong><small>Management workstation</small></div><p>Read-only infrastructure observations</p></div></aside>
    <div className="main-column"><header className="topbar"><div className="breadcrumb"><span>Workspace</span><ChevronRight size={12}/><strong>{current.name}</strong></div><div className="topbar-actions"><span className="sync-time">Last sync <time>{observation(data?.timestamp)}</time></span><button className="refresh" onClick={()=>void refresh()} disabled={syncing}><RefreshCw size={14} className={syncing?"spin":""}/><span>{syncing?"Synchronizing…":"Sync sources"}</span></button></div></header>
      <main className="workspace"><div className="workspace-heading"><div><div className="eyebrow">{route.view==="overview"?"OPERATIONS / CURRENT SNAPSHOT":current.description.toUpperCase()}</div><h1 ref={contentRef} tabIndex={-1} id="workspace-content">{titles[route.view]}</h1><p>{descriptions[route.view]}</p></div><div className="workspace-status" aria-live="polite">{selected?<HostState status={selected.status}/>:<Badge label={syncing?"Synchronizing":stale?"Stale snapshot":data?"Snapshot collected":"Unavailable"} tone={stale?"warn":"muted"}/>}<small>{selected?`State source: ${selected.statusSource??"Not observed"}`:"On-demand · no historical telemetry"}</small></div></div>
      {stale||error?<div className="notice notice-warn" role={error?"alert":"status"}><Badge label="Stale" tone="warn"/><span>{error||"This snapshot is over five minutes old. Sync sources to refresh the observations."}</span></div>:null}
      {!data&&!syncing?<div className="notice" role="status">No valid infrastructure snapshot is available. Source details below remain unavailable.</div>:null}
      {route.view==="overview"?<><OverviewPanel data={data} stale={stale} navigate={navigate}/><ToolPanel tools={tools}/></>:null}
      {route.view==="apollo"?<><ApolloWorkspace adapters={selected?.adapters}/><ToolPanel tools={tools.filter(t=>t.host==="Apollo")}/></>:null}
      {route.view==="athena"?<><AthenaWorkspace key={route.focus} adapters={selected?.adapters} focus={route.focus}/><ToolPanel tools={tools.filter(t=>t.host==="Athena")}/></>:null}
      {route.view==="hermes"?<HermesWorkspace key={route.focus} adapters={selected?.adapters} focus={route.focus}/>:null}
      {route.view==="tools"?<><ToolPanel tools={tools}/><div className="tools-note"><ArrowUpRight size={18}/><div><h2>One console. Your existing tools.</h2><p>Olympus shows current infrastructure observations. External interfaces remain responsible for their own dashboards and controls. Only configured web addresses appear here.</p></div></div></>:null}
      <footer><span>OLYMPUS <b>/ V2</b></span><span>Artemis manages · Apollo hosts · Athena observes · Hermes runs workloads</span><span>All observation times in UTC</span></footer></main>
    </div>
  </div>;
}
