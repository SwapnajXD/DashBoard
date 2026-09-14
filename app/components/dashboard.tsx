"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, ExternalLink, Layers3, LayoutGrid, Moon, Radio, RefreshCw, Server, Sun } from "lucide-react";
import type { InfrastructureResponse } from "../lib/types/infrastructure";
import { isInfrastructureResponse, observation } from "../lib/infrastructure/overview";
import { Badge, HostState, SectionHeading } from "./infrastructure";
import { ApolloWorkspace, AthenaWorkspace, HermesWorkspace } from "./host-workspaces";
import { attentionFor, OverviewPanel, type Destination } from "./overview-panel";

import { QuickSearch } from "./quick-search";

export type ExternalTool = { name: string; host: string; description: string; href: string | null };
const navigation = [
  {id:"overview",name:"Overview",icon:LayoutGrid,description:"Infrastructure at a glance"},
  {id:"apollo",name:"Apollo",icon:Server,description:"Proxmox · physical host"},
  {id:"athena",name:"Athena",icon:Radio,description:"Observability · VM 100"},
  {id:"hermes",name:"Hermes",icon:Layers3,description:"K3s / containerd · VM 101"},
  {id:"tools",name:"External tools",icon:ExternalLink,description:"Existing management interfaces"},
] as const;
function ToolPanel({tools, number = "02"}: {tools:ExternalTool[]; number?: string}) {
  return <section className="tools-panel"><SectionHeading number={number} title="Control plane" note="External interfaces ↗ new tab"/><div className="tool-grid">{tools.map((tool,index)=>{
    const content=<><span className="tool-monogram">{String(index + 1).padStart(2,"0")}</span><span><strong>{tool.name}</strong><small>{tool.host} · {tool.description}</small>{tool.href?<small className="tool-destination">{tool.href}</small>:<small className="tool-unavailable">URL not configured</small>}</span>{tool.href?<ExternalLink size={16}/>:<Badge label="Not configured"/>}</>;
    return tool.href?<a key={tool.name} className="tool-link" href={tool.href} target="_blank" rel="noopener noreferrer" aria-label={`Open ${tool.name} (external, new tab)`}>{content}</a>:<div className="tool-link disabled" key={tool.name}>{content}</div>;
  })}</div></section>;
}
export default function Dashboard({tools}: {tools:ExternalTool[]}) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    let preferred: "dark" | "light" = "dark";
    try { if (localStorage.getItem("olympus-theme-v1") === "light") preferred = "light"; } catch { /* Theme still works when storage is unavailable. */ }
    setTheme(preferred);
    document.documentElement.dataset.theme = preferred;
  }, []);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("olympus-theme-v1",next); } catch { /* Preference remains active for this session. */ }
  };
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
  const signalCount = attentionFor(data).length;
  const snapshotLabel = stale ? "Stale snapshot" : syncing ? "Synchronizing" : !data ? "Unavailable" : signalCount ? `${signalCount} attention signals` : "Snapshot collected";
  const titles={overview:"Infrastructure cockpit",apollo:"Apollo",athena:"Athena",hermes:"Hermes",tools:"External tools"};
  const descriptions={overview:"A personal infrastructure operating interface.",apollo:"Physical compute, virtual machines and storage. Proxmox is the source of truth.",athena:"Observability services and container usage, with source coverage in view.",hermes:"Kubernetes workloads, placement and current resource usage.",tools:"Open the management interfaces you already use. Each link leaves Olympus."};
  return <div className="console-app" data-view={route.view}>
    <a className="skip-link" href="#workspace-content" onClick={event => { event.preventDefault(); contentRef.current?.focus(); }}>Skip to workspace</a>
    <header className="site-header">
      <a className="brand" href="#overview" aria-label="Olympus overview"><span className="brand-symbol"><Layers3 size={20}/></span><span>OLYMPUS<small>Infrastructure control plane</small></span></a>
      <div className="header-state" aria-live="polite"><Badge label={snapshotLabel} tone={stale || signalCount ? "warn" : "muted"}/><small>Current observations / Artemis</small></div>
      <QuickSearch data={data} tools={tools} navigate={navigate}/>
      <div className="header-actions"><button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>{theme === "dark" ? <Sun size={16}/> : <Moon size={16}/>}</button><button className="refresh" onClick={() => void refresh()} disabled={syncing}><RefreshCw size={14} className={syncing ? "spin" : ""}/><span>{syncing ? "Syncing…" : "Sync"}</span></button></div>
    </header>
    <div className="topbar"><nav aria-label="Main navigation">{navigation.map(({id,name,icon:Icon}) => <a href={`#${id}`} key={id} className={route.view === id ? "active" : ""} aria-current={route.view === id ? "page" : undefined}><Icon size={13}/>{name}{["apollo","athena","hermes"].includes(id) ? <span className={`nav-state ${data?.hosts.find(host => host.host.id === id)?.status ?? "unknown"}`} title={`Reported host state: ${data?.hosts.find(host => host.host.id === id)?.status ?? "unknown"}`}/> : id === "tools" ? <span className="nav-count">{availableTools}</span> : null}</a>)}</nav><span className="sync-time">Last sync <time>{observation(data?.timestamp)}</time></span></div>
    <main className="workspace">
      {route.view === "overview" ? <h1 ref={contentRef} tabIndex={-1} id="workspace-content" className="sr-only">Infrastructure cockpit</h1> : <div className="workspace-heading"><div><div className="eyebrow">{current.description}</div><h1 ref={contentRef} tabIndex={-1} id="workspace-content">{titles[route.view]}</h1><p>{descriptions[route.view]}</p></div>{selected ? <div className="workspace-status"><HostState status={selected.status}/><small>State source: {selected.statusSource ?? "Not observed"}</small></div> : null}</div>}
      {route.view !== "overview" && (stale || error) ? <div className="notice notice-warn" role={error ? "alert" : "status"}><Badge label={data ? "Stale" : "Unavailable"} tone="warn"/><span>{error || "This snapshot is over five minutes old. Sync sources to refresh the observations."}</span></div> : null}
      {route.view === "overview" ? <OverviewPanel data={data} stale={stale} syncing={syncing} error={error} tools={tools} navigate={navigate}/> : null}
      {route.view === "apollo" ? <><ApolloWorkspace key={route.focus} adapters={selected?.adapters} focus={route.focus}/><ToolPanel tools={tools.filter(tool => tool.host === "Apollo")}/></> : null}
      {route.view === "athena" ? <><AthenaWorkspace key={route.focus} adapters={selected?.adapters} focus={route.focus}/><ToolPanel tools={tools.filter(tool => tool.host === "Athena")}/></> : null}
      {route.view === "hermes" ? <HermesWorkspace key={route.focus} adapters={selected?.adapters} focus={route.focus}/> : null}
      {route.view === "tools" ? <><ToolPanel tools={tools}/><div className="tools-note"><ArrowUpRight size={18}/><div><h2>Your existing tools</h2><p>Configured links open their own interfaces in a new tab. Link availability does not establish service health.</p></div></div></> : null}
      <footer><span>OLYMPUS / CONTROL PLANE</span><span>Read-only observations · All timestamps UTC</span><span>Artemis manages · Apollo hosts · Athena observes · Hermes runs</span></footer>
    </main>
  </div>;
}
