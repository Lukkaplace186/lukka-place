/**
 * The console sidebar's sections, as plain data (icon NAMES, not components)
 * so a Server Component can read the same list: /admin/settings offers each
 * one to hide (lib/siteSettingsRules.js `hiddenAdminTabs`). AdminSidebar.js
 * maps the names to lucide icons. Keys, not text — see components/navItems.js.
 *
 * Grouped by the job each area serves, so a console built for 30k agents
 * reads as five areas rather than one twenty-item column. A role only sees
 * the groups it has at least one section in.
 */
export const ADMIN_NAV_GROUPS = [
  {
    labelKey: 'admin.nav.groups.operations',
    items: [
      { href: '/admin/dashboard', labelKey: 'admin.nav.dashboard', icon: 'BarChart3' },
      { href: '/admin/listings', labelKey: 'admin.nav.listings', icon: 'FileText' },
      { href: '/admin/projets', labelKey: 'admin.nav.projects', icon: 'Building' },
      { href: '/admin/viewings', labelKey: 'admin.nav.viewings', icon: 'CalendarClock' },
      { href: '/admin/leads', labelKey: 'admin.nav.leads', icon: 'Mail' },
      { href: '/admin/conversations', labelKey: 'admin.nav.conversations', icon: 'MessageCircle' },
      { href: '/admin/matching', labelKey: 'admin.nav.matching', icon: 'Radar' },
    ],
  },
  {
    labelKey: 'admin.nav.groups.network',
    items: [
      { href: '/admin/agents', labelKey: 'admin.nav.agents', icon: 'User' },
      { href: '/admin/agencies', labelKey: 'admin.nav.agencies', icon: 'Building2' },
      { href: '/admin/verifications', labelKey: 'admin.nav.verifications', icon: 'ShieldCheck' },
      { href: '/admin/agent-reviews', labelKey: 'admin.nav.agentReviews', icon: 'Star' },
      { href: '/admin/sales', labelKey: 'admin.nav.sales', icon: 'HandCoins' },
      { href: '/admin/customers', labelKey: 'admin.nav.customers', icon: 'Users' },
    ],
  },
  {
    labelKey: 'admin.nav.groups.revenue',
    items: [
      { href: '/admin/subscriptions', labelKey: 'admin.nav.subscriptions', icon: 'Landmark' },
      { href: '/admin/billing', labelKey: 'admin.nav.billing', icon: 'CreditCard' },
    ],
  },
  {
    labelKey: 'admin.nav.groups.insights',
    items: [
      // Labelled "Lead Analytics"; the URL stays /admin/telemetry so existing
      // bookmarks and revalidatePath calls keep working.
      { href: '/admin/telemetry', labelKey: 'admin.nav.telemetry', icon: 'ChartNoAxesCombined' },
      { href: '/admin/benchmarks', labelKey: 'admin.nav.agentPerformance', icon: 'Gauge' },
      { href: '/admin/market-data', labelKey: 'admin.nav.marketData', icon: 'TrendingDown' },
      { href: '/admin/demande', labelKey: 'admin.nav.demand', icon: 'Target' },
    ],
  },
  {
    labelKey: 'admin.nav.groups.system',
    items: [
      { href: '/admin/health', labelKey: 'admin.nav.health', icon: 'HeartPulse' },
      { href: '/admin/team', labelKey: 'admin.nav.team', icon: 'UsersRound' },
      { href: '/admin/audit', labelKey: 'admin.nav.audit', icon: 'ScrollText' },
      { href: '/admin/cms', labelKey: 'admin.nav.cms', icon: 'Settings' },
      { href: '/admin/settings', labelKey: 'admin.nav.settings', icon: 'SlidersHorizontal' },
    ],
  },
];

export const ADMIN_NAV_TABS = ADMIN_NAV_GROUPS.flatMap((group) => group.items);
export const ADMIN_NAV_HREFS = ADMIN_NAV_TABS.map((item) => item.href);
