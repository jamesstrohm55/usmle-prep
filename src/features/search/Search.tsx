import { useRef, useState } from 'react';
import { search } from '../../db/queries';
import { useToast } from '../../ui/Toast';

type Hit = Awaited<ReturnType<typeof search>>[number];

export function Search({ load = search }: { load?: typeof search }) {
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
      <ul>{(hits ?? []).map((h) => <li key={`${h.kind}-${h.id}`}><small>{h.kind} · {h.system}</small> {h.title}</li>)}</ul>
    </div>
  );
}
