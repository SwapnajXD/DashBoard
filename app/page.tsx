"use client";

import {
  Activity,
  AlertTriangle,
  Box,
  Cable,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Cloud,
  Container,
  Cpu,
  Database,
  ExternalLink,
  Gauge,
  HardDrive,
  Home,
  Info,
  Layers3,
  Network,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  Video,
  Wifi,
  Zap
} from "lucide-react";
import { useEffect, useState } from "react";

type Status = "online" | "warning" | "offline";

const services = [
  ["Grafana", "Observability", "ONLINE"],
  ["Prometheus", "Metrics", "ONLINE"],
  ["Loki", "Logging", "ONLINE"],
  ["Portainer", "Containers", "ONLINE"],
  ["Homepage", "Frontend", "ONLINE"],
  ["Vaultwarden", "Security", "ONLINE"],
  ["K3s", "Kubernetes", "ONLINE"],
  ["Glances", "System", "ONLINE"],
  ["Floci", "AWS Lab", "ON DEMAND"],
  ["Tailscale", "Remote Access", "ONLINE"]
];

const events = [
  ["20:41:12", "Prometheus", "scrape completed", "online"],
  ["20:40:57", "Vaultwarden", "health check passed", "online"],
  ["20:40:44", "K3s", "node Athena ready", "online"],
  ["20:40:31", "Apollo", "firewall service active", "online"],
  ["20:39:18", "Loki", "logs received from Hestia", "online"],
  ["20:38:02", "Floci", "idle — on demand", "warning"]
];

function StatusDot({ status = "online" }: { status?: Status }) {
  return <span className={`dot ${status}`} />;
}

function Metric({ label, value, percent, icon: Icon }: any) {
  return (
    <div className="metric">
      <div className="metric-head">
        <span>{label}</span>
        <Icon size={13} />
      </div>
      <div className="metric-value">{value}</div>
      <div className="bar"><span style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

function ServiceCard({ name, type, status }: { name: string; type: string; status: string }) {
  const isOnDemand = status === "ON DEMAND";
  return (
    <div className="service-card">
      <div className="service-icon"><Box size={16} /></div>
      <div className="service-main">
        <div className="service-name">{name}</div>
        <div className="service-type">{type}</div>
      </div>
      <div className={`service-status ${isOnDemand ? "warn" : ""}`}>
        <StatusDot status={isOnDemand ? "warning" : "online"} />
        {status}
      </div>
    </div>
  );
}

export default function HomePage() {
  const [now, setNow] = useState(new Date());
  const [cameraAdded, setCameraAdded] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Terminal size={15} /></div>
          <div>
            <div className="brand-name">OLYMPUS</div>
            <div className="brand-sub">CONTROL PLANE / HOMELAB</div>
          </div>
        </div>

        <div className="global-status">
          <StatusDot />
          <span>ALL SYSTEMS OPERATIONAL</span>
        </div>

        <div className="top-actions">
          <div className="search"><span>⌕</span> Search services...</div>
          <div className="clock">{now.toLocaleTimeString("en-IN", { hour12: false })} IST</div>
        </div>
      </header>

      <section className="priority panel">
        <div className="section-label"><span>01</span> SYSTEM OVERVIEW <em>LIVE</em></div>
        <div className="priority-grid">
          <div className="priority-title">
            <ShieldCheck size={18} />
            <div>
              <strong>Olympus homelab</strong>
              <span>Private-by-default infrastructure</span>
            </div>
          </div>
          <div className="quick-stat"><span>HOSTS</span><b>3</b></div>
          <div className="quick-stat"><span>CONTAINERS</span><b>15</b></div>
          <div className="quick-stat"><span>K3S NODES</span><b>1</b></div>
          <div className="quick-stat"><span>ACTIVE ALERTS</span><b className="good">0</b></div>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel span-8">
          <div className="section-label"><span>02</span> APOLLO / PROXMOX VE <em>ONLINE</em></div>
          <div className="panel-title-row">
            <div>
              <h2>Compute & Gateway</h2>
              <p>Proxmox hypervisor · 10.10.10.1</p>
            </div>
            <div className="uptime"><CircleDot size={12} /> 26d 14h uptime</div>
          </div>

          <div className="metrics">
            <Metric label="CPU" value="31.2%" percent={31} icon={Cpu} />
            <Metric label="RAM" value="47.8%" percent={48} icon={Gauge} />
            <Metric label="STORAGE" value="27.1%" percent={27} icon={HardDrive} />
          </div>

          <div className="subsection">
            <div className="subsection-title"><Server size={13} /> VIRTUAL WORKLOADS</div>
            <div className="workloads">
              <div className="workload"><div><b>Athena</b><small>Ubuntu VM · K3s + Docker</small></div><span><StatusDot /> RUNNING</span></div>
              <div className="workload"><div><b>Hestia</b><small>Alpine LXC · User-facing services</small></div><span><StatusDot /> RUNNING</span></div>
            </div>
          </div>
        </section>

        <section className="panel span-4">
          <div className="section-label"><span>03</span> NETWORK <em>LIVE</em></div>
          <div className="network-map">
            <div className="network-node primary"><div><Wifi size={15} /><b>Internet / Router</b></div><span>WAN</span></div>
            <div className="network-line" />
            <div className="network-node"><div><Network size={15} /><b>Apollo</b></div><span>10.10.10.1</span></div>
            <div className="network-children">
              <div className="network-node"><b>Athena</b><span>10.10.10.10</span></div>
              <div className="network-node"><b>Hestia</b><span>10.10.10.2</span></div>
            </div>
          </div>
          <div className="status-list">
            <div><span>Outbound NAT</span><b><StatusDot /> ACTIVE</b></div>
            <div><span>Firewall</span><b><StatusDot /> ACTIVE</b></div>
            <div><span>Tailscale mesh</span><b><StatusDot /> CONNECTED</b></div>
          </div>
        </section>

        <section className="panel span-5">
          <div className="section-label"><span>04</span> ATHENA / DOCKER <em>10 CONTAINERS</em></div>
          <div className="host-header"><div className="host-id"><Container size={16} /><b>ATHENA</b></div><span><StatusDot /> 10 / 10 RUNNING</span></div>
          <div className="container-list">
            {["Grafana", "Prometheus", "Loki", "Grafana Alloy", "Node Exporter", "cAdvisor", "Glances", "Proxmox Exporter", "Portainer", "Floci"].map((x, i) =>
              <div className="container-row" key={x}><span className="mini-dot" /><b>{x}</b><span>{i === 9 ? "ON DEMAND" : "RUNNING"}</span></div>
            )}
          </div>
        </section>

        <section className="panel span-3">
          <div className="section-label"><span>05</span> HESTIA <em>ONLINE</em></div>
          <div className="big-status"><StatusDot /><strong>5 / 5</strong><span>containers running</span></div>
          <div className="simple-services">
            {["Homepage", "Vaultwarden", "Grafana Alloy", "Node Exporter", "Portainer Agent"].map(x =>
              <div key={x}><StatusDot /><span>{x}</span><ChevronRight size={12} /></div>
            )}
          </div>
        </section>

        <section className="panel span-4">
          <div className="section-label"><span>06</span> K3S CLUSTER <em>HEALTHY</em></div>
          <div className="k3s-hero">
            <div className="k3s-icon"><Layers3 size={23} /></div>
            <div><h3>Athena</h3><span>Single-node K3s</span></div>
            <StatusDot />
          </div>
          <div className="k3s-stats">
            <div><span>NODE</span><b>READY</b></div>
            <div><span>PODS</span><b>5 / 5</b></div>
            <div><span>API</span><b>6443</b></div>
            <div><span>VERSION</span><b>v1.35.5</b></div>
          </div>
          <div className="pods">
            {["coredns", "local-path-provisioner", "metrics-server", "portainer-agent", "svclb-portainer-agent"].map(x =>
              <span key={x}><StatusDot /> {x}</span>
            )}
          </div>
        </section>

        <section className="panel span-6">
          <div className="section-label"><span>07</span> OBSERVABILITY <em>PIPELINE</em></div>
          <div className="obs-flow">
            <div className="obs-card"><Database size={16} /><b>Prometheus</b><span>Metrics</span></div>
            <ChevronRight />
            <div className="obs-card"><Terminal size={16} /><b>Grafana</b><span>Dashboards</span></div>
            <div className="obs-card"><Radio size={16} /><b>Alloy</b><span>Collection</span></div>
            <ChevronRight />
            <div className="obs-card"><Database size={16} /><b>Loki</b><span>Logs</span></div>
          </div>
          <div className="alert-strip"><CheckCircle2 size={14} /><span>Grafana Alerting</span><b>0 active</b><span className="arrow">→</span><span>Telegram</span></div>
        </section>

        <section className="panel span-6">
          <div className="section-label"><span>08</span> CAMERA / 3D PRINTER <em className="muted">NOT CONFIGURED</em></div>
          <div className={`camera-placeholder ${cameraAdded ? "configured" : ""}`}>
            {cameraAdded ? (
              <>
                <Video size={28} />
                <b>CAMERA FEED READY</b>
                <span>Set your stream URL in <code>CAMERA_URL</code></span>
              </>
            ) : (
              <>
                <Video size={28} />
                <b>LIVE CAMERA SLOT</b>
                <span>Reserved for your 3D printer / homelab camera</span>
                <button onClick={() => setCameraAdded(true)}>MARK CAMERA CONFIGURED</button>
              </>
            )}
          </div>
        </section>

        <section className="panel span-12">
          <div className="section-label"><span>09</span> RECENT EVENTS <em>LIVE FEED</em></div>
          <div className="events">
            {events.map(([time, source, message, status]) =>
              <div className="event" key={time + source}><span className="event-time">{time}</span><StatusDot status={status as Status} /><b>{source}</b><span>{message}</span></div>
            )}
          </div>
        </section>

        <section className="panel span-12">
          <div className="section-label"><span>10</span> CONTROL PLANE SERVICES <em>10 SERVICES</em></div>
          <div className="service-grid">
            {services.map(([name, type, status]) => <ServiceCard key={name} name={name} type={type} status={status} />)}
          </div>
        </section>
      </div>

      <footer>
        <span><Activity size={11} /> TELEMETRY SYNCHRONIZED</span>
        <span>Refresh target: 10s</span>
        <span>Olympus / Control Plane</span>
      </footer>
    </main>
  );
}
