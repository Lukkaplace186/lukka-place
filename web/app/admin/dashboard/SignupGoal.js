import { getT } from '@/lib/i18n/server';
import { can } from '@/lib/adminRoles';
import { getSignupProgress } from '@/lib/signupFunnel';
import { SignupGoalBanner } from '../croissance/SignupSections';

/**
 * The 1,000-account goal at the top of the console home (2026-11-11), for
 * the roles that can open /admin/croissance (`partners.view`), where it links.
 * A failed query shows nothing rather than an error on the home page.
 */
export default async function SignupGoal({ role }) {
  if (!can(role, 'partners.view')) return null;
  let progress = null;
  try {
    progress = await getSignupProgress();
  } catch (err) {
    console.error(`[admin-dashboard] signup goal: ${err.message}`);
    return null;
  }
  const t = await getT();
  return <SignupGoalBanner t={t} progress={progress} />;
}
