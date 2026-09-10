import Docker from "dockerode";
import type { Container, DockerHost, Host } from "../types/infrastructure";

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
