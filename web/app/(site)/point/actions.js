'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentAgentId } from '@/lib/agentSession';
import {
  answerListingStatus, getOwnListingPrice, resolveStatusRequest, stampAfterPriceChange,
} from '@/lib/statusCheck';
import { updateListingPrice } from '@/lib/agentListings';
import { PriceSyncError } from '@/lib/enginePrice';
import { getCdfRate } from '@/lib/currencyRate';
import { convertCdfToUsd } from '@/lib/format';

/**
 * The answers on "Faites le point" (lib/statusCheck.js). Who is answering
 * comes from the link's request (token) or, on the dashboard, the agent's
 * session — never from the client. Every write re-checks ownership in SQL.
 *
 * The page is French only (agents read the WhatsApp in French, like the
 * landlord report), so the messages here are French.
 */

const ERRORS = {
  session: 'Votre lien a expiré. Ouvrez « Faites le point » depuis votre espace agent.',
  not_found: 'Cette annonce n\'est pas à vous ou n\'existe plus.',
  stale: 'Cette annonce a déjà été mise à jour. Rechargez la page.',
  bad_date: 'La date n\'est pas valide (pas dans le futur, pas avant la publication).',
  bad_price: 'Indiquez un prix valide.',
  unavailable: 'Ce service n\'est pas encore disponible. Réessayez plus tard.',
  price_sync: 'Le prix n\'a pas pu être enregistré pour le moment. Réessayez dans quelques minutes.',
  quota: 'Votre forfait est complet : retirez une autre annonce ou passez à un forfait supérieur pour réactiver celle-ci.',
  bad_answer: 'Cette réponse ne s\'applique pas à cette annonce.',
  generic: 'Une erreur est survenue. Réessayez.',
};

async function whoIsAnswering(token) {
  if (token) {
    const request = await resolveStatusRequest(token);
    if (!request || request.expired) return null;
    return { agentId: request.agentId, request };
  }
  const agentId = await getCurrentAgentId();
  return agentId ? { agentId, request: null } : null;
}

function revalidateSurfaces(propertyId) {
  revalidatePath(`/listings/${propertyId}`);
  revalidatePath('/compte/agent');
  revalidatePath('/compte/agent/biens');
  revalidatePath('/compte/agent/point');
}

/**
 * @param {string|null} token  the link's token, or null on the dashboard
 * @param {number} propertyId
 * @param {{answer: string, soldPrice?: string|number|null, soldAt?: string, viaPlatform?: boolean|null}} input
 */
export async function answerStatusAction(token, propertyId, input) {
  const who = await whoIsAnswering(token);
  if (!who) return { ok: false, error: ERRORS.session };
  try {
    const result = await answerListingStatus({
      agentId: who.agentId,
      request: who.request,
      propertyId,
      answer: String(input?.answer || ''),
      closing: input?.answer === 'closed'
        ? { soldPrice: input.soldPrice ?? null, soldAt: input.soldAt, viaPlatform: typeof input.viaPlatform === 'boolean' ? input.viaPlatform : null }
        : null,
    });
    if (!result.ok) return { ok: false, error: ERRORS[result.reason] || ERRORS.generic };
    revalidateSurfaces(propertyId);
    return { ok: true, state: result.state, freedSlot: result.freedSlot || null };
  } catch (err) {
    console.error(`[status-check] answer on #${propertyId} failed: ${err.message}`);
    return { ok: false, error: ERRORS.generic };
  }
}

/**
 * "Modifier le prix": a new asking price in the listing's own currency,
 * written through the same engine path as the Mes biens price cell
 * (lib/enginePrice.js), then the listing is stamped as confirmed.
 */
export async function changeStatusPriceAction(token, propertyId, input) {
  const who = await whoIsAnswering(token);
  if (!who) return { ok: false, error: ERRORS.session };

  const typed = Number(String(input?.price ?? '').replace(/[\s ]/g, '').replace(',', '.'));
  const currency = String(input?.currency || 'USD').toUpperCase() === 'CDF' ? 'CDF' : 'USD';
  if (!Number.isFinite(typed) || typed <= 0) return { ok: false, error: ERRORS.bad_price };

  try {
    const previous = await getOwnListingPrice(who.agentId, propertyId);
    if (previous === undefined) return { ok: false, error: ERRORS.stale };

    let price = typed;
    if (currency === 'CDF') {
      const rate = await getCdfRate();
      price = convertCdfToUsd(typed, rate.cdfPerUsd);
      if (!Number.isFinite(price) || price <= 0) return { ok: false, error: ERRORS.price_sync };
    }
    const owned = await updateListingPrice(who.agentId, propertyId, { price, priceOriginal: typed, currency });
    if (!owned) return { ok: false, error: ERRORS.not_found };
    await stampAfterPriceChange({ agentId: who.agentId, request: who.request, propertyId, previousPrice: previous, newPrice: price });
    revalidateSurfaces(propertyId);
    return { ok: true, price };
  } catch (err) {
    if (err instanceof PriceSyncError) return { ok: false, error: ERRORS.price_sync };
    console.error(`[status-check] price on #${propertyId} failed: ${err.message}`);
    return { ok: false, error: ERRORS.generic };
  }
}
