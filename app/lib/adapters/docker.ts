import Docker from "dockerode";
import { Agent } from "undici";
import { getHost, resolveHostAddress } from "@/app/lib/config/hosts";
import type {
  AdapterStatus,
  Container,
  DockerHost,
  Host,
  HostConfig,
} from "../types/infrastructure";

const docker = new Docker({
  socketPath: "/var/run/docker.sock",
});

const localHost: Host = {
  id: "local",
  name: "Local Docker",
  type: "vm",
  address: "localhost",
  status: "online",
};

export async function getDockerContainers(): Promise<DockerHost> {
  const containers = await docker.listContainers({ all: true });

  const result: Container[] = containers.map((container) => ({
    id: container.Id,
    name:
      container.Names[0]?.replace(/^\//, "") ??
      container.Id.slice(0, 12),
    image: container.Image,
    state: parseContainerState(container.State),
    status: container.Status,
    ports: container.Ports.map((port) => ({
      privatePort: port.PrivatePort,
      publicPort: port.PublicPort,
      type: port.Type,
    })),
    created: container.Created,
    labels: container.Labels,
  }));

  return {
    host: localHost,
    containers: result,
    timestamp: new Date().toISOString(),
  };
}

function parseContainerState(state: string): Container["state"] {
  switch (state) {
    case "running":
      return "running";
    case "exited":
      return "exited";
    case "paused":
      return "paused";
    case "restarting":
      return "restarting";
    default:
      return "unknown";
  }
}

// ---------------------------------------------------------------------
// Remote container listing via Portainer.
//
// Neither Athena nor Hestia expose a raw Docker TCP API (deliberately —
// unauthenticated remote Docker access is a real risk). Portainer is
// already deployed on Athena and already manages Hestia through the
// Portainer Agent, so it's the safe, existing path for remote container
// data instead of opening a new socket.
// ---------------------------------------------------------------------

const PORTAINER_PORT = 9443;
const FETCH_TIMEOUT_MS = 3000;

/** Portainer uses the default self-signed certificate, same as Proxmox. */
const portainerAgent = new Agent({
  connect: { rejectUnauthorized: false },
});

async function fetchWithTimeout(
  url: string,
  apiKey: string,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { "X-API-Key": apiKey },
      // @ts-expect-error — `dispatcher` is a Node/undici fetch extension
      // used here to scope the self-signed cert exception to Portainer
      // calls only.
      dispatcher: portainerAgent,
    });
  } finally {
    clearTimeout(timer);
  }
}

type PortainerEndpoint = {
  Id: number;
  Name: string;
};

type PortainerContainer = {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Ports: { PrivatePort: number; PublicPort?: number; Type: string }[];
  Created: number;
  Labels: Record<string, string>;
};

/**
 * Fetches container state for a host (Athena or Hestia) by going through
 * Portainer on Athena, which already has visibility into both via the
 * Portainer Agent running on each host.
 *
 * Requires PORTAINER_API_KEY, created as an Access Token under the
 * Portainer user's settings.
 *
 * Environment IDs aren't known ahead of time (Portainer assigns them),
 * so this discovers them by matching endpoint names against the host's
 * id/name. If no match is found, the error lists the real endpoint
 * names Portainer reports, so the matching can be adjusted.
 */
export async function getRemoteDockerStatus(
  host: HostConfig,
): Promise<AdapterStatus> {
  const athena = getHost("athena");
  if (!athena) {
    return { state: "error", message: "Athena is not in the host registry." };
  }

  const portainerAddress = resolveHostAddress(athena, "docker");
  if (!portainerAddress) {
    return {
      state: "unreachable",
      reason:
        "No address reachable for Portainer (on Athena) in the current " +
        "network mode.",
    };
  }

  const apiKey = process.env.PORTAINER_API_KEY;
  if (!apiKey) {
    return {
      state: "error",
      message:
        "Portainer API key not configured. Set PORTAINER_API_KEY in the " +
        "environment.",
    };
  }

  const base = `https://${portainerAddress}:${PORTAINER_PORT}`;

  try {
    const endpointsRes = await fetchWithTimeout(
      `${base}/api/endpoints`,
      apiKey,
      FETCH_TIMEOUT_MS,
    );
    if (endpointsRes.status === 401) {
      return { state: "error", message: "Portainer rejected the API key (HTTP 401)." };
    }
    if (!endpointsRes.ok) {
      return {
        state: "error",
        message: `Portainer /api/endpoints returned HTTP ${endpointsRes.status}`,
      };
    }

    const endpoints = (await endpointsRes.json()) as PortainerEndpoint[];
    const needle = host.name.toLowerCase();
    const match = endpoints.find(
      (e) =>
        e.Name.toLowerCase().includes(needle) ||
        e.Name.toLowerCase().includes(host.id),
    );

    if (!match) {
      const available = endpoints.map((e) => e.Name).join(", ") || "(none)";
      return {
        state: "error",
        message: `No Portainer environment matched "${host.name}". Available: ${available}`,
      };
    }

    const containersRes = await fetchWithTimeout(
      `${base}/api/endpoints/${match.Id}/docker/containers/json?all=true`,
      apiKey,
      FETCH_TIMEOUT_MS,
    );
    if (!containersRes.ok) {
      return {
        state: "error",
        message: `Portainer container listing returned HTTP ${containersRes.status}`,
      };
    }

    const raw = (await containersRes.json()) as PortainerContainer[];
    const containers: Container[] = raw.map((c) => ({
      id: c.Id,
      name: c.Names[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12),
      image: c.Image,
      state: parseContainerState(c.State),
      status: c.Status,
      ports: c.Ports.map((p) => ({
        privatePort: p.PrivatePort,
        publicPort: p.PublicPort,
        type: p.Type,
      })),
      created: c.Created,
      labels: c.Labels,
    }));

    return {
      state: "ok",
      data: {
        address: portainerAddress,
        endpointId: match.Id,
        endpointName: match.Name,
        containers,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { state: "error", message: `Unable to reach Portainer: ${message}` };
  }
}
