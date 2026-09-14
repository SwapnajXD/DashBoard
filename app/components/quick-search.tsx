"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, ExternalLink, Search, X } from "lucide-react";
import type { InfrastructureResponse } from "../lib/types/infrastructure";
import { listOf } from "../lib/infrastructure/overview";
import type { ExternalTool } from "./dashboard";
import type { Destination, Navigate } from "./overview-panel";

type Result = { id: string; name: string; detail: string; view?: Destination; focus?: string; href?: string };

export function QuickSearch({ data, tools, navigate }: { data: InfrastructureResponse | null; tools: ExternalTool[]; navigate: Navigate }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const index = useMemo(() => {
    const results: Result[] = [
      { id: "apollo", name: "Apollo", detail: "Proxmox host", view: "apollo" },
      { id: "athena", name: "Athena", detail: "Observability VM", view: "athena" },
      { id: "hermes", name: "Hermes", detail: "Kubernetes VM", view: "hermes" },
      { id: "logs", name: "Live logs", detail: "Athena / Loki", view: "athena", focus: "@live-logs" },
    ];
    const host = (id: string) => data?.hosts.find(item => item.host.id === id);
    const p = host("apollo")?.adapters.proxmox?.data;
    const m = host("athena")?.adapters.prometheus?.data;
    const k = host("hermes")?.adapters.kubernetes?.data;
    for (const vm of listOf(p?.vms) ?? []) results.push({ id: `vm/${vm.id}`, name: vm.name ?? "Unnamed VM", detail: `VM ${vm.vmId ?? "Unavailable"} / Apollo`, view: "apollo", focus: `@machines/${vm.id}` });
    for (const item of listOf(p?.storage) ?? []) results.push({ id: `storage/${item.id}`, name: item.name ?? item.id, detail: "Storage / Apollo", view: "apollo", focus: `@storage/${item.id}` });
    for (const container of listOf(m?.containers) ?? []) results.push({ id: `container/${container.name}`, name: container.name, detail: "Container / Athena", view: "athena", focus: container.name });
    for (const pod of listOf(k?.pods) ?? []) results.push({ id: `pod/${pod.namespace}/${pod.name}`, name: pod.name, detail: `Pod / ${pod.namespace} / Hermes`, view: "hermes", focus: `${pod.namespace}/${pod.name}` });
    for (const service of listOf(k?.services) ?? []) results.push({ id: `service/${service.namespace}/${service.name}`, name: service.name, detail: `Service / ${service.namespace} / Hermes`, view: "hermes", focus: `@services/${service.namespace}/${service.name}` });
    for (const ingress of listOf(k?.ingresses) ?? []) results.push({ id: `ingress/${ingress.namespace}/${ingress.name}`, name: ingress.name, detail: `Ingress / ${ingress.namespace} / Hermes`, view: "hermes", focus: `@ingresses/${ingress.namespace}/${ingress.name}` });
    for (const tool of tools) if (tool.href) results.push({ id: `tool/${tool.name}`, name: tool.name, detail: `${tool.host} / External tool`, href: tool.href });
    return results;
  }, [data, tools]);
  const matches = query.trim() ? index.filter(item => `${item.name} ${item.detail}`.toLowerCase().includes(query.trim().toLowerCase())) : [];
  const close = () => { setQuery(""); setOpen(false); };
  return <div className="quick-search" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }} onKeyDown={event => { if (event.key === "Escape") close(); }}>
    <label><Search size={14}/><span className="sr-only">Search hosts, resources and tools</span><input type="search" value={query} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true); }} placeholder="Find a resource…" autoComplete="off" aria-controls={open && query.trim() ? "resource-search-results" : undefined}/></label>
    {open && query.trim() ? <div className="search-results" id="resource-search-results" role="region" aria-label="Resource search results">
      <div className="search-result-heading"><span>{matches.length} matches in current inventory</span><button onClick={close} aria-label="Close search"><X size={14}/></button></div>
      {matches.slice(0,12).map(item => item.href ? <a key={item.id} href={item.href} target="_blank" rel="noopener noreferrer" onClick={close}><span><strong>{item.name}</strong><small>{item.detail} · new tab</small></span><ExternalLink size={13}/></a> : <button key={item.id} onClick={() => { if (item.view) navigate(item.view,item.focus); close(); }}><span><strong>{item.name}</strong><small>{item.detail}</small></span><ArrowUpRight size={13}/></button>)}
      {!matches.length ? <p>No matching resources.{!data ? " Inventory has not been collected yet." : ""}</p> : matches.length > 12 ? <p>Showing 12 matches. Refine your search to narrow the results.</p> : null}
    </div> : null}
  </div>;
}
