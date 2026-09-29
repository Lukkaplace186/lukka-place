'use client';

import dynamic from 'next/dynamic';

// The sheet pulls in the phone field and the slot picker; it loads after the
// page, and renders nothing until the visitor has put a listing in
// "Mes visites" (lib/visitCart.js).
const VisitCartSheet = dynamic(() => import('./VisitCartSheet'), { ssr: false });

export default function VisitCartMount() {
  return <VisitCartSheet />;
}
