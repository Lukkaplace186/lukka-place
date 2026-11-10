'use client';

import { useEffect, useState } from 'react';
import { BellRing, BellOff, Smartphone } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { inNativeApp, pushPermission, startAppPush, stopAppPush } from '@/lib/appBridge';

/**
 * "Application" in the agent's Réglages (`side="agent"`, copy under
 * `agent.app`) and the customer's Mon profil (`side="customer"`, copy under
 * `account.app`). In the Lukka Place app: whether this phone gets alerts,
 * with the switch. In a browser: the store links (only the ones configured —
 * NEXT_PUBLIC_PLAY_STORE_URL / NEXT_PUBLIC_APP_STORE_URL; none yet means
 * "bientôt disponible", never a dead link) and how many phones already
 * receive this account's alerts.
 */
const COPY = {
  agent: {
    on: 'agent.app.on', off: 'agent.app.off', denied: 'agent.app.denied', turnOff: 'agent.app.turnOff',
    turnOn: 'agent.app.turnOn', fallback: 'agent.app.fallback', pitch: 'agent.app.pitch', googlePlay: 'agent.app.googlePlay',
    appStore: 'agent.app.appStore', comingSoon: 'agent.app.comingSoon', devices: 'agent.app.devices',
  },
  customer: {
    on: 'account.app.on', off: 'account.app.off', denied: 'account.app.denied', turnOff: 'account.app.turnOff',
    turnOn: 'account.app.turnOn', fallback: 'account.app.fallback', pitch: 'account.app.pitch', googlePlay: 'account.app.googlePlay',
    appStore: 'account.app.appStore', comingSoon: 'account.app.comingSoon', devices: 'account.app.devices',
  },
};

export default function AppAlertsCard({ side = 'agent', playStoreUrl = null, appStoreUrl = null, deviceCount = 0 }) {
  const t = useT();
  const k = COPY[side === 'customer' ? 'customer' : 'agent'];
  const [state, setState] = useState({ inApp: false, permission: 'unsupported', busy: false, stopped: false });

  useEffect(() => {
    if (!inNativeApp()) return;
    pushPermission().then((permission) => setState((s) => ({ ...s, inApp: true, permission })));
  }, []);

  const enable = async () => {
    setState((s) => ({ ...s, busy: true }));
    const permission = await startAppPush({ ask: true, side });
    setState((s) => ({ ...s, busy: false, permission, stopped: false }));
  };
  const disable = async () => {
    setState((s) => ({ ...s, busy: true }));
    await stopAppPush({ side });
    setState((s) => ({ ...s, busy: false, stopped: true }));
  };

  if (state.inApp) {
    const on = state.permission === 'granted' && !state.stopped;
    return (
      <div className="flex flex-col gap-3">
        <p className={`flex items-center gap-2 text-[0.8125rem] font-semibold ${on ? 'text-success' : 'text-ink-70'}`}>
          {on
            ? <BellRing strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
            : <BellOff strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />}
          {on ? t(k.on) : t(k.off)}
        </p>
        {state.permission === 'denied' ? (
          <p className="text-xs text-ink-45">{t(k.denied)}</p>
        ) : on ? (
          <button
            type="button"
            onClick={disable}
            disabled={state.busy}
            className="u-btn-secondary u-press h-11 self-start rounded-lg px-4 text-sm font-bold text-ink"
          >
            {t(k.turnOff)}
          </button>
        ) : (
          <button
            type="button"
            onClick={enable}
            disabled={state.busy}
            className="u-btn-primary u-press h-11 self-start rounded-lg bg-blue px-4 text-sm font-bold text-white"
          >
            {t(k.turnOn)}
          </button>
        )}
        <p className="text-xs text-ink-45">{t(k.fallback)}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.8125rem] text-ink-70">{t(k.pitch)}</p>
      {playStoreUrl || appStoreUrl ? (
        <div className="flex flex-wrap gap-2">
          {playStoreUrl && (
            <a href={playStoreUrl} target="_blank" rel="noopener noreferrer" className="u-btn-primary u-press inline-flex h-11 items-center gap-2 rounded-lg bg-blue px-4 text-sm font-bold text-white">
              <Smartphone strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
              {t(k.googlePlay)}
            </a>
          )}
          {appStoreUrl && (
            <a href={appStoreUrl} target="_blank" rel="noopener noreferrer" className="u-btn-secondary u-press inline-flex h-11 items-center gap-2 rounded-lg px-4 text-sm font-bold text-ink">
              <Smartphone strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
              {t(k.appStore)}
            </a>
          )}
        </div>
      ) : (
        <p className="text-xs font-semibold text-ink-45">{t(k.comingSoon)}</p>
      )}
      {deviceCount > 0 && <p className="text-xs text-ink-45">{t(k.devices, { count: deviceCount })}</p>}
    </div>
  );
}
