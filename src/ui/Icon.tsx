// Small stroke icons (24px grid, 1.75 stroke). Decorative: the text beside each icon names it.
const PATHS = {
  today: 'M8 2v4M16 2v4M3.5 9h17M5 4.5h14A1.5 1.5 0 0 1 20.5 6v13A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V6A1.5 1.5 0 0 1 5 4.5Zm4 10 2 2 4-4',
  diagnostic: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 3.2a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6Z',
  cards: 'M3.5 8 12 3.5 20.5 8 12 12.5 3.5 8Zm0 4.2L12 16.7l8.5-4.5M3.5 16.4 12 20.9l8.5-4.5',
  questions: 'M9 6h11M9 12h11M9 18h11M3.5 6l1.2 1.2L7 4.8M3.5 12l1.2 1.2L7 10.8M3.5 18l1.2 1.2L7 16.8',
  notes: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 13h6M9 17h6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-3.6-3.6',
  data: 'M7 4v13m0 0-3-3m3 3 3-3M17 20V7m0 0-3 3m3-3 3 3',
  out: 'M10 4.5H6A1.5 1.5 0 0 0 4.5 6v12A1.5 1.5 0 0 0 6 19.5h4M15 8l4 4-4 4m4-4H9',
  logo: 'M5 17c0-5.5 3-9 7-9s7 3.5 7 9M12 8V4m0 0-2.2 2.2M12 4l2.2 2.2M8 17h8',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
