'use client';

import { WifiOff } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useOnline } from '@/lib/useOnline';
import { useT } from '@/lib/i18n/client';

/**
 * One pill, top centre, while the browser reports no connection. Mounted once
 * in app/layout.js so every surface gets it — including the agent dashboard,
 * which is used on site visits with patchy coverage. It explains why a tap
 * is not doing anything, which is otherwise indistinguishable from a broken
 * button. Nothing when online, and nothing on the server.
 */
export default function OfflineBanner() {
  const t = useT();
  const online = useOnline();
  if (online) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[100] flex justify-center px-4">
      <span
        role="status"
        className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[0.8125rem] font-semibold text-white shadow-lg"
      >
        <WifiOff strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
        {t('common.network.offline')}
      </span>
    </div>
  );
}
