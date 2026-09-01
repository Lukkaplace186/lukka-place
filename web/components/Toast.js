'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';

/**
 * Minimal hand-rolled toast — no toast library exists anywhere in web/, and
 * this settings page never needs more than one message in flight at a time,
 * so a stacking/auto-dismiss library would be pure overhead. Reuses the
 * existing success/danger tokens (app/globals.css) rather than inventing new
 * colors.
 */
const ToastContext = createContext(null);

let nextId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const showToast = useCallback(({ type = 'success', message }) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, type, message }]);

    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timers.current.delete(id);
    }, 4000);
    timers.current.set(id, timer);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : 'status'}
            className={`u-lift pointer-events-auto rounded-lg px-4 py-2.5 text-sm font-semibold shadow-sm ${
              toast.type === 'error' ? 'bg-danger-tint text-danger' : 'bg-success-tint text-success'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside a ToastProvider');
  return ctx;
}
