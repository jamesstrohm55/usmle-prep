// Renders **bold** and *italic* only; everything else is plain text (no HTML injection).
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return <>{parts.map((p, i) =>
    /^\*\*[^*]+\*\*$/.test(p) ? <strong key={i}>{p.slice(2, -2)}</strong>
    : /^\*[^*]+\*$/.test(p) ? <em key={i}>{p.slice(1, -1)}</em>
    : p)}</>;
}
