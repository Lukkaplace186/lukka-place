'use client';

import { useMemo, useState, useTransition } from 'react';
import { Repeat, Send, MessageCircle, MapPin } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { formatPrice } from '@/lib/format';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import { buildAlternativesMessage, MAX_ALTERNATIVES } from '@/lib/listingAlternatives';
import { getAlternativesAction, sendAlternativesAction } from '@/app/compte/agent/alternativesActions';
import { useToast } from './Toast';
import { useT } from '@/lib/i18n/client';

/**
 * "Proposer des alternatives" on a lead or visit card: the agent picks up to
 * three listings (their own live listings first, pre-selected by rank; other
 * agencies' public listings on request) and sends them in ONE WhatsApp
 * message. The preview is the exact text the server will send — both sides
 * call buildAlternativesMessage.
 *
 * Two ways out, on purpose: "Envoyer via Lukka Place" goes through the engine
 * (tracked, but only lands inside WhatsApp's 24h window), and "Ouvrir dans mon
 * WhatsApp" opens the agent's own chat with the same text, which lands
 * whenever the agent is already talking to the customer. Self-contained so
 * the cards only render one element.
 */
export default function AgentAlternativesDialog({ kind, id, emphasis = false }) {
  const t = useT();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState([]);
  const [includePublic, setIncludePublic] = useState(false);
  const [loading, startLoading] = useTransition();
  const [sending, startSending] = useTransition();

  function load(withPublic) {
    setError(null);
    startLoading(async () => {
      let result;
      try {
        result = await getAlternativesAction(kind, id, { includePublic: withPublic });
      } catch (err) {
        console.error('[AgentAlternativesDialog] load failed', err);
        setError(t('agent.alternatives.errors.loadFailed'));
        return;
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setData(result);
      // The server widens to other agencies by itself when the agent has
      // nothing live to offer; keep the checkbox telling the truth.
      if (result.includePublic) setIncludePublic(true);
      // Default: the best-ranked of the agent's OWN listings. Keep whatever
      // the agent already ticked when they widen to public listings.
      setSelected((prev) => (prev.length ? prev : result.own.slice(0, MAX_ALTERNATIVES).map((l) => l.id)));
    });
  }

  function handleOpenChange(next) {
    setOpen(next);
    if (next && !data) load(includePublic);
  }

  function togglePublic() {
    const next = !includePublic;
    setIncludePublic(next);
    load(next);
  }

  function toggle(listingId) {
    setSelected((prev) => {
      if (prev.includes(listingId)) return prev.filter((x) => x !== listingId);
      if (prev.length >= MAX_ALTERNATIVES) return prev;
      return [...prev, listingId];
    });
  }

  const byId = useMemo(() => {
    const map = new Map();
    for (const l of [...(data?.own || []), ...(data?.others || [])]) map.set(l.id, l);
    return map;
  }, [data]);

  const chosen = selected.map((sid) => byId.get(sid)).filter(Boolean);
  const message = chosen.length ? buildAlternativesMessage(chosen, { name: data?.name }) : '';
  const ownLink = data?.waId && message ? buildWhatsAppLink(data.waId, message) : null;

  function send() {
    startSending(async () => {
      let result;
      try {
        result = await sendAlternativesAction(kind, id, chosen.map((l) => l.id));
      } catch (err) {
        console.error('[AgentAlternativesDialog] send failed', err);
        showToast({ type: 'error', message: t('errors.sendFailed') });
        return;
      }
      if (!result.ok) {
        showToast({ type: 'error', message: result.error });
        return;
      }
      showToast({ type: 'success', message: t('agent.alternatives.sent', { count: result.count }) });
      setOpen(false);
    });
  }

  const empty = data && data.own.length === 0 && data.others.length === 0;

  return (
    <>
      <button
        type="button"
        onClick={() => handleOpenChange(true)}
        className={`u-press inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg text-[0.8125rem] font-bold ${
          emphasis ? 'u-btn-primary bg-blue text-white' : 'u-btn-secondary text-ink'
        }`}
      >
        <Repeat strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        {t('agent.alternatives.open')}
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[88dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('agent.alternatives.title')}</DialogTitle>
            <DialogDescription>{t('agent.alternatives.hint', { max: MAX_ALTERNATIVES })}</DialogDescription>
          </DialogHeader>

          {error && (
            <p role="alert" className="rounded-lg bg-danger-tint px-3 py-2 text-sm font-semibold text-danger">
              {error}
            </p>
          )}

          {!data && loading && <p className="u-micro text-ink-45">{t('agent.alternatives.loading')}</p>}

          {data && (
            <div className="flex flex-col gap-4">
              {empty ? (
                <p className="rounded-lg bg-canvas-alt px-4 py-6 text-center text-sm text-ink-45">
                  {includePublic ? t('agent.alternatives.emptyAll') : t('agent.alternatives.emptyOwn')}
                </p>
              ) : (
                <>
                  <CandidateGroup
                    label={data.ownWidened ? t('agent.alternatives.ownGroupWidened') : t('agent.alternatives.ownGroup')}
                    items={data.own}
                    selected={selected}
                    onToggle={toggle}
                    emptyText={t('agent.alternatives.emptyOwn')}
                  />
                  {includePublic && (
                    <CandidateGroup
                      label={data.widened ? t('agent.alternatives.publicGroupWidened') : t('agent.alternatives.publicGroup')}
                      items={data.others}
                      selected={selected}
                      onToggle={toggle}
                      emptyText={t('agent.alternatives.emptyPublic')}
                    />
                  )}
                </>
              )}

              <label className="u-micro flex min-h-10 items-center gap-2.5 text-ink-70">
                <input
                  type="checkbox"
                  checked={includePublic}
                  onChange={togglePublic}
                  disabled={loading}
                  className="h-4 w-4 accent-[var(--blue)]"
                />
                {t('agent.alternatives.includePublic')}
              </label>

              {message && (
                <div>
                  <div className="u-micro-strong mb-1.5 text-ink-70">{t('agent.alternatives.preview')}</div>
                  <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-canvas-alt p-3 font-sans text-[0.8125rem] leading-relaxed text-ink">
                    {message}
                  </pre>
                </div>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                {ownLink ? (
                  <a
                    href={ownLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="u-btn-primary u-press inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue px-4 text-sm font-bold text-white"
                  >
                    <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                    {t('agent.alternatives.openOwnWhatsApp')}
                  </a>
                ) : (
                  <span
                    aria-disabled="true"
                    className="u-btn-primary inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue px-4 text-sm font-bold text-white opacity-60"
                  >
                    <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                    {t('agent.alternatives.openOwnWhatsApp')}
                  </span>
                )}
                <button
                  type="button"
                  onClick={send}
                  disabled={!chosen.length || sending}
                  className="u-btn-secondary u-press inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-bold text-ink disabled:opacity-60"
                >
                  <Send strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                  {sending ? t('agent.alternatives.sending') : t('agent.alternatives.sendLukka')}
                </button>
              </div>
              <p className="text-xs text-ink-35">{t('agent.alternatives.deliveryNote')}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CandidateGroup({ label, items, selected, onToggle, emptyText }) {
  const t = useT();
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="u-micro-strong mb-1 text-ink-70">{label}</legend>
      {items.length === 0 ? (
        <p className="u-micro text-ink-45">{emptyText}</p>
      ) : (
        items.map((listing) => {
          const checked = selected.includes(listing.id);
          const full = !checked && selected.length >= MAX_ALTERNATIVES;
          const place = [listing.quartier, listing.commune].filter(Boolean).join(', ');
          return (
            <label
              key={listing.id}
              className={`flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 ${
                checked ? 'border-blue bg-blue-tint' : 'border-line bg-surface'
              } ${full ? 'opacity-50' : ''}`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={full}
                onChange={() => onToggle(listing.id)}
                className="mt-1 h-4 w-4 shrink-0 accent-[var(--blue)]"
              />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-sm font-semibold text-ink">{listing.title}</span>
                <span className="u-micro mt-0.5 flex flex-wrap items-center gap-x-2 text-ink-45">
                  <span className="u-tabular">{formatPrice(listing.price, listing.purpose, listing.price_period)}</span>
                  {listing.beds > 0 && <span>{t('agent.alternatives.beds', { count: listing.beds })}</span>}
                  {place && (
                    <span className="inline-flex min-w-0 items-center gap-1">
                      <MapPin strokeWidth={ICON_STROKE_WIDTH} className="h-3 w-3 shrink-0" />
                      <span className="truncate">{place}</span>
                    </span>
                  )}
                  {listing.communeMatch && (
                    <span className="rounded-full bg-success-tint px-2 py-0.5 text-[0.6875rem] font-bold text-success">
                      {t('agent.alternatives.sameCommune')}
                    </span>
                  )}
                </span>
              </span>
            </label>
          );
        })
      )}
    </fieldset>
  );
}
