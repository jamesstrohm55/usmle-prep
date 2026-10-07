import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Toast = { msg: string; retry?: () => void };
const Ctx = createContext<{ show: (msg: string, retry?: () => void) => void }>({ show: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const show = useCallback((msg: string, retry?: () => void) => setToast({ msg, retry }), []);
  return (
    <Ctx.Provider value={{ show }}>
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
