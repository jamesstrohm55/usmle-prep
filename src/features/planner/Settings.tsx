import { useState } from 'react';
import type { Settings as StudySettings } from '../../db/queries';
import { useT } from '../../ui/lang';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const clampMin = (v: string) => Math.min(600, Math.max(0, Math.round(Number(v)) || 0));

export function Settings({ value, onSave }: { value: StudySettings; onSave: (s: StudySettings) => Promise<void> }) {
  const tr = useT();
  const [date, setDate] = useState(value.target_date ?? '');
  const [mins, setMins] = useState(value.minutes_by_weekday.map(String));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null);
    try { await onSave({ target_date: date || null, minutes_by_weekday: mins.map(clampMin) }); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <div className="card">
      <div className="settings-grid">
        <label>{tr('Target exam date')} <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {DAYS.map((d, i) => (
          <label key={d}>{tr(d)} {tr('(minutes)')} <input type="number" min={0} max={600} value={mins[i]}
            onChange={(e) => setMins(mins.map((m, j) => (j === i ? e.target.value : m)))} /></label>
        ))}
      </div>
      <button className="primary" onClick={save} disabled={busy}>{tr('Save')}</button>
      {error && <p role="alert">{tr('Could not save:')} {error}</p>}
    </div>
  );
}
