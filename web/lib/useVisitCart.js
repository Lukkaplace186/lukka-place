'use client';

import { useSyncExternalStore } from 'react';
import { cartSnapshot, serverCartSnapshot, subscribeCart } from './visitCart';

/** The visitor's "Mes visites" cart, live across components and tabs. Empty on the server. */
export function useVisitCart() {
  return useSyncExternalStore(subscribeCart, cartSnapshot, serverCartSnapshot);
}
