import type { KubernetesPod, KubernetesPodMetrics, KubernetesUsage, Reading } from "../types/infrastructure";
import { quantity } from "../quantities";
import { freshness, listOf, readingLabel } from "./overview";

export function cpuUsage(value: number | null): string {
  return value === null || !Number.isFinite(value) || value < 0 ? "Unavailable" : `${(value * 1000).toFixed(1)} mCPU`;
}
export function metricState(sample: Pick<KubernetesUsage, "sampledAt" | "window" | "error"> | null | undefined, observedAt: string | null | undefined): string {
  if (!sample) return "Unavailable";
  if (sample.error?.code === "invalid_response") return "Error";
  if (!sample.sampledAt || !sample.window) return "Unavailable";
  return freshness(sample.sampledAt, observedAt);
}
export function nodeResources(name: string, reading?: Reading<(KubernetesUsage & { name: string })[]>) {
  const matches = listOf(reading)?.filter(item => item.name === name);
  const sample = matches?.length === 1 ? matches[0] : null;
  const timed = sample?.window && ["Recent at sync", "Older at sync"].includes(freshness(sample.sampledAt, reading?.timestamp));
  return { sample, cpu: timed ? quantity(sample.cpu) : null, memory: timed ? quantity(sample.memory) : null, state: sample ? metricState(sample, reading?.timestamp) : reading?.state === "unavailable" ? readingLabel(reading) : "Unavailable" };
}
export function podResources(pod: KubernetesPod, reading?: Reading<KubernetesPodMetrics[]>, now = Date.now()) {
  const matches = listOf(reading)?.filter(item => item.namespace === pod.namespace && item.name === pod.name);
  const sample = matches?.length === 1 ? matches[0] : null;
  const expected = pod.containers.filter(c => c.state === "running" || (c.kind === "container" && c.state !== "terminated"));
  const recent = sample && freshness(sample.sampledAt, new Date(now).toISOString()) === "Recent at sync";
  const timed = Boolean(sample?.window && !sample.error && recent && freshness(sample.sampledAt, reading?.timestamp) === "Recent at sync");
  const uniqueNames = new Set(pod.containers.map(c => c.name)).size === pod.containers.length;
  const complete = Boolean(timed && uniqueNames && expected.length && expected.length === sample?.containers.length && expected.every(c => sample?.containers.filter(m => m.name === c.name).length === 1));
  const sum = (key: "cpu" | "memory") => {
    if (!complete || !sample) return null;
    const values = sample.containers.map(c => quantity(c[key]));
    if (values.some(v => v === null)) return null;
    const total = values.reduce<number>((sum, v) => sum + v!, 0);
    return Number.isFinite(total) ? total : null;
  };
  const cpu = sum("cpu"), memory = sum("memory");
  return {
    sample, cpu, memory, complete: complete && cpu !== null && memory !== null,
    state: sample ? !recent ? "Unavailable" : metricState(sample, reading?.timestamp) : reading?.state === "unavailable" ? readingLabel(reading) : "Unavailable",
    containers: pod.containers.map(container => {
      const matches = sample?.containers.filter(c => c.name === container.name);
      const usage = timed && pod.containers.filter(c => c.name === container.name).length === 1 && matches?.length === 1 ? matches[0] : null;
      return { ...container, cpu: usage ? quantity(usage.cpu) : null, memory: usage ? quantity(usage.memory) : null, error: usage?.error ?? sample?.error ?? null };
    }),
  };
}
