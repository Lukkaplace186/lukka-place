'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether this visitor has asked for less data, or is on a connection where
 * spending it is plainly a bad idea.
 *
 * Most of our visitors pay for every megabyte, on Android phones where
 * Chrome's "Lite mode"/Data Saver sets `navigator.connection.saveData`. A
 * 2G `effectiveType` (Chrome's own measurement, not the radio label) is
 * treated the same way. Surfaces use this to skip work a visitor did not ask
 * for — auto-loading the Maps JS API, preloading the neighbouring card photo —
 * never to hide content.
 *
 * `navigator.connection` does not exist in Safari or Firefox; there this is
 * always false, which is the old behaviour. The server snapshot is false too,
 * so the first paint never depends on it.
 */
export function prefersLightData() {
  if (typeof navigator === 'undefined') return false;
  const connection = navigator.connection;
  if (!connection) return false;
  return Boolean(connection.saveData) || /(^|-)2g$/.test(connection.effectiveType || '');
}

function subscribe(callback) {
  const connection = typeof navigator !== 'undefined' ? navigator.connection : null;
  if (!connection?.addEventListener) return () => {};
  connection.addEventListener('change', callback);
  return () => connection.removeEventListener('change', callback);
}

export function useSaveData() {
  return useSyncExternalStore(subscribe, prefersLightData, () => false);
}
