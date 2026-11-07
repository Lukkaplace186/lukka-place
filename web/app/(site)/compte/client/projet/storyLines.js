import { budgetRangeText, moveStoryParts, projectDisplayName } from '@/lib/moveProjectRules';

/**
 * A project as the customer reads it, in their language (`t`): its name, the
 * reasons as chips, "Aujourd'hui", "Vous cherchez", "Quand". Shared by the
 * project list and the project page so the two never word it differently.
 * Each line is null when nothing was said.
 */
export function storyLines(project, t, index = 0) {
  const story = moveStoryParts(project);
  const reasonLabels = [
    ...story.reasons.map((r) => t(`account.move.steps.reasons.options.${r}`)),
    ...(story.reasonOther ? [story.reasonOther] : []),
  ];
  const fromLine = story.from
    ? [t(`account.move.steps.current.options.${story.from.type}`), story.from.commune].filter(Boolean).join(', ')
    : null;
  const tx = project.transactionType === 'vente'
    ? t('account.move.steps.transaction.options.vente')
    : project.leaseTerm === 'short'
      ? t('account.move.steps.transaction.options.courte')
      : project.transactionType ? t('account.move.steps.transaction.options.location') : null;
  const bedrooms = project.bedroomsMin
    ? project.bedroomsMin === 1
      ? t('account.move.steps.bedrooms.one')
      : t('account.move.steps.bedrooms.many', { count: project.bedroomsMin >= 5 ? '5+' : project.bedroomsMin })
    : null;
  const toLine = [
    tx,
    bedrooms,
    story.to?.communes?.length ? story.to.communes.join(', ') : null,
    budgetRangeText(project.budgetMin, project.budgetMax, {
      between: (min, max) => t('account.move.steps.budget.between', { min, max }),
      from: (amount) => t('account.move.steps.budget.from', { amount }),
      upTo: (amount) => t('account.move.steps.budget.upTo', { amount }),
    }),
  ].filter(Boolean).join(' · ') || null;
  const whenLine = story.when ? t(`account.move.steps.timeline.options.${story.when}`) : null;
  const name = projectDisplayName(project, {
    reasonLabel: (r) => t(`account.move.steps.reasons.options.${r}`),
    fallback: t('account.move.list.untitled', { n: index + 1 }),
  });
  return { name, reasonLabels, fromLine, toLine, whenLine };
}
