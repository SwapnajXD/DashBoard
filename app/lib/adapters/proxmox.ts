import "server-only";
import { readFile } from "node:fs/promises";
import { Agent } from "undici";
import { resolveHostAddress } from "../config/hosts";
import type { AdapterStatus, HostConfig, ProxmoxData, ProxmoxResource } from "../types/infrastructure";
import { array, collected, endpoint, failed, finite, object, reading, request, string, TelemetryFailure } from "./shared";

export function normalizeProxmox(value: unknown, kind?: string): ProxmoxResource {
  const item = object(value);
  const type = kind ?? string(item.type) ?? "unknown";
  const vmId = finite(item.vmid);
  return {
    id: string(item.id) ?? (type === "node" ? `node/${string(item.node) ?? "unknown"}` : `${type}/${vmId ?? "unknown"}`),
    node: string(item.node) ?? "unknown", name: string(item.name), type, vmId,
    hostId: type === "node" && item.node === (process.env.PROXMOX_NODE_NAME || "apollo") ? "apollo" : vmId === 100 ? "athena" : vmId === 101 ? "hermes" : null,
    status: item.status === "online" || item.status === "running" ? "online" : item.status === "offline" || item.status === "stopped" ? "offline" : "unknown",
    cpuRatio: finite(item.cpu), cpuCount: finite(item.maxcpu),
    memoryUsedBytes: finite(item.mem), memoryTotalBytes: finite(item.maxmem),
    storageUsedBytes: finite(item.disk), storageTotalBytes: finite(item.maxdisk),
    uptimeSeconds: finite(item.uptime),
  };
}

export async function getProxmoxStatus(host: HostConfig, transport = request): Promise<AdapterStatus<ProxmoxData>> {
  let dispatcher: Agent | undefined;
  try {
    const address = resolveHostAddress(host, "proxmox");
    const base = endpoint(process.env.PROXMOX_URL, address ? `https://${address}:8006` : null);
    if (!base.startsWith("https://")) throw new TelemetryFailure("configuration", "Proxmox requires HTTPS.");
    const id = process.env.PROXMOX_API_TOKEN_ID;
    const secret = process.env.PROXMOX_API_TOKEN_SECRET;
    if (!id || !secret) throw new TelemetryFailure("unconfigured", "Proxmox read-only API credentials are not configured.");
    const ca = process.env.PROXMOX_CA_FILE ? await readFile(process.env.PROXMOX_CA_FILE, "utf8") : undefined;
    dispatcher = new Agent({ connect: { ca, rejectUnauthorized: process.env.PROXMOX_ALLOW_SELF_SIGNED !== "true" } });
    const options = { dispatcher, headers: { Authorization: `PVEAPIToken=${id}=${secret}` } };
    const collect = (path: string, kind: "node" | "vm" | "storage") => reading(async () => {
      const body = object(await transport(base, `/api2/json${path}`, options));
      return array(body.data).map(value => {
        const item = object(value);
        const valid = kind === "node" ? Boolean(string(item.node)?.trim())
          : kind === "vm" ? (item.type === "qemu" || item.type === "lxc") && Number.isInteger(item.vmid) && Number(item.vmid) > 0
          : item.type === "storage" && Boolean(string(item.id)?.trim());
        if (!valid) throw new TelemetryFailure("invalid_response", "Proxmox resource identity is missing or invalid.");
        return normalizeProxmox(item, kind === "node" ? kind : undefined);
      });
    });
    const [nodes, vms, storage] = await Promise.all([
      collect("/nodes", "node"), collect("/cluster/resources?type=vm", "vm"), collect("/cluster/resources?type=storage", "storage"),
    ]);
    if ([nodes, vms, storage].every(item => item.state === "unavailable")) {
      const error = nodes.error!;
      return failed(new TelemetryFailure(error.code, error.message));
    }
    const status = nodes.data?.find(node => node.hostId === "apollo")?.status ?? "unknown";
    return collected({ nodes, vms, storage }, [nodes, vms, storage], status);
  } catch (error) { return failed(error); }
  finally { await dispatcher?.close(); }
}
