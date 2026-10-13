import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchNotes } from '../../db/queries';
import type { Note } from '../../db/models';
import { Rich } from '../../ui/Rich';
import { systemLabel } from '../../ui/systemLabel';
import { Loading } from '../../ui/Loading';
import { useT } from '../../ui/lang';
import { errMsg } from '../../ui/errMsg';

// `only` shows a single note, already open (the plan's "Read" link); without it, the whole list.
export function Notes({ load = fetchNotes, only }: { load?: typeof fetchNotes; only?: string }) {
  const tr = useT();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(only ?? null);
  const [pt, setPt] = useState(false);
  const loadRef = useRef(load);

  const refresh = useCallback(() => {
    setError(null);
    loadRef.current().then(setNotes).catch((e) => setError(errMsg(e)));
  }, []);
  useEffect(refresh, [refresh]);

  if (error) return <p role="alert">{tr('Could not load notes:')} {error} <button onClick={refresh}>{tr('Retry')}</button></p>;
  if (!notes) return <Loading />;
  if (!notes.length && !only) return <p>{tr('No notes yet.')}</p>;

  const shown = only ? notes.filter((n) => n.id === only) : notes;
  return (
    <div>
      {only && (
        <p className="q-nav">
          <a href="#/notes">{tr('All notes')}</a>
          <a href="#/today">{tr('Back to Today')}</a>
        </p>
      )}
      {only && !shown.length && <p>{tr('That note is no longer available.')}</p>}
      {shown.map((n) => (
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

export function NotesRoute() {
  const [p] = useSearchParams();
  return <Notes only={p.get('note') ?? undefined} />;
}
