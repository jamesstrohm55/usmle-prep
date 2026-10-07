import { useState } from 'react';

export const IMAGE_ALT = 'Clinical image (see the question)';

// Relative paths (images/...) live under public/ and need the Vite base prefix.
// Only https:// is absolute (matches the seed schema); http:// is treated as relative and will not load.
export function ItemImage({ src, credit }: { src?: string | null; credit?: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src) return null;
  const url = src.startsWith('https://') ? src : `${import.meta.env.BASE_URL}${src.replace(/^\/+/, '')}`;
  // The credit URL often contains the Commons file name, which can name the diagnosis: keep it collapsed.
  return (
    <figure>
      {failed ? <p>Image unavailable</p> : (
        <img src={url} alt={IMAGE_ALT} loading="lazy" decoding="async" style={{ maxWidth: '100%' }} onError={() => setFailed(true)} />
      )}
      {credit && <figcaption><details><summary>Image credit</summary>{credit}</details></figcaption>}
    </figure>
  );
}
