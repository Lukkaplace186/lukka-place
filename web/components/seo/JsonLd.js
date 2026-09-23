import { jsonLdString } from '@/lib/seoPages';

/**
 * schema.org structured data for search engines. Server-rendered into the
 * HTML so a crawler reads it without running any JavaScript.
 */
export default function JsonLd({ data }) {
  if (!data) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}
