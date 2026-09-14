import React from "react";
import type { AdapterStatus, Reading } from "../lib/types/infrastructure";
import { adapterLabel, observation, readingLabel } from "../lib/infrastructure/overview";

export function Badge({ label, tone = "muted" }: { label: string; tone?: "good" | "warn" | "bad" | "muted" }) {
  return <span className={`badge ${tone}`}><span aria-hidden="true" />{label}</span>;
}
export function HostState({ status }: { status?: string }) {
  return <Badge label={status === "online" ? "Online" : status === "offline" ? "Offline" : "Unavailable"} tone={status === "online" ? "good" : status === "offline" ? "bad" : "muted"} />;
}
export function Source({ name, adapter }: { name: string; adapter?: AdapterStatus<unknown> }) {
  const success = adapter?.state === "ok" || adapter?.state === "partial";
  return <div className="source-row"><div><strong>{name}</strong><small>{success ? `Observed ${observation(adapter.timestamp)}` : `Attempt ${observation(adapter?.timestamp)}`}</small>{adapter?.error ? <small className="error-text">{adapter.error.message}</small> : null}</div><Badge label={adapterLabel(adapter)} tone={adapter?.state === "ok" ? "good" : adapter?.state === "partial" ? "warn" : adapter?.state === "error" ? "bad" : "muted"} /></div>;
}
export function Metric({ label, value, detail, source, at, utilization }: { label: string; value: string | number; detail?: string; source: string; at?: string | null; utilization?: number | null }) {
  return <div className="metric"><span className="eyebrow">{label}</span><strong className={typeof value === "string" && ["Unavailable", "Not configured", "Not verified", "Error"].includes(value) ? "metric-missing" : ""}>{value}</strong>{detail ? <span className="metric-detail">{detail}</span> : null}{utilization != null && Number.isFinite(utilization) && utilization >= 0 && utilization <= 100 ? <div className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={utilization}><span style={{ width: `${utilization}%` }} /></div> : null}<small>{source}</small>{at ? <small>{observation(at)}</small> : null}</div>;
}
export function Collection({ title, source, reading, children, empty = "No resources returned." }: { title: string; source: string; reading?: Reading<unknown[] | number | string> | null; children: React.ReactNode; empty?: string }) {
  const available = reading?.state === "available" && reading.data != null;
  const count = available && Array.isArray(reading.data) ? reading.data.length : null;
  return <div className="collection"><div className="collection-heading"><h3>{title}{count != null ? <span className="count">{count}</span> : null}</h3><span>{source}</span></div>{available ? count === 0 ? <p className="empty">{empty}</p> : children : <div className="empty"><Badge label={readingLabel(reading)} tone={reading?.error && reading.error.code !== "unconfigured" && reading.error.code !== "unavailable" ? "bad" : "muted"} /><p>{reading?.error?.message ?? "No observation is available from this source."}</p></div>}<div className="observed">{available ? "Observed" : "Attempt"} {observation(reading?.timestamp)}</div></div>;
}
export function DataTable({ label, columns, children }: { label: string; columns: string[]; children: React.ReactNode }) {
  return <div className="table-scroll" tabIndex={0} role="region" aria-label={label}><table><caption className="sr-only">{label}</caption><thead><tr>{columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}
