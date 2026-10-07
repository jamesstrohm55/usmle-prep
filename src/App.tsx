import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { get, set, del } from 'idb-keyval';
import { AuthGate } from './features/auth/AuthGate';
import { ToastProvider } from './ui/Toast';
import { supabase } from './db/client';
import { Flashcards } from './features/flashcards/Flashcards';
import { Questions } from './features/questions/Questions';
import { Notes } from './features/notes/Notes';
import { Search } from './features/search/Search';
import { ImportExport } from './features/import-export/ImportExport';

const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 1000 * 60 * 60 * 24 * 7, staleTime: 60_000 } } });
const persister = createAsyncStoragePersister({
  storage: { getItem: (k) => get(k), setItem: (k, v) => set(k, v), removeItem: (k) => del(k) },
});

export function App() {
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 * 7 }}>
      <ToastProvider>
        <AuthGate>
          <HashRouter>
            <nav>
              <NavLink to="/">Cards</NavLink>
              <NavLink to="/questions">Questions</NavLink>
              <NavLink to="/notes">Notes</NavLink>
              <NavLink to="/search">Search</NavLink>
              <NavLink to="/data">Import / Export</NavLink>
              <button onClick={() => supabase.auth.signOut().then(() => queryClient.clear())}>Sign out</button>
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
    </PersistQueryClientProvider>
  );
}
