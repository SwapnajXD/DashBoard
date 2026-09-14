"use client";

import { useEffect, useState } from "react";
import { Pause, Play, Search } from "lucide-react";
import { Badge } from "./infrastructure";
import { observation } from "../lib/infrastructure/overview";
import type { LogSnapshot } from "../lib/types/logs";

function isSnapshot(value: unknown): value is LogSnapshot {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<LogSnapshot>;
  return typeof data.observedAt === "string" && Number.isFinite(Date.parse(data.observedAt)) && data.limit === 100 && data.windowSeconds === 900 && Array.isArray(data.entries) && data.entries.length <= 100 && data.entries.every(entry =>
    entry && typeof entry.timestamp === "string" && /^\d{1,20}$/.test(entry.timestamp) && typeof entry.source === "string" && typeof entry.line === "string" && typeof entry.truncated === "boolean");
}

export function LiveLogs({ compact = false }: { compact?: boolean }) {
  const [snapshot, setSnapshot] = useState<LogSnapshot | null>(null);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(true);

  useEffect(() => {
    if (paused) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    setConnecting(true);
    const refresh = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 10000);
      try {
        const response = await fetch("/api/logs", { cache: "no-store", signal: controller.signal });
        const data: unknown = await response.json();
        if (!response.ok) {
          const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "Unable to load logs.";
          throw new Error(message);
        }
        if (!isSnapshot(data)) throw new Error("The log response was invalid.");
        if (!stopped) { setSnapshot(data); setError(""); }
      } catch (cause) {
        if (!stopped) setError(cause instanceof Error && cause.name !== "AbortError" ? cause.message : "Log request timed out. Retrying…");
      } finally {
        clearTimeout(timeout);
        if (!stopped) { setConnecting(false); timer = setTimeout(refresh, 3000); }
      }
    };
    void refresh();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [paused]);

  const term = filter.trim().toLowerCase();
  const entries = snapshot?.entries.filter(entry => `${entry.source} ${entry.line}`.toLowerCase().includes(term));
  const visibleEntries = compact ? entries?.slice(0,3) : entries;
  const label = paused ? "Paused" : error ? "Disconnected" : connecting ? "Connecting" : "Live · 3s refresh";
  return <section className={`collection live-logs${compact ? " log-preview" : ""}`} aria-labelledby="live-logs-title">
    <div className="collection-heading"><h3 id="live-logs-title">{compact ? "Recent entries" : "Live logs"} <Badge label={label} tone={paused || error ? "warn" : connecting ? "muted" : "good"}/></h3><button className="log-toggle" onClick={() => setPaused(value => !value)}>{paused ? <Play size={14}/> : <Pause size={14}/>} {paused ? "Resume" : "Pause"}</button></div>
    {!compact ? <div className="log-controls"><label className="search-field"><Search size={15}/><span className="sr-only">Filter displayed log messages and sources</span><input type="search" placeholder="Filter messages or sources" value={filter} onChange={event => setFilter(event.target.value)}/></label><span>Newest first · latest 100 entries / 15 minutes</span></div> : null}
    <p className="log-status" role="status">{error ? `${error}${snapshot ? " Displayed entries are from the last successful refresh." : ""}` : paused ? "Updates paused. Resume to fetch the latest entries." : snapshot ? `Last fetched ${observation(snapshot.observedAt)} · ${visibleEntries?.length} displayed` : "Connecting to Loki…"}</p>
    <div className="log-stream" tabIndex={0} role="region" aria-label="Recent Loki log entries">
      {visibleEntries?.map((entry,index) => <article className="log-entry" key={`${entry.timestamp}/${index}`}><div className="log-entry-meta"><time dateTime={new Date(Number(BigInt(entry.timestamp) / BigInt(1000000))).toISOString()}>{new Date(Number(BigInt(entry.timestamp) / BigInt(1000000))).toISOString()}</time><span>{entry.source}</span></div><pre>{entry.line || "(empty log line)"}</pre>{entry.truncated ? <small>Line shortened to 8,192 characters.</small> : null}</article>)}
      {entries?.length === 0 ? <p className="empty">{snapshot?.entries.length ? "No displayed entries match this filter." : "No log entries in the last 15 minutes for the configured streams."}</p> : null}
      {!snapshot && !connecting ? <p className="empty">Logs are unavailable. {paused ? "Resume to connect." : "Reconnecting automatically."}</p> : null}
    </div>
    <p className="footnote">{compact ? "Preview: newest 3 entries. " : ""}Loki · configured streams only. This rolling view refreshes after each request; busy streams may exceed the 100-entry window. Pause to read without updates.</p>
  </section>;
}
