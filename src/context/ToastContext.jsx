import { createContext, useContext, useState, useRef, useCallback } from 'react';

const ToastContext = createContext(null);

const variantStyles = {
  default: { backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)' },
  success: { backgroundColor: '#27500A', color: '#EAF3DE' },
  error: { backgroundColor: '#A32D2D', color: '#FCEBEB' },
};

function ToastStack({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', bottom: '28px', left: '50%', transform: 'translateX(-50%)',
        display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center',
        zIndex: 9999, pointerEvents: 'none',
      }}
    >
      {toasts.map(t => (
        <div
          key={t.id}
          style={{
            ...(variantStyles[t.type] ?? variantStyles.default),
            padding: '8px 18px', borderRadius: '20px', fontSize: '13px', fontWeight: 500,
            fontFamily: 'system-ui, -apple-system, sans-serif', whiteSpace: 'nowrap',
            animation: 'toastIn 0.2s ease',
          }}
        >
          {t.message}
        </div>
      ))}
      <style>{`@keyframes toastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const showToast = useCallback((message, type = 'default') => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, message, type }].slice(-3));
    timers.current[id] = setTimeout(() => {
      setToasts(p => p.filter(t => t.id !== id));
      delete timers.current[id];
    }, 2500);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastStack toasts={toasts} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
