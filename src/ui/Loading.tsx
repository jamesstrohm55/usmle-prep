import { useT } from './lang';

// Two cubes chasing each other around a square. The text stays for screen readers and tests.
export function Loading({ compact = false }: { compact?: boolean }) {
  const tr = useT();
  return (
    <p role="status" className={`loading${compact ? ' compact' : ''}`}>
      <span className="loader-box" aria-hidden="true"><span className="loader" /></span>
      <span className="sr-only">{tr('Loading…')}</span>
    </p>
  );
}
