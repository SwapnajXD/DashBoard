"use client";

import {
  Activity, Box, CheckCircle2, ChevronRight, CircleDot,
  Cloud, Container, Cpu, Database, Gauge, HardDrive, Layers3, Network,
  Radio, RefreshCw, Search, Server, ShieldCheck, Terminal, Video, Wifi, Zap
} from "lucide-react";
import { infrastructureView } from "@/app/lib/infrastructure/presentation";
import type { HostStatus, InfrastructureResponse } from "@/app/lib/types/infrastructure";
import { useCallback, useEffect, useMemo, useState } from "react";

type Status = HostStatus;

type Service = { name: string; type: string; status: HostStatus; host: string };

const serviceInventory: Omit<Service, "status">[] = [
  { name: "Grafana", type: "Observability", host: "Athena" },
  { name: "Prometheus", type: "Metrics", host: "Athena" },
  { name: "Loki", type: "Logging", host: "Athena" },
  { name: "Grafana Alloy", type: "Telemetry", host: "Athena" },
  { name: "cAdvisor", type: "Container metrics", host: "Athena" },
  { name: "Node Exporter", type: "Metrics", host: "Athena" },
  { name: "Proxmox Exporter", type: "Infrastructure", host: "Athena" },
  { name: "K3s", type: "Kubernetes", host: "Hermes" },
  { name: "Olympus", type: "Control Plane", host: "Hermes" }
];
const observabilityServices = ["Grafana", "Prometheus", "Loki", "Grafana Alloy", "Node Exporter", "cAdvisor", "Proxmox Exporter"];
const adminTools = ["Cluster administration", "Infrastructure management", "Olympus development"];
function StatusDot({ status = "unknown" }: { status?: Status }) {
  return <span className={`dot ${status}`} aria-hidden="true" />;
}

function Metric({ label, value, percent, icon: Icon }: { label: string; value: string; percent: number | null; icon: typeof Cpu }) {
  return (
    <div className="metric">
      <div className="metric-head"><span>{label}</span><Icon size={13} /></div>
      <div className="metric-value">{value}</div>
      <div className="bar">{percent !== null && <span style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />}</div>
    </div>
  );
}

function ServiceCard({ service }: { service: Service }) {
  const uncertain = service.status !== "online";
  return (
    <div className="service-card">
      <div className="service-icon"><Box size={16} /></div>
      <div className="service-main">
        <div className="service-name">{service.name}</div>
        <div className="service-type">{service.type} · {service.host}</div>
      </div>
      <div className={`service-status ${uncertain ? "warn" : ""}`}>
        <StatusDot status={service.status} /> {service.status.toUpperCase()}
      </div>
    </div>
  );
}

function SectionLabel({ number, children, status, muted = false }: { number: string; children: React.ReactNode; status: string; muted?: boolean }) {
  return <div className="section-label"><span>{number}</span>{children}<em className={muted ? "muted" : ""}>{status}</em></div>;
}

export default function HomePage() {
  const [now, setNow] = useState<Date | null>(null);
  const [query, setQuery] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [infrastructure, setInfrastructure] = useState<InfrastructureResponse | null>(null);
  const [syncError, setSyncError] = useState("");
  const view = infrastructureView(infrastructure);
  const percent = (value: number | null) => value === null ? "Unavailable" : `${value.toFixed(1)}%`;

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const filteredServices = useMemo(() => {
    const q = query.trim().toLowerCase();
    const services = serviceInventory.map(service => ({ ...service, status: infrastructureView(infrastructure).serviceStatus(service.name) }));
    if (!q) return services;
    return services.filter((service) => `${service.name} ${service.type} ${service.host}`.toLowerCase().includes(q));
  }, [query, infrastructure]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setSyncing(true);
    setSyncError("");
    try {
      const response = await fetch("/api/infrastructure", { cache: "no-store", signal });
      if (!response.ok) throw new Error("Infrastructure request failed");
      const data: InfrastructureResponse = await response.json();
      if (signal?.aborted) return;
      setInfrastructure(data);
      setLastSync(new Date(data.timestamp));
    } catch {
      if (!signal?.aborted) setSyncError("Sync failed; previous adapter results may be stale.");
    } finally {
      if (!signal?.aborted) setSyncing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Terminal size={15} /></div>
          <div><div className="brand-name">OLYMPUS</div><div className="brand-sub">CONTROL PLANE / HOMELAB</div></div>
        </div>
        <div className="global-status"><StatusDot /><span>V2 CONTROL PLANE</span></div>
        <div className="top-actions">
          <label className="search"><Search size={12} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search services..." /></label>
          <button className="refresh" onClick={() => void refresh()} disabled={syncing} title="Refresh telemetry"><RefreshCw size={13} className={syncing ? "spin" : ""} /> SYNC</button>
          <div className="clock">{now ? now.toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" }) : "—"} IST</div>
        </div>
      </header>

      <section className="notice">
        <span><Zap size={12} /> INFRASTRUCTURE TELEMETRY</span>
        <b>{syncError || "Unavailable means no verified reading. Static topology describes the intended architecture."}</b>
        <small>Last sync {lastSync ? lastSync.toLocaleTimeString("en-IN", { hour12: false }) : "pending"}</small>
      </section>

      <section className="priority panel">
        <SectionLabel number="01" status={syncing ? "SYNCING" : "V2"}>SYSTEM OVERVIEW</SectionLabel>
        <div className="priority-grid">
          <div className="priority-title"><ShieldCheck size={18} /><div><strong>Olympus homelab</strong><span>Private-by-default infrastructure control plane</span></div></div>
          <div className="quick-stat"><span>REGISTERED HOSTS</span><b>{infrastructure?.hosts.length ?? "—"}</b></div>
          <div className="quick-stat"><span>OBSERVED VMS</span><b>{view.proxmox?.vms.data?.length ?? "—"}</b></div>
          <div className="quick-stat"><span>K3S NODES</span><b>{view.kubernetes?.nodes.data?.length ?? "—"}</b></div>
          <div className="quick-stat"><span>ACTIVE ALERTS</span><b>{view.firingAlerts ?? "—"}</b></div>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel span-8">
          <SectionLabel number="02" status={view.status("apollo").toUpperCase()}>APOLLO / PROXMOX VE</SectionLabel>
          <div className="panel-title-row"><div><h2>Compute & Gateway</h2><p>Proxmox hypervisor · Infrastructure host</p></div><div className="uptime"><CircleDot size={12} /> {view.apollo?.uptimeSeconds == null ? "Uptime unavailable" : `${Math.floor(view.apollo.uptimeSeconds / 3600)}h uptime`}</div></div>
          <div className="metrics"><Metric label="CPU" value={percent(view.cpu)} percent={view.cpu} icon={Cpu} /><Metric label="RAM" value={percent(view.memory)} percent={view.memory} icon={Gauge} /><Metric label="STORAGE" value={percent(view.storage)} percent={view.storage} icon={HardDrive} /></div>
          <div className="subsection"><div className="subsection-title"><Server size={13} /> VIRTUAL WORKLOADS</div><div className="workloads">
            <div className="workload"><div><b>Athena</b><small>VM 100 · Observability</small></div><span><StatusDot status={view.status("athena")} /> {view.status("athena").toUpperCase()}</span></div>
            <div className="workload"><div><b>Hermes</b><small>VM 101 · K3s / Olympus target</small></div><span><StatusDot status={view.status("hermes")} /> {view.status("hermes").toUpperCase()}</span></div>
          </div></div>
        </section>

        <section className="panel span-4">
          <SectionLabel number="03" status="TOPOLOGY">NETWORK</SectionLabel>
          <div className="network-map">
            <div className="network-node primary"><div><Wifi size={15} /><b>Internet / Router</b></div><span>WAN</span></div>
            <div className="network-line" />
            <div className="network-node"><div><Network size={15} /><b>Apollo</b></div><span>Infrastructure host</span></div>
            <div className="network-children"><div className="network-node"><b>Athena</b><span>Observability VM</span></div><div className="network-node"><b>Hermes</b><span>Private LAN</span></div></div>
          </div>
          <div className="status-list"><div><span>Outbound NAT</span><b><StatusDot /> UNKNOWN</b></div><div><span>Firewall</span><b><StatusDot /> UNKNOWN</b></div><div><span>Tailscale mesh</span><b><StatusDot /> UNKNOWN</b></div></div>
        </section>

        <section className="panel span-5">
          <SectionLabel number="04" status={view.status("athena").toUpperCase()}>ATHENA / OBSERVABILITY</SectionLabel>
          <div className="host-header"><div className="host-id"><Container size={16} /><b>ATHENA</b></div><span><StatusDot status={view.status("athena")} /> SERVICE INVENTORY</span></div>
          <div className="container-list">{observabilityServices.map((x) => <div className="container-row" key={x}><StatusDot status={view.serviceStatus(x)} /><b>{x}</b><span>{view.serviceStatus(x).toUpperCase()}</span></div>)}</div>
        </section>

        <section className="panel span-3">
          <SectionLabel number="05" status="ADMIN">ARTEMIS</SectionLabel>
          <div className="big-status"><StatusDot /><strong>Artemis</strong><span>Management workstation</span></div>
          <div className="simple-services">{adminTools.map((x) => <div key={x}><StatusDot /><span>{x}</span><ChevronRight size={12} /></div>)}</div>
        </section>

        <section className="panel span-4">
          <SectionLabel number="06" status={view.status("hermes").toUpperCase()}>K3S CLUSTER</SectionLabel>
          <div className="k3s-hero"><div className="k3s-icon"><Layers3 size={23} /></div><div><h3>Hermes</h3><span>Single-node K3s · intended topology</span></div><StatusDot /></div>
          <div className="k3s-stats"><div><span>NODE</span><b>{view.kubernetes?.nodes.data?.find(node => node.name === "hermes")?.status.toUpperCase() ?? "UNKNOWN"}</b></div><div><span>PODS</span><b>{view.kubernetes?.pods.data?.length ?? "—"}</b></div><div><span>API</span><b>{view.kubernetes?.apiReachable ? "REACHABLE" : "UNKNOWN"}</b></div><div><span>VERSION</span><b>{view.kubernetes?.version.data ?? "—"}</b></div></div>
          <div className="pods">{view.kubernetes?.pods.data ? view.kubernetes.pods.data.slice(0, 12).map(pod => <span key={`${pod.namespace}/${pod.name}`}>{pod.namespace}/{pod.name} · {pod.phase ?? "Unknown"}</span>) : <span>Pod telemetry unavailable</span>}</div>
        </section>

        <section className="panel span-6">
          <SectionLabel number="07" status="PIPELINE">OBSERVABILITY</SectionLabel>
          <div className="obs-flow"><div className="obs-card"><Database size={16} /><b>Prometheus</b><span>Metrics</span></div><ChevronRight /><div className="obs-card"><Terminal size={16} /><b>Grafana</b><span>Dashboards</span></div><div className="obs-card"><Radio size={16} /><b>Alloy</b><span>Collection</span></div><ChevronRight /><div className="obs-card"><Database size={16} /><b>Loki</b><span>Logs</span></div></div>
          <div className="alert-strip"><CheckCircle2 size={14} /><span>Prometheus alerts</span><b>{view.firingAlerts === null ? "Unavailable" : `${view.firingAlerts} firing`}</b></div>
        </section>

        <section className="panel span-6">
          <SectionLabel number="08" status="NOT CONFIGURED" muted>CAMERA / 3D PRINTER</SectionLabel>
          <div className="camera-placeholder"><Video size={28} /><b>CAMERA NOT CONFIGURED</b><span>Reserved for a future camera integration.</span></div>
        </section>

        <section className="panel span-12">
          <SectionLabel number="09" status={view.prometheus?.alerts.state === "available" ? "OBSERVED" : "UNAVAILABLE"}>CURRENT ALERTS</SectionLabel>
          <div className="events">{view.prometheus?.alerts.data ? view.prometheus.alerts.data.length ? view.prometheus.alerts.data.map((alert, index) => <div className="event" key={`${alert.name}-${index}`}><span className="event-time">{alert.activeAt ?? "—"}</span><StatusDot status={alert.state === "firing" ? "offline" : "unknown"} /><b>{alert.name}</b><span>{alert.state}</span></div>) : <p className="empty">No active Prometheus alerts.</p> : <p className="empty">Alert telemetry unavailable. Log/event collection is pending.</p>}</div>
        </section>

        <section className="panel span-12">
          <SectionLabel number="10" status={`${filteredServices.length} MATCHES`}>CONTROL PLANE SERVICES</SectionLabel>
          <div className="service-grid">{filteredServices.length ? filteredServices.map((service) => <ServiceCard key={service.name} service={service} />) : <div className="empty">No services match <b>{query}</b>.</div>}</div>
        </section>

        <section className="panel span-12">
          <SectionLabel number="11" status={syncing ? "SYNCING" : syncError ? "STALE" : "ADAPTER STATUS"}>INTEGRATION SOURCES</SectionLabel>
          {syncError && <p role="alert">{syncError}</p>}
          {!infrastructure && <p>{syncing ? "Checking infrastructure…" : "No adapter results available."}</p>}
          <div className="integration-grid">
            {infrastructure?.hosts.flatMap(({ host, adapters }) => Object.entries(adapters).map(([name, result]) => (
              <div className="integration" key={`${host.id}-${name}`}>
                <div className="integration-icon"><Cloud size={15} /></div>
                <div><b>{host.name} / {name}</b><span>{result.error?.message ?? (result.state === "partial" ? "Some readings unavailable" : "Responding")}</span></div>
                <em>{result.state.toUpperCase().replaceAll("_", " ")}</em>
              </div>
            )))}
          </div>
        </section>
      </div>

      <footer><span><Activity size={11} /> V2 TOPOLOGY · SOURCE TELEMETRY</span><span>Adapter refresh: manual</span><span>Olympus / Control Plane V2</span></footer>
    </main>
  );
}
