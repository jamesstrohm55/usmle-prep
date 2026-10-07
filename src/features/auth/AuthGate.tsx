import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../db/client';
import { clearCache } from '../../db/queries';
import { clearLastUserId, getLastUserId, setLastUserId, takeExplicitSignOut } from '../../db/lastUser';
import { useToast } from '../../ui/Toast';
import { Login } from './Login';

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [offline, setOffline] = useState(false);
  const [hadSession, setHadSession] = useState(false); // once true, children stay mounted behind the Login overlay
  const [epoch, setEpoch] = useState(0); // bump to remount children for a different user
  const { dismiss } = useToast();
  const prevUser = useRef<string | null>(getLastUserId());

  useEffect(() => {
    function adopt(s: Session) {
      const id = s.user.id;
      if (prevUser.current && prevUser.current !== id) { void clearCache(); dismiss(); setEpoch((n) => n + 1); } // a pending Retry belongs to the old user
      prevUser.current = id;
      setLastUserId(id);
      setOffline(false);
      setHadSession(true);
      setSession(s);
    }
    function check() {
      supabase.auth.getSession().then(({ data, error }) => {
        if (data.session) return adopt(data.session);
        const netFail = error?.name === 'AuthRetryableFetchError' || !navigator.onLine;
        const off = netFail && !!getLastUserId(); // recomputed each time, so coming back online leaves offline mode
        setOffline(off);
        if (off) setHadSession(true);
        setSession(null);
      });
    }
    check();
    const { data } = supabase.auth.onAuthStateChange((e, s) => {
      if (s) return adopt(s);
      if (e !== 'SIGNED_OUT') return; // INITIAL_SESSION without a session is resolved by check()
      if (takeExplicitSignOut()) {
        clearLastUserId(); prevUser.current = null; void clearCache(); dismiss();
        setHadSession(false); setEpoch((n) => n + 1);
      }
      setOffline(false);
      setSession(null);
    });
    window.addEventListener('online', check);
    return () => { data.subscription.unsubscribe(); window.removeEventListener('online', check); };
  }, [dismiss]);

  if (session === undefined) return <main>Loading…</main>;
  const active = !!session || offline;
  return (
    <>
      {offline && !session && <p role="status" className="offline">Offline — showing saved content. Changes can't be saved until you reconnect.</p>}
      {hadSession && <div key={epoch} hidden={!active}>{children}</div>}
      {!active && <Login />}
    </>
  );
}
