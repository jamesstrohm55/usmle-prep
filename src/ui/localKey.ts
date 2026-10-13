// Small per-browser memory (plan snapshots, "note read" ticks, the planned question set). Storage may be unavailable:
// reads then come back empty and writes last for this visit only.
export const readKey = (key: string): string => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } };
export const writeKey = (key: string, v: string) => {
  try { if (v) localStorage.setItem(key, v); else localStorage.removeItem(key); } catch { /* visit only */ }
};
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
