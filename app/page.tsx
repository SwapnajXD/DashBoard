"use client";

import {
  Activity, AlertTriangle, Box, CheckCircle2, ChevronRight, CircleDot,
  Cloud, Container, Cpu, Database, Gauge, HardDrive, Layers3, Network,
  Radio, RefreshCw, Search, Server, ShieldCheck, Terminal, Video, Wifi, Zap
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Status = "online" | "warning" | "offline";

type Service = { name: string; type: string; status: "ONLINE" | "ON DEMAND"; host: string };

const services: Service[] = [
  { name: "Grafana", type: "Observability", status: "ONLINE", host: "Athena" },
  { name: "Prometheus", type: "Metrics", status: "ONLINE", host: "Athena" },
  { name: "Loki", type: "Logging", status: "ONLINE", host: "Athena" },
  { name: "Grafana Alloy", type: "Telemetry", status: "ONLINE", host: "Athena + Hestia" },
  { name: "Portainer", type: "Containers", status: "ONLINE", host: "Athena" },
  { name: "Homepage", type: "Frontend", status: "ONLINE", host: "Hestia" },
  { name: "Vaultwarden", type: "Security", status: "ONLINE", host: "Hestia" },
  { name: "K3s", type: "Kubernetes", status: "ONLINE", host: "Athena" },
  { name: "Glances", type: "System", status: "ONLINE", host: "Athena" },
  { name: "Floci", type: "AWS Lab", status: "ON DEMAND", host: "Athena" },
  { name: "Tailscale", type: "Remote Access", status: "ONLINE", host: "Mesh" },
  { name: "Proxmox Exporter", type: "Infrastructure", status: "ONLINE", host: "Athena" }
];

const containersAthena = [
  "Grafana", "Prometheus", "Loki", "Grafana Alloy", "Node Exporter",
  "cAdvisor", "Glances", "Proxmox Exporter", "Portainer", "Floci"
];
const containersHestia = ["Homepage", "Vaultwarden", "Grafana Alloy", "Node Exporter", "Portainer Agent"];
const pods = ["coredns", "local-path-provisioner", "metrics-server", "portainer-agent", "svclb-portainer-agent"];

const events = [
  ["20:41:12", "Prometheus", "scrape completed", "online"],
  ["20:40:57", "Vaultwarden", "health check passed", "online"],
  ["20:40:44", "K3s", "node Athena ready", "online"],
  ["20:40:31", "Apollo", "firewall service active", "online"],
  ["20:39:18", "Loki", "logs received from Hestia", "online"],
  ["20:38:02", "Floci", "idle — on demand", "warning"]
] as const;

function StatusDot({ status = "online" }: { status?: Status }) {
  return <span className={`dot ${status}`} aria-hidden="true" />;
}

function Metric({ label, value, percent, icon: Icon }: { label: string; value: string; percent: number; icon: typeof Cpu }) {
  return (
    <div className="metric">
      <div className="metric-head"><span>{label}</span><Icon size={13} /></div>
      <div className="metric-value">{value}</div>
      <div className="bar"><span style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

function ServiceCard({ service }: { service: Service }) {
  const onDemand = service.status === "ON DEMAND";
  return (
    <div className="service-card">
      <div className="service-icon"><Box size={16} /></div>
      <div className="service-main">
        <div className="service-name">{service.name}</div>
        <div className="service-type">{service.type} · {service.host}</div>
      </div>
      <div className={`service-status ${onDemand ? "warn" : ""}`}>
        <StatusDot status={onDemand ? "warning" : "online"} /> {service.status}
      </div>
    </div>
  );
}

function SectionLabel({ number, children, status, muted = false }: { number: string; children: React.ReactNode; status: string; muted?: boolean }) {
  return <div className="section-label"><span>{number}</span>{children}<em className={muted ? "muted" : ""}>{status}</em></div>;
}

export default function HomePage() {
  const [now, setNow] = useState(new Date());
  const [query, setQuery] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(new Date());
  const [cameraAdded, setCameraAdded] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const filteredServices = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return services;
    return services.filter((service) => `${service.name} ${service.type} ${service.host}`.toLowerCase().includes(q));
  }, [query]);

  function refresh() {
    setSyncing(true);
    window.setTimeout(() => {
      setLastSync(new Date());
      setSyncing(false);
    }, 650);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Terminal size={15} /></div>
          <div><div className="brand-name">OLYMPUS</div><div className="brand-sub">CONTROL PLANE / HOMELAB</div></div>
        </div>
        <div className="global-status"><StatusDot /><span>CONTROL PLANE HEALTHY</span></div>
        <div className="top-actions">
          <label className="search"><Search size={12} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search services..." /></label>
          <button className="refresh" onClick={refresh} title="Refresh telemetry"><RefreshCw size={13} className={syncing ? "spin" : ""} /> SYNC</button>
          <div className="clock">{now.toLocaleTimeString("en-IN", { hour12: false })} IST</div>
        </div>
      </header>

      <section className="notice">
        <span><Zap size={12} /> DEMO TELEMETRY</span>
        <b>UI is ready — backend adapters are the next step.</b>
        <small>Last sync {lastSync.toLocaleTimeString("en-IN", { hour12: false })}</small>
      </section>

      <section className="priority panel">
        <SectionLabel number="01" status="READY">SYSTEM OVERVIEW</SectionLabel>
        <div className="priority-grid">
          <div className="priority-title"><ShieldCheck size={18} /><div><strong>Olympus homelab</strong><span>Private-by-default infrastructure control plane</span></div></div>
          <div className="quick-stat"><span>HOSTS</span><b>3</b></div>
          <div className="quick-stat"><span>CONTAINERS</span><b>15</b></div>
          <div className="quick-stat"><span>K3S NODES</span><b>1</b></div>
          <div className="quick-stat"><span>ACTIVE ALERTS</span><b className="good">0</b></div>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel span-8">
          <SectionLabel number="02" status="ONLINE">APOLLO / PROXMOX VE</SectionLabel>
          <div className="panel-title-row"><div><h2>Compute & Gateway</h2><p>Proxmox hypervisor · 10.10.10.1</p></div><div className="uptime"><CircleDot size={12} /> 26d 14h uptime</div></div>
          <div className="metrics"><Metric label="CPU" value="31.2%" percent={31} icon={Cpu} /><Metric label="RAM" value="47.8%" percent={48} icon={Gauge} /><Metric label="STORAGE" value="27.1%" percent={27} icon={HardDrive} /></div>
          <div className="subsection"><div className="subsection-title"><Server size={13} /> VIRTUAL WORKLOADS</div><div className="workloads">
            <div className="workload"><div><b>Athena</b><small>Ubuntu VM · K3s + Docker</small></div><span><StatusDot /> RUNNING</span></div>
            <div className="workload"><div><b>Hestia</b><small>Alpine LXC · User-facing services</small></div><span><StatusDot /> RUNNING</span></div>
          </div></div>
        </section>

        <section className="panel span-4">
          <SectionLabel number="03" status="LIVE">NETWORK</SectionLabel>
          <div className="network-map">
            <div className="network-node primary"><div><Wifi size={15} /><b>Internet / Router</b></div><span>WAN</span></div>
            <div className="network-line" />
            <div className="network-node"><div><Network size={15} /><b>Apollo</b></div><span>10.10.10.1</span></div>
            <div className="network-children"><div className="network-node"><b>Athena</b><span>10.10.10.10</span></div><div className="network-node"><b>Hestia</b><span>10.10.10.2</span></div></div>
          </div>
          <div className="status-list"><div><span>Outbound NAT</span><b><StatusDot /> ACTIVE</b></div><div><span>Firewall</span><b><StatusDot /> ACTIVE</b></div><div><span>Tailscale mesh</span><b><StatusDot /> CONNECTED</b></div></div>
        </section>

        <section className="panel span-5">
          <SectionLabel number="04" status="10 CONTAINERS">ATHENA / DOCKER</SectionLabel>
          <div className="host-header"><div className="host-id"><Container size={16} /><b>ATHENA</b></div><span><StatusDot /> 9 / 9 RUNNING · 1 ON DEMAND</span></div>
          <div className="container-list">{containersAthena.map((x) => <div className="container-row" key={x}><span className="mini-dot" /><b>{x}</b><span>{x === "Floci" ? "ON DEMAND" : "RUNNING"}</span></div>)}</div>
        </section>

        <section className="panel span-3">
          <SectionLabel number="05" status="ONLINE">HESTIA</SectionLabel>
          <div className="big-status"><StatusDot /><strong>5 / 5</strong><span>containers running</span></div>
          <div className="simple-services">{containersHestia.map((x) => <div key={x}><StatusDot /><span>{x}</span><ChevronRight size={12} /></div>)}</div>
        </section>

        <section className="panel span-4">
          <SectionLabel number="06" status="HEALTHY">K3S CLUSTER</SectionLabel>
          <div className="k3s-hero"><div className="k3s-icon"><Layers3 size={23} /></div><div><h3>Athena</h3><span>Single-node K3s</span></div><StatusDot /></div>
          <div className="k3s-stats"><div><span>NODE</span><b>READY</b></div><div><span>PODS</span><b>5 / 5</b></div><div><span>API</span><b>6443</b></div><div><span>VERSION</span><b>v1.35.5</b></div></div>
          <div className="pods">{pods.map((x) => <span key={x}><StatusDot /> {x}</span>)}</div>
        </section>

        <section className="panel span-6">
          <SectionLabel number="07" status="PIPELINE">OBSERVABILITY</SectionLabel>
          <div className="obs-flow"><div className="obs-card"><Database size={16} /><b>Prometheus</b><span>Metrics</span></div><ChevronRight /><div className="obs-card"><Terminal size={16} /><b>Grafana</b><span>Dashboards</span></div><div className="obs-card"><Radio size={16} /><b>Alloy</b><span>Collection</span></div><ChevronRight /><div className="obs-card"><Database size={16} /><b>Loki</b><span>Logs</span></div></div>
          <div className="alert-strip"><CheckCircle2 size={14} /><span>Grafana Alerting</span><b>0 active</b><span className="arrow">→</span><span>Telegram</span></div>
        </section>

        <section className="panel span-6">
          <SectionLabel number="08" status="NOT CONFIGURED" muted>CAMERA / 3D PRINTER</SectionLabel>
          <div className={`camera-placeholder ${cameraAdded ? "configured" : ""}`}>
            {cameraAdded ? <><Video size={28} /><b>LIVE CAMERA SLOT READY</b><span>Replace this state with your RTSP / MJPEG / WebRTC feed later.</span></> : <><Video size={28} /><b>LIVE CAMERA SLOT</b><span>Reserved for your future 3D printer / homelab camera</span><button onClick={() => setCameraAdded(true)}>MARK CAMERA CONFIGURED</button></>}
          </div>
        </section>

        <section className="panel span-12">
          <SectionLabel number="09" status="LIVE FEED">RECENT EVENTS</SectionLabel>
          <div className="events">{events.map(([time, source, message, status]) => <div className="event" key={time + source}><span className="event-time">{time}</span><StatusDot status={status} /><b>{source}</b><span>{message}</span></div>)}</div>
        </section>

        <section className="panel span-12">
          <SectionLabel number="10" status={`${filteredServices.length} MATCHES`}>CONTROL PLANE SERVICES</SectionLabel>
          <div className="service-grid">{filteredServices.length ? filteredServices.map((service) => <ServiceCard key={service.name} service={service} />) : <div className="empty">No services match <b>{query}</b>.</div>}</div>
        </section>

        <section className="panel span-12">
          <SectionLabel number="11" status="NEXT">INTEGRATION SOURCES</SectionLabel>
          <div className="integration-grid">
            {[['Prometheus', 'metrics + alerts', 'READY'], ['Proxmox API', 'VM / LXC state', 'READY'], ['Docker Engine', 'container state', 'READY'], ['K3s API', 'nodes + pods', 'READY'], ['Loki', 'logs + events', 'READY'], ['Tailscale', 'mesh status', 'READY']].map(([name, desc, state]) => <div className="integration" key={name}><div className="integration-icon"><Cloud size={15} /></div><div><b>{name}</b><span>{desc}</span></div><em>{state}</em></div>)}
          </div>
        </section>
      </div>

      <footer><span><Activity size={11} /> TELEMETRY SYNCHRONIZED</span><span>Target interval: 10s</span><span>Olympus / Control Plane v0.2</span></footer>
    </main>
  );
}
