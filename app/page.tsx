import Dashboard from "./components/dashboard";

export const dynamic = "force-dynamic";

// Publish only explicitly configured, credential-free tool URLs, never the environment object.
function toolUrl(value: string | undefined, grafana = false): string | null {
  if (!value?.trim()) return null;
  try {
    const input = value.trim();
    const url = new URL(grafana && !input.includes("://") ? `http://${input}` : input);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && (grafana || url.pathname === "/" || url.pathname === "") ? url.href : null;
  } catch { return null; }
}
export default function HomePage() {
  return <Dashboard tools={[
    { name: "Proxmox", host: "Apollo", description: "Virtualization console", href: toolUrl(process.env.PROXMOX_URL) },
    { name: "Prometheus", host: "Athena", description: "Metrics and query explorer", href: toolUrl(process.env.PROMETHEUS_URL) },
    { name: "Grafana", host: "Athena", description: "Existing observability dashboards", href: toolUrl(process.env.GRAFANA_URL, true) },
    ...(process.env.LOKI_URL ? [{ name: "Loki", host: "Athena", description: "Log service endpoint", href: toolUrl(process.env.LOKI_URL) }] : []),
    ...(process.env.ALLOY_URL ? [{ name: "Alloy", host: "Athena", description: "Telemetry collector interface", href: toolUrl(process.env.ALLOY_URL) }] : []),
  ]} />;
}
