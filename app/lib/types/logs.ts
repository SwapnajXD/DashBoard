export type LogEntry = {
  timestamp: string;
  source: string;
  line: string;
  truncated: boolean;
};

export type LogSnapshot = {
  entries: LogEntry[];
  observedAt: string;
  limit: number;
  windowSeconds: number;
};
