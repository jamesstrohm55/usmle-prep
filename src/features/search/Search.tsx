import { useRef, useState } from 'react';
import { search, fetchCards, fetchQuestions, fetchNotes } from '../../db/queries';
import type { Card, Question, Note } from '../../db/models';
import { useToast } from '../../ui/Toast';
import { Rich } from '../../ui/Rich';

type Hit = Awaited<ReturnType<typeof search>>[number];
type Row = Card | Question | Note;

// Hits only carry a title; open the full row from the (offline-cached) lists.
async function lookupRow(kind: Hit['kind'], id: string): Promise<Row | undefined> {
  const rows: Row[] = await (kind === 'card' ? fetchCards() : kind === 'question' ? fetchQuestions() : fetchNotes());
  return rows.find((r) => r.id === id);
}

function PtReveal({ label, text }: { label: string; text: string | null }) {
  const [on, setOn] = useState(false);
  if (!text) return null;
  return on ? <p lang="pt-BR"><Rich text={text} /></p> : <button onClick={() => setOn(true)}>{label}</button>;
}

function Detail({ kind, row }: { kind: Hit['kind']; row: Row }) {
  if (kind === 'card') {
    const c = row as Card;
    return <><p><Rich text={c.back} /></p><PtReveal label="Ver em português" text={c.back_pt} /></>;
  }
  if (kind === 'question') {
    const q = row as Question;
    return (
      <>
        <p>{q.stem}</p>
        <ul>{q.choices.map((c, i) => <li key={i}>{c}{i === q.correct && ' ✓ (correct)'}</li>)}</ul>
        <p><Rich text={q.explanation} /></p>
        <PtReveal label="Ver em português" text={q.explanation_pt} />
      </>
    );
  }
  const n = row as Note;
  return <><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}><Rich text={n.body_md} /></pre><PtReveal label="Ver em português" text={n.body_pt_md} /></>;
}

type Opened = { state: 'loading' } | { state: 'error'; msg: string } | { state: 'missing' } | { state: 'ok'; row: Row };

function HitItem({ hit, lookup }: { hit: Hit; lookup: typeof lookupRow }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Opened | null>(null);

  function load() {
    setData({ state: 'loading' });
    lookup(hit.kind, hit.id).then(
      (row) => setData(row ? { state: 'ok', row } : { state: 'missing' }),
      (e: Error) => setData({ state: 'error', msg: e.message }),
    );
  }
  function toggle() {
    setOpen(!open);
    if (!open && data?.state !== 'ok') load();
  }

  return (
    <li>
      <button aria-expanded={open} onClick={toggle} style={{ font: 'inherit', background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }}>
        <small>{hit.kind} · {hit.system}</small> {hit.title}
      </button>
      {open && data && (
        <div>
          {data.state === 'loading' && <p>Loading…</p>}
          {data.state === 'missing' && <p>This item is no longer available.</p>}
          {data.state === 'error' && <p>Could not open: {data.msg} <button onClick={load}>Retry</button></p>}
          {data.state === 'ok' && <Detail kind={hit.kind} row={data.row} />}
        </div>
      )}
    </li>
  );
}

export function Search({ load = search, lookup = lookupRow }: { load?: typeof search; lookup?: typeof lookupRow }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const seq = useRef(0); // latest-wins: a slower, older response must not overwrite a newer one

  async function run(term: string) {
    const mine = ++seq.current;
    try {
      const r = await load(term);
      if (mine === seq.current) setHits(r);
    } catch (err) {
      if (mine === seq.current) toast.show(`Search failed: ${(err as Error).message}`, () => run(term));
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (term) run(term);
  }

  return (
    <div>
      <form role="search" onSubmit={submit}>
        <input type="search" role="searchbox" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cards, questions, notes" />{' '}
        <button type="submit">Search</button>
      </form>
      {hits && !hits.length && <p>No results.</p>}
      <ul>{(hits ?? []).map((h) => <HitItem key={`${h.kind}-${h.id}`} hit={h} lookup={lookup} />)}</ul>
    </div>
  );
}
