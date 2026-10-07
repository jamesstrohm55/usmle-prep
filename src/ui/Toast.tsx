import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Toast = { msg: string; retry?: () => void };
const Ctx = createContext<{ show: (msg: string, retry?: () => void) => void; dismiss: () => void }>({ show: () => {}, dismiss: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const show = useCallback((msg: string, retry?: () => void) => setToast({ msg, retry }), []);
  const dismiss = useCallback(() => setToast(null), []);
  return (
    <Ctx.Provider value={{ show, dismiss }}>
      {children}
      {toast && (
        <div className="toast" role="alert">
          {toast.msg}{' '}
          {toast.retry && <button onClick={() => { const r = toast.retry!; setToast(null); r(); }}>Retry</button>}
          <button onClick={() => setToast(null)}>Dismiss</button>
        </div>
      )}
    </Ctx.Provider>
  );
}
