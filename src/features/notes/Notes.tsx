import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchNotes } from '../../db/queries';
import type { Note } from '../../db/models';
import { Rich } from '../../ui/Rich';

export function Notes({ load = fetchNotes }: { load?: typeof fetchNotes }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [pt, setPt] = useState(false);
  const loadRef = useRef(load);

  const refresh = useCallback(() => {
    setError(null);
    loadRef.current().then(setNotes).catch((e) => setError(e.message));
  }, []);
  useEffect(refresh, [refresh]);

  if (error) return <p>Could not load notes: {error} <button onClick={refresh}>Retry</button></p>;
  if (!notes) return <p>Loading…</p>;
  if (!notes.length) return <p>No notes yet.</p>;

  return (
    <div>
      {notes.map((n) => (
        <div className="card" key={n.id}>
          <h3 onClick={() => { setOpen(open === n.id ? null : n.id); setPt(false); }} style={{ cursor: 'pointer' }}>
            {n.title} <small>({n.system})</small>
          </h3>
          {open === n.id && (
            <>
              {/* ponytail: notes render as pre-wrapped text with bold/italic only; tables show as raw markdown. Add a markdown renderer when notes become long-form. */}
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}><Rich text={pt && n.body_pt_md ? n.body_pt_md : n.body_md} /></pre>
              {n.body_pt_md && <button onClick={() => setPt(!pt)}>{pt ? 'Show English' : 'Ver em português'}</button>}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
