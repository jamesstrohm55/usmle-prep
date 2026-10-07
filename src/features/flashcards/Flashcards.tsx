import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchCards, fetchCardStates, saveReview, setItemStatus } from '../../db/queries';
import type { Card } from '../../db/models';
import { buildQueue } from '../../engine/queue';
import { newCard, rateCard, toRow, fromRow, Rating, type CardStateRow } from '../../engine/fsrs';
import { useToast } from '../../ui/Toast';
import { Rich } from '../../ui/Rich';

type States = Map<string, CardStateRow>;
const loadData = async () => ({ cards: await fetchCards(), states: (await fetchCardStates()) as States });

const NEW_PER_SESSION = 20;
const GRADES = [
  ['Again', Rating.Again], ['Hard', Rating.Hard], ['Good', Rating.Good], ['Easy', Rating.Easy],
] as const;

export function Flashcards({ load = loadData, save = saveReview }: { load?: typeof loadData; save?: typeof saveReview }) {
  const toast = useToast();
  const [data, setData] = useState<{ cards: Card[]; states: States } | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [showPt, setShowPt] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const shownAt = useRef(Date.now());
  // Load once on mount; a ref keeps an inline `load` prop from re-fetching and resetting the queue each render.
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current().then((d) => {
      setData(d);
      const states = new Map([...d.states].map(([id, r]) => [id, { due: new Date(r.due) }]));
      setQueue(buildQueue(d.cards.map((c) => c.id), states, new Date(), NEW_PER_SESSION));
    }).catch((e) => toast.show(`Could not load cards: ${e.message}`));
  }, [toast.show]); // show is stable (useCallback); the context object changes with every toast

  const byId = useMemo(() => new Map((data?.cards ?? []).map((c) => [c.id, c])), [data]);
  const current = queue[0] ? byId.get(queue[0]) : undefined;

  const headId = useRef<string | undefined>(undefined);
  headId.current = current?.id;

  async function rate(rating: (typeof GRADES)[number][1]) {
    if (!current || !data || busy.current) return;
    busy.current = true;
    setSaving(true);
    const id = current.id;
    const now = new Date();
    const prev = data.states.get(current.id);
    const { card } = rateCard(prev ? fromRow(prev) : newCard(now), rating, now);
    try {
      await save(current.id, toRow(card), rating, now.getTime() - shownAt.current);
    } catch (e) {
      // retry is a no-op if the card has since moved on (stale closure would re-save and skip a card)
      toast.show(`Could not save your rating: ${(e as Error).message}`, () => { if (headId.current === id) rate(rating); });
      return;
    } finally {
      busy.current = false;
      setSaving(false);
    }
    data.states.set(current.id, toRow(card));
    setQueue((q) => q.slice(1));
    setRevealed(false);
    setShowPt(false);
    shownAt.current = Date.now();
  }

  const flag = (status: 'flagged' | 'verified', ok: string) =>
    setItemStatus('card', current!.id, status).then(() => toast.show(ok), (e) => toast.show(`Could not update status: ${e.message}`));

  if (!data) return <p>Loading…</p>;
  if (!current) return <p>Nothing due. Come back later, or add cards on the Import tab.</p>;

  return (
    <div className="card">
      <p><small>{queue.length} left · {current.system} · {current.discipline}</small></p>
      <h2>{current.front}</h2>
      {current.image_url && <figure><img src={current.image_url} alt="" style={{ maxWidth: '100%' }} /><figcaption>{current.image_credit}</figcaption></figure>}
      {!revealed ? (
        <button onClick={() => setRevealed(true)}>Show answer</button>
      ) : (
        <>
          <p><Rich text={current.back} /></p>
          {current.back_pt && (showPt ? <p lang="pt-BR"><Rich text={current.back_pt} /></p> : <button onClick={() => setShowPt(true)}>Ver em português</button>)}
          <div>{GRADES.map(([label, r]) => <button key={label} disabled={saving} onClick={() => rate(r)}>{label}</button>)}</div>
          <p>
            <button onClick={() => flag('flagged', 'Flagged for review.')}>Flag as wrong</button>{' '}
            <button onClick={() => flag('verified', 'Marked verified.')}>Mark verified</button>
          </p>
        </>
      )}
    </div>
  );
}
