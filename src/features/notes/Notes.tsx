import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchNotes } from '../../db/queries';
import type { Note } from '../../db/models';
import { Rich } from '../../ui/Rich';
import { systemLabel } from '../../ui/systemLabel';
import { Loading } from '../../ui/Loading';
import { useT } from '../../ui/lang';

export function Notes({ load = fetchNotes }: { load?: typeof fetchNotes }) {
  const tr = useT();
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

  if (error) return <p>{tr('Could not load notes:')} {error} <button onClick={refresh}>{tr('Retry')}</button></p>;
  if (!notes) return <Loading />;
  if (!notes.length) return <p>{tr('No notes yet.')}</p>;

  return (
    <div>
      {notes.map((n) => (
        <div className="card note" key={n.id}>
          <h3>
            <button className="note-head" aria-expanded={open === n.id} onClick={() => { setOpen(open === n.id ? null : n.id); setPt(false); }}>
              <span>{n.title} <small>({systemLabel(n.system, tr)})</small></span>
            </button>
          </h3>
          {open === n.id && (
            <div className="note-body">
              {/* ponytail: notes render as pre-wrapped text with bold/italic only; tables show as raw markdown. Add a markdown renderer when notes become long-form. */}
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}><Rich text={pt && n.body_pt_md ? n.body_pt_md : n.body_md} /></pre>
              {n.body_pt_md && <p style={{ marginTop: 14 }}><button onClick={() => setPt(!pt)}>{pt ? 'Show English' : 'Ver em português'}</button></p>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
