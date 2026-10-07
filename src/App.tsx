import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { AuthGate } from './features/auth/AuthGate';
import { ToastProvider } from './ui/Toast';
import { supabase } from './db/client';
import { clearCache } from './db/queries';
import { Flashcards } from './features/flashcards/Flashcards';
import { Questions } from './features/questions/Questions';
import { Notes } from './features/notes/Notes';
import { Search } from './features/search/Search';
import { ImportExport } from './features/import-export/ImportExport';

export function App() {
  return (
    <ToastProvider>
      <AuthGate>
        <HashRouter>
          <nav>
            <NavLink to="/">Cards</NavLink>
            <NavLink to="/questions">Questions</NavLink>
            <NavLink to="/notes">Notes</NavLink>
            <NavLink to="/search">Search</NavLink>
            <NavLink to="/data">Import / Export</NavLink>
            <button onClick={() => supabase.auth.signOut().finally(clearCache)}>Sign out</button>
          </nav>
          <main>
            <Routes>
              <Route path="/" element={<Flashcards />} />
              <Route path="/questions" element={<Questions />} />
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
