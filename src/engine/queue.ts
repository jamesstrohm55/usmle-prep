export function buildQueue(
  cardIds: string[],
  states: Map<string, { due: Date }>,
  now: Date,
  newBudget: number,
): string[] {
  const due = cardIds
    .filter((id) => states.has(id) && states.get(id)!.due <= now)
    .sort((a, b) => states.get(a)!.due.getTime() - states.get(b)!.due.getTime());
  const fresh = cardIds.filter((id) => !states.has(id)).slice(0, Math.max(0, newBudget));
  return [...due, ...fresh];
}
