import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchCards, fetchCardStates, saveReview, setItemStatus } from '../../db/queries';
import type { Card } from '../../db/models';
import { buildQueue } from '../../engine/queue';
import { newCard, rateCard, toRow, fromRow, Rating, type CardStateRow } from '../../engine/fsrs';
import { useToast } from '../../ui/Toast';
import { Rich } from '../../ui/Rich';
import { ItemImage } from '../../ui/ItemImage';
import { systemLabel } from '../../ui/systemLabel';

type States = Map<string, CardStateRow>;
const loadData = async () => ({ cards: await fetchCards(), states: (await fetchCardStates()) as States });

const NEW_PER_SESSION = 20;
const REQUEUE_WITHIN_MS = 20 * 60_000; // learning-step cards come back this session, like Anki
const GRADES = [
  ['Again', Rating.Again], ['Hard', Rating.Hard], ['Good', Rating.Good], ['Easy', Rating.Easy],
] as const;

export function Flashcards({ load = loadData, save = saveReview }: { load?: typeof loadData; save?: typeof saveReview }) {
  const toast = useToast();
  const [data, setData] = useState<{ cards: Card[]; states: States } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [showPt, setShowPt] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const shownAt = useRef(Date.now());
  // Load once on mount; a ref keeps an inline `load` prop from re-fetching and resetting the queue each render.
  const loadRef = useRef(load);

  const refresh = useCallback(() => {
    setLoadError(null);
    loadRef.current().then((d) => {
      setData(d);
      const states = new Map([...d.states].map(([id, r]) => [id, { due: new Date(r.due) }]));
      setQueue(buildQueue(d.cards.map((c) => c.id), states, new Date(), NEW_PER_SESSION));
    }).catch((e) => setLoadError(e.message));
  }, []);
  useEffect(refresh, [refresh]);

  const byId = useMemo(() => new Map((data?.cards ?? []).map((c) => [c.id, c])), [data]);
  const current = queue[0] ? byId.get(queue[0]) : undefined;

  // Retry closures die on unmount (e.g. a different user signed in) and when the card has been advanced/re-presented.
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const turn = useRef(0);

  async function rate(rating: (typeof GRADES)[number][1]) {
    if (!current || !data || busy.current) return;
    busy.current = true;
    setSaving(true);
    const id = current.id;
    const myTurn = turn.current;
    const now = new Date();
    const prev = data.states.get(current.id);
    const { card } = rateCard(prev ? fromRow(prev) : newCard(now), rating, now);
    try {
      await save(current.id, toRow(card), rating, now.getTime() - shownAt.current);
    } catch (e) {
      // retry is a no-op if the card has since moved on (stale closure would re-save and skip a card)
      toast.show(`Could not save your rating: ${(e as Error).message}`, () => { if (alive.current && turn.current === myTurn) rate(rating); });
      return;
    } finally {
      busy.current = false;
      setSaving(false);
    }
    turn.current++;
    toast.dismiss(); // any earlier Retry is now stale
    data.states.set(current.id, toRow(card));
    // Due again within minutes (Again/Hard/learning steps): send it to the back of this session's queue.
    const soon = card.due.getTime() - now.getTime() <= REQUEUE_WITHIN_MS;
    setQueue((q) => (soon ? [...q.slice(1), id] : q.slice(1)));
    setRevealed(false);
    setShowPt(false);
    shownAt.current = Date.now();
  }

  const flag = (status: 'flagged' | 'verified', ok: string, note?: string) =>
    setItemStatus('card', current!.id, status, note).then(() => toast.show(ok), (e) => toast.show(`Could not update status: ${e.message}`));
  function flagWrong() {
    const note = window.prompt('What is wrong? (optional)');
    if (note === null) return; // cancelled: do not flag
    flag('flagged', 'Flagged for review.', note.trim() || undefined);
  }

  if (loadError) return <p>Could not load cards: {loadError} <button onClick={refresh}>Retry</button></p>;
  if (!data) return <p>Loading…</p>;
  if (!current) return <p>Nothing due. Come back later, or add cards on the Import tab.</p>;

  return (
    <div className="card flash">
      <p className="flash-meta"><small>{queue.length} left · {systemLabel(current.system)} · {current.discipline}</small></p>
      <h2>{current.front}</h2>
      <ItemImage src={current.image_url} credit={current.image_credit} />
      {!revealed ? (
        <button className="primary" onClick={() => setRevealed(true)}>Show answer</button>
      ) : (
        <>
          <div className="answer">
            <p><Rich text={current.back} /></p>
            {current.back_pt && (showPt ? <p lang="pt-BR"><Rich text={current.back_pt} /></p> : <button onClick={() => setShowPt(true)}>Ver em português</button>)}
          </div>
          <div className="grades">{GRADES.map(([label, r]) => <button key={label} className={label.toLowerCase()} disabled={saving} onClick={() => rate(r)}>{label}</button>)}</div>
          <p className="item-actions">
            <button onClick={flagWrong}>Flag as wrong</button>
            <button onClick={() => flag('verified', 'Marked verified.')}>Mark verified</button>
          </p>
        </>
      )}
    </div>
  );
}
