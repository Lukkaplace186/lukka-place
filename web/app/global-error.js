'use client';

import { useEffect } from 'react';

/**
 * Last-resort boundary for a failure in the ROOT layout itself. It replaces
 * that layout, so there is no I18nProvider, no globals.css and no header —
 * hence inline styles and both languages in one screen. Every ordinary page
 * failure is caught earlier by app/(site)/error.js and its siblings.
 */
export default function GlobalError({ error, retry }) {
  useEffect(() => {
    console.error('[global] root layout failed', error);
  }, [error]);

  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 16px',
          background: '#FBF9F6',
          color: '#101A2E',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          textAlign: 'center',
        }}
      >
        <main style={{ maxWidth: 360, width: '100%' }}>
          <p style={{ fontWeight: 800, fontSize: 20, color: '#1D5BD8', margin: '0 0 24px' }}>Lukka Place</p>
          <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>La page n’a pas pu se charger</h1>
          <p style={{ fontSize: 15, lineHeight: 1.55, color: '#4A5468', margin: 0 }}>
            Vérifiez votre connexion puis réessayez.
          </p>
          <p style={{ fontSize: 13, color: '#7A8394', marginTop: 10 }}>This page couldn’t load. Check your connection and try again.</p>
          <button
            type="button"
            onClick={() => (retry ? retry() : window.location.reload())}
            style={{
              width: '100%', minHeight: 48, marginTop: 24, border: 0, borderRadius: 999,
              background: '#1D5BD8', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer',
            }}
          >
            Réessayer
          </button>
        </main>
      </body>
    </html>
  );
}
