import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../db/client';

type Meta = { full_name?: string; name?: string; avatar_url?: string; picture?: string };

// Google fills user_metadata (full_name, avatar_url); an email-link sign-in has only the email.
export function accountOf(user: Pick<User, 'email' | 'user_metadata'>) {
  const m = (user.user_metadata ?? {}) as Meta;
  const name = m.full_name || m.name || user.email || '';
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return { name, photo: m.avatar_url || m.picture || null, initials };
}

export function AccountBadge({ user }: { user: Pick<User, 'email' | 'user_metadata'> }) {
  const { name, photo, initials } = accountOf(user);
  const [broken, setBroken] = useState(false);
  if (!name) return null;
  return (
    <div className="account" title={user.email ?? name}>
      {photo && !broken
        // Google photo URLs can refuse a referrer, so none is sent.
        ? <img src={photo} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        : <span className="avatar" aria-hidden="true">{initials}</span>}
      <span className="account-name">{name}</span>
    </div>
  );
}

export function Account() {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    let live = true;
    supabase.auth.getSession().then(({ data }) => { if (live) setUser(data.session?.user ?? null); }, () => {});
    const { data } = supabase.auth.onAuthStateChange((_e, s) => { if (live) setUser(s?.user ?? null); });
    return () => { live = false; data.subscription.unsubscribe(); };
  }, []);
  return user ? <AccountBadge user={user} /> : null;
}
