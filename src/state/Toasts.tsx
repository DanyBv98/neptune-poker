import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type Tone = 'info' | 'good' | 'warn' | 'bad' | 'fun';
interface Toast {
  id: number;
  text: string;
  tone: Tone;
  icon?: string;
}
interface ToastCtx {
  toast: (text: string, opts?: { tone?: Tone; icon?: string; ms?: number }) => void;
}
const Ctx = createContext<ToastCtx>({ toast: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const toast = useCallback<ToastCtx['toast']>((text, opts) => {
    const id = ++seq.current;
    setItems((xs) => [...xs.filter((x) => x.text !== text).slice(-3), { id, text, tone: opts?.tone ?? 'info', icon: opts?.icon }]);
    window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), opts?.ms ?? 3800);
  }, []);
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>
            {t.icon && <span className="toast-icon">{t.icon}</span>}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx).toast;
