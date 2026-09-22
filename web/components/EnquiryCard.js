'use client';

import { useEffect, useState } from 'react';
import { useIsLoggedIn } from '@/lib/customerClient';
import { MessageCircle, Phone, CalendarClock } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import FavoriteButton from './FavoriteButton';
import { trackLeadClick } from '@/lib/analyticsClient';
import { resolveWhatsAppRouting } from '@/lib/leadRouting';
import ShareButton from './ShareButton';
import AgentMonogram from './AgentMonogram';
import AgentVerificationBadge from './AgentVerificationBadge';
import { displayableAgencyName } from '@/lib/agentIdentity';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { submitVisitRequestAction } from '@/app/(site)/listings/[id]/actions';
import PhoneField from './PhoneField';
import { phoneFieldLabels } from '@/lib/phoneFieldLabels';
import { useLocale, useT } from '@/lib/i18n/client';

const FIELD_CLASS =
  'u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-35';

// Keys, not text — see components/navItems.js.
const VISIT_ERROR_KEYS = {
  phone: 'enquiry.errors.phone',
  time: 'enquiry.errors.time',
  1: 'enquiry.errors.failed',
};

/**
 * "Demander une visite" — a real Dialog + form-action, same composition
 * DeleteAccountButton.js already established for a public (site) page: a
 * plain trigger button, local `open` state, and a server-action `<form>`
 * inside DialogFooter. The redirect this action ends with closes the dialog
 * on its own (a full page navigation unmounts it); visitSent/visitError
 * feedback is rendered as an always-visible banner on the parent card
 * instead of inside the dialog itself — EnquiryCard renders twice on this
 * page (mobile inline + desktop rail), and a Radix Dialog portals to
 * `document.body`, bypassing whichever instance's parent is CSS-hidden for
 * the current viewport; auto-reopening both on error would show two
 * stacked dialogs at once.
 */
// One request per page load: EnquiryCard renders twice on a listing page
// (mobile inline + desktop rail), and both dialogs want the same profile.
let accountProfilePromise = null;
function loadAccountProfile() {
  if (!accountProfilePromise) {
    accountProfilePromise = fetch('/api/account/me', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
  }
  return accountProfilePromise;
}

function VisitRequestDialog({ propertyId }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const bound = submitVisitRequestAction.bind(null, propertyId);

  // A signed-in customer's visit request is found in their account by
  // phone number, so the form opens with the account's own number (and
  // name) already in it — see app/api/account/me/route.js. Still editable:
  // someone booking for a relative may genuinely want another number.
  const loggedIn = useIsLoggedIn();
  const [profile, setProfile] = useState(null);
  useEffect(() => {
    if (!loggedIn) return undefined;
    let live = true;
    loadAccountProfile().then((value) => {
      if (live && value) setProfile(value);
    });
    return () => {
      live = false;
    };
  }, [loggedIn]);
  // Uncontrolled fields read defaultValue once, so they remount when the
  // profile arrives. It is fetched on page load, well before a visitor
  // reaches the button, so nothing typed is lost to the remount.
  const prefillKey = profile ? 'account' : 'anonymous';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="u-press u-btn-secondary inline-flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-ink"
      >
        <CalendarClock strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
        {t('enquiry.requestViewing')}
      </button>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('enquiry.requestViewing')}</DialogTitle>
          <DialogDescription>
            {t('enquiry.intro')}
          </DialogDescription>
        </DialogHeader>

        <form action={bound} className="flex flex-col gap-4">
          <div>
            <label htmlFor="visit-name" className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
              {t('enquiry.nameOptional')}
            </label>
            <input
              key={prefillKey}
              id="visit-name"
              name="name"
              autoComplete="name"
              enterKeyHint="next"
              defaultValue={profile?.fullName || ''}
              placeholder={t('enquiry.namePlaceholder')}
              className={FIELD_CLASS}
            />
          </div>

          <PhoneField
            key={prefillKey}
            name="phone"
            id="visit-phone"
            locale={locale}
            {...(profile?.phoneCountry
              ? { defaultCountry: profile.phoneCountry, defaultValue: profile.phoneNational, detectCountry: false }
              : {})}
            labels={{ ...phoneFieldLabels(t), label: t('enquiry.whatsappNumber') }}
            labelClassName="mb-1.5 text-[0.8125rem] font-semibold normal-case tracking-normal text-ink-70"
            fieldClassName="h-11 rounded-lg bg-surface"
            required
          />

          <div>
            <label htmlFor="visit-time" className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
              {t('enquiry.preferredSlot')}
            </label>
            <input
              id="visit-time"
              name="requested_time"
              enterKeyHint="send"
              required
              placeholder={t('enquiry.slotPlaceholder')}
              className={FIELD_CLASS}
            />
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <button type="button" className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink-70 hover:bg-canvas-alt">
                {t('common.actions.cancel')}
              </button>
            </DialogClose>
            <button type="submit" className="u-btn-primary u-press rounded-lg bg-blue px-5 py-2 text-sm font-bold text-white">
              {t('enquiry.submit')}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The agent panel from web/Design's listing-detail screen — the right
 * rail's first card.
 *
 * Design anatomy: an initials avatar in a royal-50 circle, the agent's name
 * and a qualifying line, a hairline divider, then a full-width primary
 * "Contacter par WhatsApp", a full-width secondary "Appeler l'agent", and a
 * ghost Enregistrer/Partager pair. The WhatsApp message itself still goes out
 * pre-filled with the reference and listing link (buildWhatsAppMessage below)
 * — only the caption spelling that out on-page is gone, on an explicit
 * instruction to keep the consumer-facing card free of behind-the-scenes
 * mechanics.
 *
 * This replaces the previous version of this card, which led with the price
 * and a currency toggle. Both moved: the price now leads the main column at
 * 44px (the design's loudest number) and is restated by `PricePanel`
 * directly below this card, and the currency toggle lives in the header on
 * every page.
 *
 * Honest-data notes, unchanged from before:
 *  - `agency_name` / `agent_phone` come from the real agents join
 *    (lib/listings.js). They are NOT NULL on every listing any more — that
 *    claim was true when written and is now stale: 23 of the 46 approved
 *    listings carry a real agent. When they are null the panel still falls
 *    back to naming Lukka Place itself rather than inventing an agent. The
 *    design's "· 34 biens à Kinshasa" qualifier is dropped entirely — no
 *    per-agent listing count is available on this row, and it is exactly the
 *    kind of number that must not be guessed.
 *  - "Appeler l'agent" renders only when a real per-listing number exists.
 *  - WhatsApp falls back to the one central number, and renders a disabled
 *    state (not a dead wa.me link) when that env var is unset.
 *
 * Carries a real `.u-lift` drop shadow instead of this app's usual `.u-card`
 * hairline, per an explicit instruction matching a real Rightmove
 * screenshot — the same scoped, deliberate departure from the design
 * system's normal card treatment as PhotoGallery.js's own frame (see its
 * doc comment).
 *
 * Also plays a quick `.u-reveal` entrance (app/globals.css, gated on
 * prefers-reduced-motion) on mount — `animate="visible"`, not `whileInView`.
 * This card shares the gallery's own top row (page.js), so it's normally
 * already inside the initial viewport on load; `whileInView` only fires
 * off an IntersectionObserver crossing, which is not guaranteed to run for
 * an element that starts already-in-view, and confirmed live to leave the
 * card stuck at `opacity: 0` in that case — a real bug, not a cosmetic
 * choice. `animate` fires unconditionally on mount instead. The parent
 * `<aside>` (page.js) still owns the actual sticky behavior via
 * `lg:sticky lg:top-24`.
 */

// `saveShare={false}` on the phone copy of this card: the detail page already
// puts Partager/Enregistrer on the photo and a heart in MobileListingBar, so a
// third pair here was the same two actions again.
export default function EnquiryCard({ listing, visitSent, visitError, saveShare = true }) {
  const t = useT();
  const {
    id, title,
    agency_name: agencyName, agent_phone: agentPhone, agency_logo_url: agencyLogoUrl,
  } = listing;

  // `agency_name` resolves to the agent's real name now (lib/listings.js's
  // AGENCY_NAME_EXPR); `displayableAgencyName` refuses a phone number reaching
  // this slot from anywhere else. Both matter here — this panel's avatar used
  // to render the first character of whatever it was handed, so an agent whose
  // `username` was their phone number got a circle containing the digit "3".
  const agentName = displayableAgencyName(agencyName);

  // The verified agent directly, otherwise Lukka Place's central number — the
  // one rule every WhatsApp CTA shares (lib/leadRouting.js). `agentPhone` is
  // only non-null for a verified, routing-enabled agent (lib/listings.js), so
  // the tel: link below follows the same rule without restating it.
  const { href: whatsappHref, routingType } = resolveWhatsAppRouting(listing);
  const displayName = agentName || 'Lukka Place';
  const qualifier = agentName ? 'Agent partenaire' : 'Équipe Lukka Place';

  return (
    <div
      className="u-reveal u-lift flex flex-col gap-[1.125rem] rounded-card border border-line bg-surface p-6"
    >
      <div className="flex items-center gap-3.5">
        <AgentMonogram
          logoUrl={agencyLogoUrl}
          name={agentName}
          className="h-[3.25rem] w-[3.25rem]"
          textClassName="text-[1.125rem]"
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[0.875rem] font-bold text-ink">{displayName}</span>
          <span className="text-[0.8125rem] text-ink-45">{qualifier}</span>
          {agentName ? <AgentVerificationBadge level={listing.agent_verification_level} t={t} className="mt-1" /> : null}
        </div>
      </div>

      <div className="h-px bg-line" />

      <div className="flex flex-col gap-2.5">
        {visitSent && (
          <p className="rounded-lg bg-success-tint px-3.5 py-2.5 text-[0.8125rem] font-semibold text-success" role="status">
            {t('enquiry.sent')}
          </p>
        )}
        {visitError && (
          <p className="rounded-lg bg-danger-tint px-3.5 py-2.5 text-[0.8125rem] font-semibold text-danger" role="alert">
            {t(VISIT_ERROR_KEYS[visitError] || VISIT_ERROR_KEYS[1])}
          </p>
        )}

        {whatsappHref ? (
          /* The detail page's primary conversion action. It reported
             nothing until now, which is precisely the number
             lib/analytics.js's getWhatsAppConversionRate claims to
             measure: that rate counts whatsapp_clicks against views of
             `/listings/%`, and this anchor (plus MobileListingBar's) are
             the ONLY WhatsApp CTAs a listing page renders — WhatsAppCTA.js,
             the one component that did fire the beacon, is used on feed
             cards and explicitly not here. So the headline conversion
             figure was structurally 0 %. `onClick` rather than swapping to
             a button+window.open: this anchor is not nested inside a Link
             (unlike the card variants), so the native target="_blank"
             navigation is correct and the beacon just rides alongside it —
             `keepalive` is what gets it out of the tab. */
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackLeadClick(listing, routingType)}
            className="u-press u-btn-primary inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue px-5 py-3 text-sm font-semibold text-white"
          >
            <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
            {t('enquiry.contactWhatsApp')}
          </a>
        ) : (
          <span className="inline-flex w-full items-center justify-center rounded-lg border border-line px-5 py-3 text-sm font-semibold text-ink-25">
            {t('enquiry.contactUnavailable')}
          </span>
        )}

        <VisitRequestDialog propertyId={id} />

        {/* Real per-listing number only — renders nothing at all rather than
            a tel: link to a number we don't have. */}
        {agentPhone ? (
          <a
            href={`tel:${agentPhone}`}
            className="u-press u-btn-secondary inline-flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-ink"
          >
            <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
            {t('enquiry.callAgent')}
          </a>
        ) : null}

        {saveShare ? (
          <div className="flex items-center gap-2">
            <FavoriteButton
              listingId={id}
              variant="label"
              className="flex-1 justify-center"
              price={listing.price}
              commune={listing.commune}
            />
            <ShareButton title={title} variant="icon" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
