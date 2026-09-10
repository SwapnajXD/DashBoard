import type { AdapterStatus, HostConfig } from "@/app/lib/types/infrastructure";

/**
 * Proxmox adapter foundation.
 *
 * NOT YET IMPLEMENTED. Apollo is the Proxmox VE host, reachable over
 * Tailscale at 100.81.86.51. A real implementation should call the
 * Proxmox REST API (`/api2/json/...`) using an API token stored in a
 * server-side env var (e.g. `PROXMOX_API_TOKEN`), never in client code.
 *
 * Returns an honest "not_implemented" status so callers don't fabricate
 * VM/LXC state.
 */
export async function getProxmoxStatus(
  host: HostConfig,
): Promise<AdapterStatus> {
  void host;
  return { state: "not_implemented" };
}
