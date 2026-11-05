'use client';

import Link from 'next/link';
import { useLocale } from '@/lib/i18n/client';
import { localizeHref } from '@/lib/localePaths';

/**
 * next/link that keeps an English reader on the English site: a French path
 * with an English twin ("/location/appartements") becomes "/en/rent/apartments"
 * when the page is English (lib/localePaths.js). French readers, external
 * links and pages with no twin get the href untouched — which is why the
 * public chrome and cards can import this in place of next/link wholesale.
 *
 * Without it Google would crawl one English page and follow every link back
 * into French, and the English site would never be indexed as a whole.
 */
export default function LocaleLink({ href, ...props }) {
  const locale = useLocale();
  return <Link href={localizeHref(href, locale)} {...props} />;
}
