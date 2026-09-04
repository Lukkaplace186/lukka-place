/**
 * Derives the analytics dimensions from request headers rather than from the
 * request body.
 *
 * /api/track is a public, unauthenticated endpoint, so anything the client
 * sends is a claim, not a fact. Device and source are read from headers the
 * browser sets itself — which is still forgeable, but no longer forgeable by
 * simply posting a different JSON field, and it means an honest client cannot
 * get it wrong. That matters more than usual here: these numbers are the
 * foundation of the data product, so they should be as hard to skew as a
 * beacon reasonably allows.
 */

/**
 * web / mobile / tablet, or null when the User-Agent says nothing useful.
 *
 * Order matters: every tablet UA also contains "Mobile"-adjacent tokens, and
 * Android tablets are identified by the *absence* of "Mobile" rather than the
 * presence of anything. Bots are bucketed separately so crawler traffic never
 * inflates the human numbers — the whole point of the split is to answer "are
 * our users on phones?", and Googlebot is not a user.
 */
export function deviceFromUserAgent(userAgent) {
  if (!userAgent || typeof userAgent !== 'string') return null;
  const ua = userAgent.toLowerCase();

  if (/bot|crawler|spider|crawling|slurp|bingpreview|headlesschrome|lighthouse/.test(ua)) return 'bot';

  // Unambiguous phone markers first. The Android-tablet heuristic below keys
  // on the ABSENCE of "Mobile", and Opera Mini's UA is
  // "Opera/9.80 (Android; Opera Mini/36...)" — Android, no "Mobile" — so
  // checking tablets first misfiled it as a tablet. That is not an edge case
  // here: Opera Mini is widely used on low-bandwidth connections in DRC,
  // which is exactly the audience this split exists to measure.
  if (/iphone|ipod|opera mini|opera mobi|blackberry|iemobile|windows phone/.test(ua)) return 'mobile';

  if (/ipad|tablet|playbook|silk|kindle/.test(ua) || (/android/.test(ua) && !/mobile/.test(ua))) return 'tablet';
  if (/mobi|android/.test(ua)) return 'mobile';
  return 'desktop';
}

/**
 * The traffic source, as a bare host.
 *
 * `utm_source` wins when present, because that is an explicit campaign label
 * and is what a marketing spend is measured against. Otherwise the referrer's
 * HOST — never its full URL, which can carry the visitor's previous search
 * terms and query parameters. A visit with neither is 'direct', which is a
 * real answer rather than a missing one.
 *
 * A referrer from our own domain is not a source: it is internal navigation,
 * and counting it would drown every real source in self-referrals.
 */
export function sourceFromRequest({ referer, utmSource, selfHost }) {
  const campaign = typeof utmSource === 'string' ? utmSource.trim().slice(0, 64) : '';
  if (campaign) return campaign.toLowerCase();

  if (!referer || typeof referer !== 'string') return 'direct';
  try {
    const host = new URL(referer).hostname.replace(/^www\./, '').toLowerCase();
    if (!host) return 'direct';
    if (selfHost && host === String(selfHost).replace(/^www\./, '').toLowerCase()) return 'direct';
    return host.slice(0, 128);
  } catch {
    // A malformed Referer header is not worth failing a beacon over.
    return 'direct';
  }
}

/** Both dimensions for one request. `headers` is a Fetch API Headers object. */
export function analyticsDimensions(headers, { utmSource } = {}) {
  const host = headers.get('host') || '';
  return {
    device: deviceFromUserAgent(headers.get('user-agent')),
    source: sourceFromRequest({ referer: headers.get('referer'), utmSource, selfHost: host }),
  };
}
