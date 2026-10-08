import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

// Interface language for the sidebar menu only. Study content, questions and test screens stay in English.
export type Lang = 'en' | 'pt';
const KEY = 'ui-lang';

export const MENU = {
  en: { today: 'Today', diagnostic: 'Diagnostic', cards: 'Cards', questions: 'Questions', notes: 'Notes', search: 'Search', data: 'Import / Export', signOut: 'Sign out' },
  pt: { today: 'Hoje', diagnostic: 'Diagnóstico', cards: 'Cartões', questions: 'Questões', notes: 'Notas', search: 'Buscar', data: 'Importar / Exportar', signOut: 'Sair' },
} as const;
export type MenuKey = keyof (typeof MENU)['en'];

const read = (): Lang => { try { return localStorage.getItem(KEY) === 'pt' ? 'pt' : 'en'; } catch { return 'en'; } };
const write = (l: Lang) => { try { localStorage.setItem(KEY, l); } catch { /* lasts for this visit only */ } };

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: 'en', setLang: () => {} });
export const useLang = () => useContext(Ctx);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, set] = useState<Lang>(read);
  const setLang = useCallback((l: Lang) => { set(l); write(l); }, []);
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export function LangSwitch() {
  const { lang, setLang } = useLang();
  return (
    <div className="lang-switch" role="group" aria-label="Menu language / Idioma do menu">
      {(['en', 'pt'] as const).map((l) => (
        <button key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
      ))}
    </div>
  );
}
