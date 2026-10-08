import { useEffect, useState } from 'react';
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

function SignOut() {
  const toast = useToast();
  const go = () => {
    markExplicitSignOut();
    supabase.auth.signOut()
      .catch((e: Error) => { markExplicitSignOut(false); toast.show(`Could not sign out: ${e.message}`); })
      .finally(clearCache);
  };
  return <button onClick={go}>Sign out</button>;
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
  return to ? <Navigate to={to} replace /> : <p role="status">Loading…</p>;
}

export function App() {
  return (
    <ToastProvider>
      <AuthGate>
        <HashRouter>
          <nav>
            <NavLink to="/today">Today</NavLink>
            <NavLink to="/diagnostic">Diagnostic</NavLink>
            <NavLink to="/cards">Cards</NavLink>
            <NavLink to="/questions">Questions</NavLink>
            <NavLink to="/notes">Notes</NavLink>
            <NavLink to="/search">Search</NavLink>
            <NavLink to="/data">Import / Export</NavLink>
            <SignOut />
          </nav>
          <main>
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
          </main>
        </HashRouter>
      </AuthGate>
    </ToastProvider>
  );
}
