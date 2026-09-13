import "server-only";
import { resolveHostAddress } from "../config/hosts";
import type { AdapterStatus, HostConfig, LokiData } from "../types/infrastructure";
import { array, collected, endpoint, failed, object, reading, request, TelemetryFailure } from "./shared";

export async function getLokiStatus(host: HostConfig, transport = request): Promise<AdapterStatus<LokiData>> {
  try {
    const address = resolveHostAddress(host, "loki");
    const base = endpoint(process.env.LOKI_URL, address ? `http://${address}:3100` : null);
    const headers: Record<string, string> = {};
    if (process.env.LOKI_BEARER_TOKEN) headers.Authorization = `Bearer ${process.env.LOKI_BEARER_TOKEN}`;
    if (process.env.LOKI_TENANT_ID) headers["X-Scope-OrgID"] = process.env.LOKI_TENANT_ID;
    await transport(base, "/ready", { headers }, false);
    const labelCount = await reading(async () => {
      const body = object(await transport(base, "/loki/api/v1/labels", { headers }));
      if (body.status !== "success") throw new TelemetryFailure("upstream", "Loki label query did not succeed.");
      const labels = array(body.data);
      if (labels.some(label => typeof label !== "string" || !label.trim())) {
        throw new TelemetryFailure("invalid_response", "Loki label names are invalid.");
      }
      return labels.length;
    });
    return collected({ ready: true, labelCount }, [labelCount]);
  } catch (error) { return failed(error); }
}
