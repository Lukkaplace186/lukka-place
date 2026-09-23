import { SITE_URL } from '@/lib/constants';

/**
 * /robots.txt — it returned 404, so crawlers had no sitemap to follow.
 * Private surfaces (accounts, the console, APIs, referral redirects) stay
 * out of the index; everything a visitor can browse signed-out is open.
 */
export default function robots() {
  const base = SITE_URL.replace(/\/+$/, '');
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/compte', '/api/', '/r/', '/messages'] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
