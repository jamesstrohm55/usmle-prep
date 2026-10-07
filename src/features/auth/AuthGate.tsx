import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../db/client';
import { clearCache } from '../../db/queries';
import { Login } from './Login';

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((e, s) => { if (e === 'SIGNED_OUT') void clearCache(); setSession(s); });
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <main>Loading…</main>;
  return session ? <>{children}</> : <Login />;
}
