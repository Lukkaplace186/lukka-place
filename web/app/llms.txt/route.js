import { SITE_URL } from '@/lib/constants';
import { getPriceGuides } from '@/lib/browseFeatures';
import { llmsTxt } from '@/lib/llmsTxt';

/**
 * /llms.txt — the site map for AI assistants (lib/llmsTxt.js). Rebuilt at
 * most hourly, like the sitemap. getPriceGuides never throws: without it the
 * file still lists every other page.
 */
export const revalidate = 3600;

export async function GET() {
  const priceGuides = await getPriceGuides();
  return new Response(llmsTxt({ base: SITE_URL, priceGuides }), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
