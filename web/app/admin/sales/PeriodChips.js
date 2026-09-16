import Link from 'next/link';
import { buildHref } from '@/lib/adminPagination';
import { SALES_PERIODS } from '@/lib/salesRules';
import { getT } from '@/lib/i18n/server';

/** The period filter shared by the sales overview and a rep's page. "This month" is the default and leaves the URL. */
export default async function PeriodChips({ pathname, params, period }) {
  const t = await getT();
  return (
    <div className="flex flex-wrap gap-2">
      {SALES_PERIODS.map((value) => (
        <Link
          key={value}
          href={buildHref(pathname, params, { period: value === 'month' ? '' : value })}
          scroll={false}
          aria-current={value === period ? 'page' : undefined}
          className={`u-micro-strong rounded-full border px-3 py-1 ${value === period ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line bg-surface text-ink-70 hover:border-blue'}`}
        >
          {t(`admin.sales.period.${value}`)}
        </Link>
      ))}
    </div>
  );
}
