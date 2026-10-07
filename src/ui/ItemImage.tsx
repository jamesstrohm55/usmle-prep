import { useState } from 'react';

// Relative paths (images/...) live under public/ and need the Vite base prefix; https URLs pass through.
export function ItemImage({ src, credit }: { src: string; credit?: string | null }) {
  const [failed, setFailed] = useState(false);
  const url = /^https?:\/\//i.test(src) ? src : `${import.meta.env.BASE_URL}${src.replace(/^\/+/, '')}`;
  return (
    <figure>
      {failed ? <p>Image unavailable</p> : (
        <img src={url} alt="Clinical image (see the question)" loading="lazy" decoding="async" style={{ maxWidth: '100%' }} onError={() => setFailed(true)} />
      )}
      {credit && <figcaption>{credit}</figcaption>}
    </figure>
  );
}
