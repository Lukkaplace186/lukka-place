'use client';

import RouteError from '@/components/RouteError';

/** Agent dashboard error boundary — the sidebar and bottom nav stay; see components/RouteError.js. */
export default function AgentDashboardError({ error, retry }) {
  return (
    <RouteError
      error={error}
      retry={retry}
      scope="agent"
      homeHref="/compte/agent"
      homeLabelKey="common.errorBoundary.dashboard"
    />
  );
}
