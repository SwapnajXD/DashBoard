// Kubernetes quantity syntax: SI, binary SI, and decimal exponent. Invalid data stays absent.
export function quantity(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d+(?:\.\d*)?|\.\d+)([eE][+-]?\d+|[numkKMGTPE]|[KMGTPE]i)?$/.exec(value);
  if (!match) return null;
  const factors: Record<string, number> = { n: 1e-9, u: 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18, Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5, Ei: 1024 ** 6 };
  const suffix = match[2] ?? "";
  const result = Number(match[1]) * (suffix ? factors[suffix] ?? 10 ** Number(suffix.slice(1)) : 1);
  return Number.isFinite(result) && result >= 0 ? result : null;
}
