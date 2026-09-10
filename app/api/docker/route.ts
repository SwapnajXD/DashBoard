import { NextResponse } from "next/server";
import Docker from "dockerode";

const docker = new Docker({
  socketPath: "/var/run/docker.sock",
});

export async function GET() {
  try {
    const containers = await docker.listContainers({ all: true });

    const result = containers.map((container) => ({
      id: container.Id,
      name: container.Names[0]?.replace(/^\//, "") ?? container.Id.slice(0, 12),
      image: container.Image,
      state: container.State,
      status: container.Status,
      ports: container.Ports.map((port) => ({
        privatePort: port.PrivatePort,
        publicPort: port.PublicPort,
        type: port.Type,
      })),
      created: container.Created,
      labels: container.Labels,
    }));

    return NextResponse.json({
      ok: true,
      count: result.length,
      containers: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Docker API error:", error);
    return NextResponse.json(
      { ok: false, error: "Unable to connect to Docker" },
      { status: 503 },
    );
  }
}
