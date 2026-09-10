import type { AdapterStatus, HostConfig } from "@/app/lib/types/infrastructure";

/**
 * Kubernetes (K3s) adapter foundation.
 *
 * NOT YET IMPLEMENTED. Athena runs a single-node K3s cluster (API on
 * :6443). A real implementation should use a kubeconfig loaded from a
 * server-side secret/env var (e.g. `K3S_KUBECONFIG`) and the official
 * `@kubernetes/client-node` package, never exposed to the browser.
 *
 * Returns an honest "not_implemented" status so callers don't fabricate
 * node/pod state.
 */
export async function getKubernetesStatus(
  host: HostConfig,
): Promise<AdapterStatus> {
  void host;
  return { state: "not_implemented" };
}
