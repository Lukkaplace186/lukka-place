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

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  /**
   * `action` ({ label, onClick }) adds one button — the portal's "Annuler"
   * after an instant remove. A toast carrying one stays up longer (6s): an
   * undo that vanishes before it can be read is not an undo.
   */
  const showToast = useCallback(({ type = 'success', message, action = null, duration }) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, type, message, action }]);

    const timer = setTimeout(() => dismiss(id), duration ?? (action ? 6000 : 4000));
    timers.current.set(id, timer);
    return id;
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ showToast, dismissToast: dismiss }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : 'status'}
            className={`u-lift pointer-events-auto flex items-center gap-4 rounded-lg px-4 py-2.5 text-sm font-semibold shadow-sm ${
              toast.type === 'error' ? 'bg-danger-tint text-danger' : 'bg-success-tint text-success'
            }`}
          >
            <span>{toast.message}</span>
            {toast.action ? (
              <button
                type="button"
                onClick={() => {
                  dismiss(toast.id);
                  toast.action.onClick();
                }}
                className="u-press -my-1 rounded-md px-2 py-1 font-bold underline underline-offset-2 hover:no-underline"
              >
                {toast.action.label}
              </button>
            ) : null}
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
