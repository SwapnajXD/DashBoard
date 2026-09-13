import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { RequestOptions } from "node:https";
import { Agent } from "undici";
import { KubeConfig } from "@kubernetes/client-node";
import type { AdapterStatus, HostConfig, KubernetesContainer, KubernetesData, KubernetesNode, KubernetesPod } from "../types/infrastructure";
import { array, collected, endpoint, failed, finite, object, reading, request, string, TelemetryFailure, type TransportOptions } from "./shared";

export function isPrivateAddress(address: string): boolean {
  if (address.startsWith("::ffff:")) return isPrivateAddress(address.slice(7));
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return isIP(address) === 6 && (address === "::1" || /^(fc|fd)/i.test(address));
}

export async function loadKubernetesConnection(): Promise<{ base: string; options: TransportOptions; close: () => Promise<void> }> {
  const config = new KubeConfig();
  try {
    if (process.env.KUBERNETES_KUBECONFIG) {
      config.loadFromFile(process.env.KUBERNETES_KUBECONFIG);
      if (process.env.KUBERNETES_CONTEXT) config.setCurrentContext(process.env.KUBERNETES_CONTEXT);
    } else if (process.env.KUBERNETES_IN_CLUSTER === "true") {
      config.loadFromCluster();
    } else {
      throw new TelemetryFailure("unconfigured", "Set KUBERNETES_KUBECONFIG and optionally KUBERNETES_CONTEXT, or enable in-cluster credentials.");
    }
    const cluster = config.getCurrentCluster();
    const user = config.getCurrentUser();
    if (!cluster || !user) throw new TelemetryFailure("configuration", "Kubernetes context must select a cluster and user.");
    if (cluster.skipTLSVerify || cluster.proxyUrl || user.exec || user.username || user.impersonateUser || (user.authProvider && user.authProvider.name !== "tokenFile")) {
      throw new TelemetryFailure("configuration", "Use verified TLS with a client certificate or bearer token; proxy, exec, impersonation and external auth providers are unsupported.");
    }
    const base = endpoint(cluster.server, null);
    if (!base.startsWith("https://")) throw new TelemetryFailure("configuration", "Kubernetes requires HTTPS with a trusted cluster CA.");
    const hostname = new URL(base).hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
    if (!addresses.length || addresses.some(item => !isPrivateAddress(item.address))) throw new TelemetryFailure("configuration", "Kubernetes endpoint must resolve only to private LAN, mesh or loopback addresses.");
    const httpsOptions: RequestOptions = {};
    await config.applyToHTTPSOptions(httpsOptions);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(httpsOptions.headers ?? {})) if (typeof value === "string") headers[key] = value;
    if (!httpsOptions.cert && !headers.Authorization) throw new TelemetryFailure("configuration", "Kubernetes credentials are missing.");
    const dispatcher = new Agent({ connect: {
      ca: httpsOptions.ca, cert: httpsOptions.cert, key: httpsOptions.key,
      servername: cluster.tlsServerName, rejectUnauthorized: true,
    } });
    return { base, options: { dispatcher, headers, signal: AbortSignal.timeout(15000) }, close: () => dispatcher.close() };
  } catch (error) {
    if (error instanceof TelemetryFailure) throw error;
    throw new TelemetryFailure("configuration", "Unable to load Kubernetes credentials or resolve the private endpoint.");
  }
}

function metadata(value: unknown) {
  const item = object(value); const meta = object(item.metadata);
  const name = string(meta.name);
  if (!name) throw new TelemetryFailure("invalid_response", "Kubernetes resource has no name.");
  return { item, name, namespace: string(meta.namespace) ?? "default", meta };
}
export function normalizeNode(value: unknown): KubernetesNode {
  const { item, name, meta } = metadata(value); const status = object(item.status ?? {});
  const ready = array(status.conditions ?? []).map(object).find(condition => condition.type === "Ready");
  const capacity = object(status.capacity ?? {}); const allocatable = object(status.allocatable ?? {});
  const labels = object(meta.labels ?? {});
  return { name, status: ready?.status === "True" ? "online" : ready?.status === "False" ? "offline" : "unknown",
    roles: Object.keys(labels).filter(key => key.startsWith("node-role.kubernetes.io/")).map(key => key.slice("node-role.kubernetes.io/".length)),
    kubeletVersion: string(object(status.nodeInfo ?? {}).kubeletVersion),
    capacity: { cpu: string(capacity.cpu), memory: string(capacity.memory) },
    allocatable: { cpu: string(allocatable.cpu), memory: string(allocatable.memory) },
  };
}
export function normalizePod(value: unknown): KubernetesPod {
  const { item, name, namespace } = metadata(value);
  const spec = object(item.spec ?? {}); const status = object(item.status ?? {});
  const containers: KubernetesContainer[] = [];
  for (const [specKey, statusKey, kind] of [["containers", "containerStatuses", "container"], ["initContainers", "initContainerStatuses", "init"], ["ephemeralContainers", "ephemeralContainerStatuses", "ephemeral"]] as const) {
    const statuses = array(status[statusKey] ?? []).map(object);
    for (const declared of array(spec[specKey] ?? []).map(object)) {
      const container = statuses.find(entry => entry.name === declared.name);
      const state = object(container?.state ?? {});
      const phase = state.running ? "running" : state.waiting ? "waiting" : state.terminated ? "terminated" : "unknown";
      containers.push({ name: string(declared.name) ?? "unknown", kind, ready: typeof container?.ready === "boolean" ? container.ready : null,
        restartCount: finite(container?.restartCount), state: phase, reason: phase === "unknown" ? null : string(object(state[phase]).reason) });
    }
  }
  // Never serialize pod specs, environment variables, annotations or raw condition messages.
  return { name, namespace, node: string(spec.nodeName), phase: string(status.phase), containers };
}

export async function listResources(base: string, path: string, options: TransportOptions, transport = request): Promise<unknown[]> {
  const result: unknown[] = [];
  let continuation = "";
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ limit: "200" });
    if (continuation) params.set("continue", continuation);
    const body = object(await transport(base, `${path}?${params}`, options));
    result.push(...array(body.items));
    if (result.length > 4000) throw new TelemetryFailure("unavailable", "Resource list exceeds the collection limit.");
    continuation = string(object(body.metadata ?? {}).continue) ?? "";
    if (!continuation) return result;
  }
  throw new TelemetryFailure("unavailable", "Resource pagination exceeds the collection limit.");
}

export async function getKubernetesStatus(_host: HostConfig, connect = loadKubernetesConnection, transport = request): Promise<AdapterStatus<KubernetesData>> {
  let connection: Awaited<ReturnType<typeof loadKubernetesConnection>> | undefined;
  try {
    connection = await connect();
    const { base, options } = connection;
    const list = (path: string) => listResources(base, path, options, transport);
    const [version, nodes, namespaces, pods, deployments, services, ingresses, nodeMetrics] = await Promise.all([
      reading(async () => {
        const value = string(object(await transport(base, "/version", options)).gitVersion);
        if (!value) throw new TelemetryFailure("invalid_response", "Kubernetes version is missing.");
        return value;
      }),
      reading(async () => (await list("/api/v1/nodes")).map(normalizeNode)),
      reading(async () => (await list("/api/v1/namespaces")).map(item => metadata(item).name)),
      reading(async () => (await list("/api/v1/pods")).map(normalizePod)),
      reading(async () => (await list("/apis/apps/v1/deployments")).map(value => {
        const { item, name, namespace } = metadata(value); const status = object(item.status ?? {});
        return { name, namespace, desired: finite(object(item.spec ?? {}).replicas), ready: finite(status.readyReplicas), available: finite(status.availableReplicas) };
      })),
      reading(async () => (await list("/api/v1/services")).map(value => {
        const { item, name, namespace } = metadata(value); const spec = object(item.spec ?? {});
        return { name, namespace, type: string(spec.type), ports: array(spec.ports ?? []).map(value => {
          const port = object(value); const number = finite(port.port);
          if (number === null) throw new TelemetryFailure("invalid_response", "Service port is invalid.");
          return { port: number, protocol: string(port.protocol) };
        }) };
      })),
      reading(async () => (await list("/apis/networking.k8s.io/v1/ingresses")).map(value => {
        const { item, name, namespace } = metadata(value); const spec = object(item.spec ?? {});
        return { name, namespace, className: string(spec.ingressClassName), hosts: array(spec.rules ?? []).map(rule => string(object(rule).host)).filter((host): host is string => host !== null) };
      })),
      reading(async () => (await list("/apis/metrics.k8s.io/v1beta1/nodes")).map(value => {
        const { item, name } = metadata(value); const usage = object(item.usage ?? {});
        return { name, sampledAt: string(item.timestamp), window: string(item.window), cpu: string(usage.cpu), memory: string(usage.memory) };
      })),
    ]);
    const readings = [version, nodes, namespaces, pods, deployments, services, ingresses, nodeMetrics];
    if (readings.every(item => item.state === "unavailable")) {
      const error = version.error!; return failed(new TelemetryFailure(error.code, error.message));
    }
    return collected({ apiReachable: true, version, nodes, namespaces, pods, deployments, services, ingresses, nodeMetrics }, readings);
  } catch (error) { return failed(error); }
  finally { await connection?.close(); }
}
