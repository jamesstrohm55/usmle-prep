import { useEffect, useState, type ReactNode } from 'react';
import { HashRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { AuthGate } from './features/auth/AuthGate';
import { ToastProvider, useToast } from './ui/Toast';
import { markExplicitSignOut } from './db/lastUser';
import { supabase } from './db/client';
import { clearCache, fetchRuns } from './db/queries';
import { Today } from './features/planner/Today';
import { Diagnostic } from './features/diagnostic/Diagnostic';
import { Flashcards } from './features/flashcards/Flashcards';
import { QuestionsRoute } from './features/questions/Questions';
import { Notes } from './features/notes/Notes';
import { Search } from './features/search/Search';
import { ImportExport } from './features/import-export/ImportExport';
import { Icon, type IconName } from './ui/Icon';
import { Account } from './ui/Account';
import { LangProvider, LangSwitch, MENU, useLang, type MenuKey } from './ui/lang';
import { Loading } from './ui/Loading';

function SignOut() {
  const toast = useToast();
  const { lang } = useLang();
  const go = () => {
    markExplicitSignOut();
    supabase.auth.signOut()
      .catch((e: Error) => { markExplicitSignOut(false); toast.show(`Could not sign out: ${e.message}`); })
      .finally(clearCache);
  };
  return <button onClick={go}><Icon name="out" />{MENU[lang].signOut}</button>;
}

function Home() {
  const [to, setTo] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetchRuns()
      .then((r) => live && setTo(r.some((x) => x.status === 'completed') ? '/today' : '/diagnostic'))
      .catch(() => live && setTo('/today')); // Today works without a diagnostic
    return () => { live = false; };
  }, []);
  return to ? <Navigate to={to} replace /> : <Loading />;
}

const NAV: [string, MenuKey, IconName][] = [
  ['/today', 'today', 'today'], ['/diagnostic', 'diagnostic', 'diagnostic'], ['/cards', 'cards', 'cards'],
  ['/questions', 'questions', 'questions'], ['/notes', 'notes', 'notes'], ['/search', 'search', 'search'], ['/data', 'data', 'data'],
];

export function Shell({ children }: { children: ReactNode }) {
  const { lang } = useLang();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Icon name="logo" size={19} /></span>USMLE Prep</div>
        <nav lang={lang === 'pt' ? 'pt-BR' : undefined}>
          {NAV.map(([to, key, icon]) => <NavLink key={to} to={to}><Icon name={icon} />{MENU[lang][key]}</NavLink>)}
          <SignOut />
        </nav>
        <div className="version" title={`Build ${__BUILD_SHA__} · ${__BUILD_DATE__} UTC`} aria-hidden="true">{__BUILD_SHA__}</div>
      </aside>
      <div className="content">
        <div className="topbar"><LangSwitch /><Account /></div>
        <main>{children}</main>
      </div>
    </div>
  );
}

export function App() {
  return (
    <LangProvider>
    <ToastProvider>
      <AuthGate>
        <HashRouter>
          <Shell>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/today" element={<Today />} />
              <Route path="/diagnostic" element={<Diagnostic />} />
              <Route path="/cards" element={<Flashcards />} />
              <Route path="/questions" element={<QuestionsRoute />} />
              <Route path="/notes" element={<Notes />} />
              <Route path="/search" element={<Search />} />
              <Route path="/data" element={<ImportExport />} />
            </Routes>
          </Shell>
        </HashRouter>
      </AuthGate>
    </ToastProvider>
    </LangProvider>
  );
}
