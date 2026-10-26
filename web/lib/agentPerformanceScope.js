/**
 * The agent leaderboard narrowed to some agents (a sales rep's, see
 * lib/salesScope.js), with the totals recomputed from those rows exactly as
 * the engine's services/agentPerformance.js computes them for everyone —
 * the platform-wide totals would describe agents the rep cannot see.
 * Pure, so it is testable without the engine.
 */
const round1 = (n) => Math.round(Number(n) * 10) / 10;

export function scopeAgentPerformance(data, agentIds) {
  if (!data) return data;
  const allowed = new Set((agentIds || []).map(Number));
  const agents = (data.agents || []).filter((agent) => allowed.has(Number(agent.agentId)));
  const sum = (key) => agents.reduce((total, agent) => total + (Number(agent[key]) || 0), 0);
  const leads = sum('leads');
  const responded = sum('responded');
  const viewings = sum('viewings');
  const latencyWeighted = agents.reduce((total, agent) => total + (agent.avgLatencySeconds ?? 0) * (Number(agent.responded) || 0), 0);
  return {
    ...data,
    agents,
    totals: {
      agents: agents.length,
      directRoutingAgents: agents.filter((agent) => agent.routesDirect).length,
      leads,
      responded,
      viewings,
      avgLatencySeconds: responded > 0 ? Math.round(latencyWeighted / responded) : null,
      leadToViewingPct: leads > 0 ? round1((viewings / leads) * 100) : null,
    },
  };
}
