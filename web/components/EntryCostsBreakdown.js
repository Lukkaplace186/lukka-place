import { entryCostBreakdown } from '@/lib/listingView';
import { formatPriceParts } from '@/lib/format';

/**
 * Who receives each part of the money due at signing.
 *
 * The KeyFacts grid states the deal in the agent's own notation — "3 + 1 + 1
 * mois". That is complete information for an agent and nearly none for a
 * tenant: five months of rent is a large, frightening number, and nothing on
 * the page said that three of those months are rent they will live through,
 * one is a deposit that comes back at the end, and one is the agency's fee
 * that does not.
 *
 * So this is not a restatement of that cell — it is the half a customer
 * actually needs before signing.
 *
 * Renders nothing unless the listing genuinely states more than a deposit
 * (entryCostBreakdown returns null otherwise). Inventing the "+ 1 + 1" that
 * usually follows a stated guarantee would be inventing money someone would
 * budget for.
 */

const RECIPIENT_LABEL = {
  bailleur: 'Bailleur',
  agent: 'Agent / Agence',
};

const LINE_COPY = {
  deposit: {
    title: 'Garantie (caution)',
    note: 'Retenue par le bailleur, remboursable en fin de bail',
  },
  advance: {
    title: 'Avance (loyer prépayé)',
    note: 'Versée au bailleur, couvre vos premiers mois de loyer',
  },
  commission: {
    title: "Commission d'agence",
    note: "Frais de courtage versés à l'agent, non remboursables",
  },
};

export default function EntryCostsBreakdown({ listing }) {
  const breakdown = entryCostBreakdown(listing);
  if (!breakdown) return null;

  const { lines, totalMonths, totalAmount, hasAmounts } = breakdown;
  // formatPriceParts appends "/ mois" for ANY rental, whatever period is
  // passed — correct for a recurring rent, wrong for every number here. These
  // are one-off sums due once at signing, and "1 500 $ / mois" reads as a
  // monthly charge four times the actual rent. Passing a non-rent purpose is
  // what suppresses the suffix; `.amount` is the bare figure.
  const money = (value) => formatPriceParts(value, 'oneOff').amount;

  return (
    <section className="rounded-lg border border-line p-4 sm:p-5">
      <h2 className="u-eyebrow text-ink">Conditions financières</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Détail de ce qui est dû à la signature, et à qui.
      </p>

      <ul className="mt-4 divide-y divide-line">
        {lines.map((line) => (
          <li key={line.key} className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">{LINE_COPY[line.key].title}</span>
                {/* The tag is the whole point of the row: it answers "who
                    banks this?" without the reader parsing the sentence. */}
                <span
                  className={
                    line.recipient === 'agent'
                      ? 'rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900'
                      : 'rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700'
                  }
                >
                  {RECIPIENT_LABEL[line.recipient]}
                </span>
                {line.refundable ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                    Remboursable
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 text-xs text-ink-muted">{LINE_COPY[line.key].note}</p>
            </div>

            <div className="shrink-0 text-right">
              <div className="u-tabular text-sm font-semibold text-ink">
                {line.months} mois
              </div>
              {/* Amounts only when there is a real MONTHLY rent to multiply.
                  A sale has no entry costs, and a sale price times five months
                  would be a number nobody owes. */}
              {hasAmounts ? (
                <div className="u-tabular text-xs text-ink-muted">{money(line.amount)}</div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-line pt-3">
        <span className="text-sm font-semibold text-ink">Total à verser à la signature</span>
        <span className="u-tabular text-base font-semibold text-ink">
          {hasAmounts ? money(totalAmount) : `${totalMonths} mois`}
        </span>
      </div>

      {hasAmounts ? (
        <p className="mt-2 text-xs text-ink-muted">
          Soit {totalMonths} mois de loyer au total, dont{' '}
          {lines.filter((l) => l.refundable).reduce((sum, l) => sum + l.months, 0)} remboursable(s)
          en fin de bail.
        </p>
      ) : null}
    </section>
  );
}
