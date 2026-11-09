'use client';

import { useState, useTransition } from 'react';
import { Check, CircleCheck, Home } from 'lucide-react';
import SafeImage from '@/components/SafeImage';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { answerStatusAction, changeStatusPriceAction } from '@/app/(site)/point/actions';

/**
 * "Faites le point sur vos annonces" — one screen, every listing, one tap
 * each (lib/statusCheck.js). Each tap is saved at once, so a dropped
 * connection loses only the tap in flight. French only: it is what the
 * agent's WhatsApp says and what the market speaks.
 *
 * `token` is the link's token, or null on the dashboard (session agent).
 * `items` carry their labels already formatted by the server.
 *
 * Wording is deliberately light (owner, 2026-11-09: collect as much as we
 * can without agents feeling policed): the closing price is offered as one
 * tap ("au prix affiché ?"), any other figure is optional, and the page says
 * the figures stay confidential.
 */

const BTN = 'u-press inline-flex min-h-11 min-w-0 items-center justify-center rounded-lg border px-2 text-center text-[0.8125rem] font-bold leading-tight disabled:opacity-60';
const BTN_IDLE = 'border-line bg-surface text-ink';
const BTN_ON = 'border-blue bg-blue-tint text-blue-deep';
const LINK = 'u-press text-[0.8125rem] font-semibold text-blue-deep underline-offset-2 hover:underline';

function soldWord(purpose) {
  if (purpose === 'rent') return 'Loué';
  if (purpose === 'sale') return 'Vendu';
  return 'Loué / vendu';
}

function todayKinshasa() {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

const DONE_TEXT = {
  active: 'Disponible — confirmée',
  under_offer: 'Sous offre — c\'est noté',
  closed: 'Conclu — merci !',
  withdrawn: 'Retirée du site',
};

export default function StatusCheckBoard({ token = null, items = [], firstName = null }) {
  const [states, setStates] = useState(() => ({}));
  const [bulkPending, startBulk] = useTransition();
  const [bulkError, setBulkError] = useState(null);

  const answeredCount = items.filter((item) => states[item.id]?.answered).length;
  const remaining = items.filter((item) => !states[item.id]?.answered);

  function setRow(id, patch) {
    setStates((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));
  }

  function confirmRest() {
    setBulkError(null);
    startBulk(async () => {
      let failed = 0;
      for (const item of remaining) {
        const answer = item.listingStatus === 'under_offer' ? 'still_under_offer' : 'available';
        try {
          const result = await answerStatusAction(token, item.id, { answer });
          if (result?.ok) setRow(item.id, { answered: true, state: result.state });
          else failed += 1;
        } catch {
          failed += 1;
        }
      }
      if (failed) setBulkError(`${failed} annonce${failed > 1 ? 's n\'ont' : ' n\'a'} pas pu être confirmée${failed > 1 ? 's' : ''}. Réessayez.`);
    });
  }

  if (!items.length) {
    return (
      <div className="rounded-card border border-line bg-surface p-5 text-center">
        <p className="u-title-card text-ink">Vous n&apos;avez aucune annonce en ligne pour le moment.</p>
        <p className="u-micro mt-1 text-ink-70">Rien à mettre à jour — merci !</p>
      </div>
    );
  }

  const allDone = answeredCount === items.length;

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h1 className="u-title-page text-ink">
          {firstName ? `Bonjour ${firstName}, faites le point` : 'Faites le point sur vos annonces'}
        </h1>
        <p className="u-micro text-ink-70">
          Un tap par annonce, c&apos;est enregistré tout de suite. Vos annonces confirmées apparaissent en premier sur Lukka Place.
        </p>
        <p className="u-micro-strong text-ink" aria-live="polite">
          {answeredCount} / {items.length} fait{answeredCount > 1 ? 'es' : 'e'}
        </p>
      </header>

      {allDone ? (
        <div className="flex items-center gap-2 rounded-card border border-success/40 bg-success-tint p-4 text-success">
          <CircleCheck strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 flex-none" aria-hidden="true" />
          <p className="font-semibold">Merci ! Toutes vos annonces sont à jour.</p>
        </div>
      ) : null}

      <ul className="flex flex-col gap-2.5">
        {items.map((item) => (
          <StatusRow
            key={item.id}
            item={item}
            token={token}
            state={states[item.id] || {}}
            onChange={(patch) => setRow(item.id, patch)}
          />
        ))}
      </ul>

      {!allDone ? (
        <div className="sticky bottom-0 -mx-3 border-t border-line bg-canvas/95 px-3 py-3">
          <button
            type="button"
            onClick={confirmRest}
            disabled={bulkPending}
            className="u-btn-primary u-press bg-blue text-white inline-flex min-h-11 w-full items-center justify-center rounded-lg px-4 font-bold disabled:opacity-60"
          >
            {bulkPending
              ? 'Enregistrement…'
              : answeredCount === 0
                ? 'Rien n\'a changé — tout confirmer'
                : `Les ${remaining.length} autre${remaining.length > 1 ? 's' : ''} n'ont pas changé`}
          </button>
          {bulkError ? <p className="u-micro mt-1 text-danger" role="alert">{bulkError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function StatusRow({ item, token, state, onChange }) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(null); // 'closed' | 'withdrawn' | 'price' | null
  const [error, setError] = useState(null);

  const underOffer = item.listingStatus === 'under_offer';
  const paused = Boolean(item.paused);
  const final = state.answered && (state.state === 'closed' || state.state === 'withdrawn');
  const selected = state.answered ? state.choice : null;

  function send(answer, extra = {}) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await answerStatusAction(token, item.id, { answer, ...extra });
        if (!result?.ok) {
          setError(result?.error || 'Une erreur est survenue. Réessayez.');
          return;
        }
        setOpen(null);
        onChange({ answered: true, state: result.state, choice: answer, freedSlot: result.freedSlot || null });
      } catch {
        setError('Pas de connexion. Réessayez.');
      }
    });
  }

  function sendPrice(price) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await changeStatusPriceAction(token, item.id, { price, currency: item.currency });
        if (!result?.ok) {
          setError(result?.error || 'Une erreur est survenue. Réessayez.');
          return;
        }
        setOpen(null);
        onChange({ answered: true, state: underOffer ? 'under_offer' : 'active', choice: 'price', newPriceLabel: `${price} ${item.currency === 'CDF' ? 'FC' : '$'}` });
      } catch {
        setError('Pas de connexion. Réessayez.');
      }
    });
  }

  const sold = soldWord(item.purpose);
  const choices = paused
    ? [[underOffer ? 'still_under_offer' : 'available', 'Réactiver'], ['closed', sold], ['withdrawn', 'Retiré']]
    : underOffer
      ? [['still_under_offer', 'Toujours sous offre'], ['closed', sold], ['available', 'De nouveau dispo'], ['withdrawn', 'Retiré']]
      : [['available', 'Disponible'], ['under_offer', 'Sous offre'], ['closed', sold], ['withdrawn', 'Retiré']];

  return (
    <li className={`rounded-card border bg-surface p-3 ${state.answered ? 'border-success/40' : 'border-line'}`}>
      <div className="flex gap-3">
        <div className="relative h-14 w-14 flex-none overflow-hidden rounded-lg bg-canvas-alt">
          {item.photo ? (
            <SafeImage src={item.photo} alt="" fill sizes="56px" className="object-cover" />
          ) : (
            <Home strokeWidth={ICON_STROKE_WIDTH} className="m-auto mt-4 h-6 w-6 text-ink-35" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="u-title-sub truncate text-ink">{item.title || `Annonce n° ${item.id}`}</p>
          <p className="u-micro truncate text-ink-70">{[item.place, item.priceLabel].filter(Boolean).join(' · ')}</p>
          {paused ? (
            <p className="u-micro-strong text-warning-ink">En pause : non confirmée depuis plus de 30 jours. Réactivez-la en un tap.</p>
          ) : null}
          <p className="u-micro text-ink-45">
            {underOffer ? 'Sous offre · ' : ''}
            {item.reference ? `Réf. ${item.reference} · ` : ''}
            {item.confirmedDaysAgo == null ? 'jamais confirmée' : item.confirmedDaysAgo === 0 ? 'confirmée aujourd\'hui' : `confirmée il y a ${item.confirmedDaysAgo} j`}
          </p>
        </div>
      </div>

      {state.answered ? (
        <p className="u-micro-strong mt-2 inline-flex items-center gap-1 text-success">
          <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
          {state.choice === 'price' ? `Prix mis à jour : ${state.newPriceLabel} — confirmée` : DONE_TEXT[state.state]}
        </p>
      ) : null}
      {state.freedSlot ? (
        <p className="u-micro mt-1 text-ink-70">
          1 place libérée sur votre forfait ({state.freedSlot.remaining} disponible{state.freedSlot.remaining > 1 ? 's' : ''} sur {state.freedSlot.limit}).
        </p>
      ) : null}

      {!final ? (
        <div className={`mt-2.5 grid gap-1.5 ${choices.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
          {choices.map(([answer, label]) => (
            <button
              key={answer}
              type="button"
              disabled={pending}
              aria-pressed={selected === answer || open === answer}
              onClick={() => {
                if (answer === 'closed' || answer === 'withdrawn') setOpen(open === answer ? null : answer);
                else send(answer);
              }}
              className={`${BTN} ${selected === answer || open === answer ? BTN_ON : BTN_IDLE}`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {!final && !underOffer && !paused && open !== 'price' ? (
        <button type="button" className={`${LINK} mt-2`} onClick={() => setOpen('price')}>
          Le prix a changé ?
        </button>
      ) : null}

      {open === 'closed' ? <ClosingForm item={item} pending={pending} onSubmit={(closing) => send('closed', closing)} /> : null}
      {open === 'withdrawn' ? (
        <div className="mt-2 rounded-lg bg-canvas-alt p-3">
          <p className="u-micro text-ink">Retirer l&apos;annonce du site, sans location ni vente ? Vous pourrez la remettre en ligne depuis votre espace.</p>
          <button type="button" disabled={pending} onClick={() => send('withdrawn')} className={`${BTN} ${BTN_IDLE} mt-2 w-full`}>
            Oui, retirer du site
          </button>
        </div>
      ) : null}
      {open === 'price' ? <PriceForm item={item} pending={pending} onSubmit={sendPrice} onCancel={() => setOpen(null)} /> : null}

      {error ? <p className="u-micro mt-2 text-danger" role="alert">{error}</p> : null}
    </li>
  );
}

/** More than 50 % from the asking price is read back before it is saved (same rule as WhatsApp). */
function farFrom(amount, reference) {
  const a = Number(amount);
  const r = Number(reference);
  return Number.isFinite(a) && Number.isFinite(r) && r > 0 && Math.abs(a - r) / r > 0.5;
}

function ClosingForm({ item, pending, onSubmit }) {
  const [mode, setMode] = useState(null); // 'asking' | 'other' | 'skip'
  const [amount, setAmount] = useState('');
  const [soldAt, setSoldAt] = useState(todayKinshasa());
  const [via, setVia] = useState(null);
  const [readBack, setReadBack] = useState(false);
  const [error, setError] = useState(null);
  const [today] = useState(todayKinshasa);
  const rent = item.purpose === 'rent';
  const askingUsd = item.price != null && item.price > 0 ? item.price : null;

  function submit() {
    setError(null);
    let soldPrice = null;
    if (mode === 'asking') soldPrice = askingUsd;
    if (mode === 'other') {
      const n = Number(String(amount).replace(/[\s ]/g, '').replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0) {
        setError('Indiquez le montant en dollars, ou choisissez « Je préfère ne pas dire ».');
        return;
      }
      if (farFrom(n, askingUsd) && !readBack) {
        setReadBack(true);
        return;
      }
      soldPrice = n;
    }
    if (!mode) {
      setError('Choisissez une réponse pour le prix (ou « Je préfère ne pas dire »).');
      return;
    }
    onSubmit({ soldPrice, soldAt, viaPlatform: via });
  }

  return (
    <div className="mt-2 flex flex-col gap-2.5 rounded-lg bg-canvas-alt p-3">
      <p className="u-micro-strong text-ink">Félicitations ! 🎉</p>

      {askingUsd ? (
        <div>
          <p className="u-micro text-ink">{rent ? 'Loué' : 'Vendu'} au prix affiché ({item.priceLabel}) ?</p>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <button type="button" aria-pressed={mode === 'asking'} onClick={() => { setMode('asking'); setReadBack(false); }} className={`${BTN} ${mode === 'asking' ? BTN_ON : BTN_IDLE}`}>Oui</button>
            <button type="button" aria-pressed={mode === 'other'} onClick={() => setMode('other')} className={`${BTN} ${mode === 'other' ? BTN_ON : BTN_IDLE}`}>Non, à un autre prix</button>
          </div>
        </div>
      ) : (
        <p className="u-micro text-ink">{rent ? 'À quel loyer mensuel a-t-il été loué ?' : 'À quel prix a-t-il été vendu ?'}</p>
      )}

      {mode === 'other' || (!askingUsd && mode !== 'skip') ? (
        <label className="u-micro flex flex-col gap-1 text-ink-70">
          {rent ? 'Loyer final ($ par mois)' : 'Prix de vente final ($)'}
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setReadBack(false); if (!askingUsd) setMode('other'); }}
            className="h-11 rounded-lg border border-line bg-surface px-3 text-base text-ink"
            placeholder={askingUsd ? String(askingUsd) : ''}
          />
        </label>
      ) : null}
      {readBack ? (
        <p className="u-micro text-warning-ink" role="status">
          Vous indiquez {amount} $, le prix affiché était {item.priceLabel}. Touchez « Enregistrer » pour confirmer.
        </p>
      ) : null}

      <button type="button" onClick={() => setMode('skip')} className={`${LINK} self-start ${mode === 'skip' ? 'text-ink' : ''}`} aria-pressed={mode === 'skip'}>
        {mode === 'skip' ? '✓ Je préfère ne pas dire le prix' : 'Je préfère ne pas dire le prix'}
      </button>

      <label className="u-micro flex flex-col gap-1 text-ink-70">
        {rent ? 'Loué le' : 'Vendu le'}
        <input
          type="date"
          value={soldAt}
          max={today}
          min={item.createdOn || undefined}
          onChange={(e) => setSoldAt(e.target.value)}
          className="h-11 rounded-lg border border-line bg-surface px-3 text-base text-ink"
        />
      </label>

      <div>
        <p className="u-micro text-ink">Le client a-t-il trouvé ce bien grâce à Lukka Place ? <span className="text-ink-45">(facultatif)</span></p>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <button type="button" aria-pressed={via === true} onClick={() => setVia(via === true ? null : true)} className={`${BTN} ${via === true ? BTN_ON : BTN_IDLE}`}>Oui</button>
          <button type="button" aria-pressed={via === false} onClick={() => setVia(via === false ? null : false)} className={`${BTN} ${via === false ? BTN_ON : BTN_IDLE}`}>Non</button>
        </div>
      </div>

      <p className="u-micro text-ink-45">Ces chiffres restent confidentiels et servent seulement aux statistiques du marché.</p>
      {error ? <p className="u-micro text-danger" role="alert">{error}</p> : null}
      <button type="button" disabled={pending} onClick={submit} className="u-btn-primary u-press bg-blue text-white inline-flex min-h-11 items-center justify-center rounded-lg px-4 font-bold disabled:opacity-60">
        {pending ? 'Enregistrement…' : 'Enregistrer'}
      </button>
    </div>
  );
}

function PriceForm({ item, pending, onSubmit, onCancel }) {
  const [value, setValue] = useState(item.authoredPrice != null ? String(item.authoredPrice) : '');
  const [readBack, setReadBack] = useState(false);
  const unit = item.currency === 'CDF' ? 'FC' : '$';
  const reference = item.authoredPrice;

  function submit(event) {
    event.preventDefault();
    const n = Number(String(value).replace(/[\s ]/g, '').replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return;
    if (farFrom(n, reference) && !readBack) {
      setReadBack(true);
      return;
    }
    onSubmit(n);
  }

  return (
    <form onSubmit={submit} className="mt-2 flex flex-col gap-2 rounded-lg bg-canvas-alt p-3">
      <label className="u-micro flex flex-col gap-1 text-ink-70">
        {item.purpose === 'rent' ? `Nouveau loyer (${unit} par mois)` : `Nouveau prix (${unit})`}
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => { setValue(e.target.value); setReadBack(false); }}
          className="h-11 rounded-lg border border-line bg-surface px-3 text-base text-ink"
        />
      </label>
      {readBack ? (
        <p className="u-micro text-warning-ink" role="status">
          C&apos;est très différent du prix actuel ({item.priceLabel}). Touchez « Enregistrer » pour confirmer.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-1.5">
        <button type="button" onClick={onCancel} className={`${BTN} ${BTN_IDLE}`}>Annuler</button>
        <button type="submit" disabled={pending} className={`${BTN} ${BTN_ON}`}>{pending ? '…' : 'Enregistrer'}</button>
      </div>
    </form>
  );
}
