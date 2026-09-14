import React from "react";
import type { KubernetesData, KubernetesPod } from "../lib/types/infrastructure";
import { bytes, listOf, observation, quantity, readingLabel } from "../lib/infrastructure/overview";
import { cpuUsage, nodeResources, podResources } from "../lib/infrastructure/resources";
import { Badge, DataTable, Metric } from "./infrastructure";

const cores = (value: string | null | undefined) => quantity(value) === null ? "Unavailable" : `${quantity(value)} cores`;
function Freshness({ state }: { state: string }) {
  return <Badge label={state} tone={state === "Recent at sync" ? "good" : state === "Older at sync" ? "warn" : state === "Error" || state === "Invalid timestamp" ? "bad" : "muted"} />;
}
export function HermesResourceSummary({ data }: { data?: KubernetesData | null }) {
  const node = listOf(data?.nodes)?.find(node => node.name === "hermes");
  const usage = nodeResources("hermes", data?.nodeMetrics);
  return <div className="resource-summary"><div className="metrics two">
    <Metric label="Hermes CPU usage" value={cpuUsage(usage.cpu)} detail={`Capacity ${cores(node?.capacity.cpu)} · allocatable ${cores(node?.allocatable.cpu)}`} source="Kubernetes metrics-server" at={usage.sample?.sampledAt} atLabel="Sampled" />
    <Metric label="Hermes memory usage" value={bytes(usage.memory)} detail={`Capacity ${bytes(quantity(node?.capacity.memory))} · allocatable ${bytes(quantity(node?.allocatable.memory))}`} source="Kubernetes metrics-server" at={usage.sample?.sampledAt} atLabel="Sampled" />
  </div><div className="resource-note"><Freshness state={usage.state} /><span>Usage window {usage.sample?.window ?? "unavailable"}. Capacity and allocatable: Kubernetes API. {usage.sample?.error?.message ?? data?.nodeMetrics.error?.message}</span></div></div>;
}
export function NodeResourcesTable({ data }: { data?: KubernetesData | null }) {
  return <><DataTable label="Kubernetes nodes and usage" columns={["Node / role", "Ready condition", "CPU usage / capacity", "Memory usage / capacity", "Metrics observation"]}>{listOf(data?.nodes)?.map(node => {
    const usage = nodeResources(node.name, data?.nodeMetrics);
    return <tr key={node.name}><th scope="row">{node.name}<small>{node.roles.join(", ") || "Role unavailable"}</small></th><td><Badge label={node.status === "online" ? "Ready" : node.status === "offline" ? "Not ready" : "Unavailable"} tone={node.status === "online" ? "good" : node.status === "offline" ? "bad" : "muted"} /></td><td>{cpuUsage(usage.cpu)}<small>Capacity {cores(node.capacity.cpu)}</small><small>Allocatable {cores(node.allocatable.cpu)}</small></td><td>{bytes(usage.memory)}<small>Capacity {bytes(quantity(node.capacity.memory))}</small><small>Allocatable {bytes(quantity(node.allocatable.memory))}</small></td><td>{observation(usage.sample?.sampledAt)}<small>Window {usage.sample?.window ?? "unavailable"} · metrics-server</small><Freshness state={usage.state} />{usage.sample?.error ? <small className="error-text">{usage.sample.error.message}</small> : null}</td></tr>;
  })}</DataTable>{data?.nodeMetrics.error ? <p className="footnote error-text">metrics-server: {data.nodeMetrics.error.message}</p> : null}</>;
}
export function PodRows({ pod, metrics }: { pod: KubernetesPod; metrics: KubernetesData["podMetrics"] }) {
  const usage = podResources(pod, metrics);
  return <><tr><th scope="row">{pod.name}</th><td>{pod.namespace}<small>{pod.node ?? "Unassigned"}</small></td><td><Badge label={pod.phase ?? "Unavailable"} tone={pod.phase === "Succeeded" ? "good" : pod.phase === "Failed" ? "bad" : pod.phase === "Running" ? "good" : "warn"} /></td><td><span>{cpuUsage(usage.cpu)}</span><small>{bytes(usage.memory)}</small><small>{usage.complete ? "Sum of container samples" : "Incomplete, stale or missing samples"}</small><small>metrics-server · sampled {observation(usage.sample?.sampledAt)}</small><Freshness state={usage.state} /></td><td>{pod.containers.filter(c => c.ready === true).length} / {pod.containers.length} ready<small>{pod.containers.some(c => c.ready === null) ? "Some readiness unavailable" : pod.phase === "Succeeded" ? "Completed workload" : "Reported container readiness"}</small><small>Restarts: {pod.containers.some(c => c.restartCount === null) ? "Unavailable" : pod.containers.reduce((sum, c) => sum + c.restartCount!, 0)}</small></td></tr>
    <tr className="container-detail-row"><td colSpan={5}><details><summary>Container resources · {pod.namespace}/{pod.name}</summary><div className="container-detail"><p>Kubernetes metrics-server · sampled {observation(usage.sample?.sampledAt)} · window {usage.sample?.window ?? "unavailable"}. Observed {observation(metrics?.timestamp)}. Values belong to individual named containers; samples older than two minutes are unavailable.</p>{metrics?.state === "unavailable" ? <p className="error-text">{readingLabel(metrics)}: {metrics.error?.message}</p> : null}{usage.sample?.error ? <p className="error-text">{usage.sample.error.message}</p> : null}<DataTable label={`Container resources for ${pod.namespace}/${pod.name}`} columns={["Container / kind", "State / ready", "CPU usage", "Memory usage"]}>{usage.containers.map(container => <tr key={`${container.kind}/${container.name}`}><th scope="row">{container.name}<small>{container.kind}</small></th><td>{container.state}<small>{container.ready === null ? "Readiness unavailable" : container.ready ? "Ready" : "Not ready"}</small></td><td>{cpuUsage(container.cpu)}</td><td>{bytes(container.memory)}{container.error ? <small className="error-text">{container.error.message}</small> : null}</td></tr>)}</DataTable>{!usage.containers.length ? <p>No declared containers available.</p> : null}</div></details></td></tr>
  </>;
}
