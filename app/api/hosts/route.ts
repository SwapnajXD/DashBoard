import { NextResponse } from "next/server";
import { hosts } from "@/app/lib/config/hosts";
import type { AdapterStatus, HostSummary } from "@/app/lib/types/infrastructure";

/**
 * Returns the server-side host registry.
 *
 * This milestone does not connect to any host — it reports the known
 * topology and, per host, which adapters are registered vs. actually
 * wired up. Real container state for the machine Olympus itself runs on
 * is available separately at `/api/docker`.
 */
export async function GET() {
  const summaries: HostSummary[] = hosts.map((host) => {
    const adapterStatuses: HostSummary["adapters"] = {};
    for (const adapter of host.adapters) {
      const status: AdapterStatus = { state: "not_implemented" };
      adapterStatuses[adapter] = status;
    }
    return { host, adapters: adapterStatuses };
  });

  return NextResponse.json({
    ok: true,
    hosts: summaries,
    timestamp: new Date().toISOString(),
  });
}
