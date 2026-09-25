import Link from 'next/link';
import PaymentPlanEditor from '@/components/projects/wizard/PaymentPlanEditor';
import { saveProjectStepAction } from '../../../actions';
import { SECONDARY, Section, StepButtons } from './ui';

/** Step 5 — the payment plan (optional). Presets for the plans developers use most. */
export default function StepPaiement({ project, t }) {
  const plan = Array.isArray(project.payment_plan) ? project.payment_plan : [];
  const presets = [
    {
      name: '30 / 40 / 30',
      rows: [
        { label: t('agent.projects.wizard.paiement.preset.booking'), percent: 30 },
        { label: t('agent.projects.wizard.paiement.preset.structure'), percent: 40 },
        { label: t('agent.projects.wizard.paiement.preset.keys'), percent: 30 },
      ],
    },
    {
      name: '50 / 50',
      rows: [
        { label: t('agent.projects.wizard.paiement.preset.signature'), percent: 50 },
        { label: t('agent.projects.wizard.paiement.preset.keys'), percent: 50 },
      ],
    },
    {
      name: '20 / 20 / 20 / 20 / 20',
      rows: [
        { label: t('agent.projects.wizard.paiement.preset.booking'), percent: 20 },
        { label: t('agent.projects.wizard.paiement.preset.foundations'), percent: 20 },
        { label: t('agent.projects.wizard.paiement.preset.structure'), percent: 20 },
        { label: t('agent.projects.wizard.paiement.preset.finishing'), percent: 20 },
        { label: t('agent.projects.wizard.paiement.preset.keys'), percent: 20 },
      ],
    },
  ];

  return (
    <form action={saveProjectStepAction.bind(null, project.id, 'paiement')} className="flex flex-col gap-4">
      <Section title={t('agent.projects.wizard.paiement.title')} intro={t('agent.projects.wizard.paiement.intro')}>
        <PaymentPlanEditor
          initial={plan}
          presets={presets}
          labels={{
            label: t('admin.projects.form.planLabel'),
            percent: t('admin.projects.form.planPercent'),
            labelExample: t('admin.projects.form.planLabelExample'),
            remove: t('admin.projects.delete'),
            addRow: t('agent.projects.wizard.paiement.addRow'),
            totalOk: t('agent.projects.wizard.paiement.totalOk'),
            totalMissing: t('agent.projects.wizard.paiement.totalMissing'),
          }}
        />
      </Section>
      <StepButtons
        t={t}
        back={<Link href={`/compte/agent/projets/${project.id}/modifier?step=apercu`} className={SECONDARY}>{t('agent.projects.wizard.skip')}</Link>}
      />
    </form>
  );
}
