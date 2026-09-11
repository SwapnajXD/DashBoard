import { NextResponse } from "next/server";
import { hosts } from "@/app/lib/config/hosts";
import { getPrometheusStatus } from "@/app/lib/adapters/prometheus";
import { getLokiStatus } from "@/app/lib/adapters/loki";
import type {
  AdapterKind,
  AdapterStatus,
  HostConfig,
  HostSummary,
} from "@/app/lib/types/infrastructure";

/**
 * Returns the server-side host registry, with real status for adapters
 * that are actually wired up (currently: Prometheus) and an honest
 * `not_implemented` for the rest. Real container state for the machine
 * Olympus itself runs on is available separately at `/api/docker`.
 */
export async function GET() {
  const summaries: HostSummary[] = await Promise.all(
    hosts.map(async (host) => {
      const adapterStatuses: HostSummary["adapters"] = {};
      for (const adapter of host.adapters) {
        adapterStatuses[adapter] = await resolveAdapterStatus(host, adapter);
      }
      return { host, adapters: adapterStatuses };
    }),
  );

  return NextResponse.json({
    ok: true,
    hosts: summaries,
    timestamp: new Date().toISOString(),
  });
}

async function resolveAdapterStatus(
  host: HostConfig,
  adapter: AdapterKind,
): Promise<AdapterStatus> {
  switch (adapter) {
    case "prometheus":
      return getPrometheusStatus(host);
    case "loki":
      return getLokiStatus(host);
    default:
      return { state: "not_implemented" };
  }
}
