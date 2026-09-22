import { redirect } from 'next/navigation';

/**
 * The private client book is hidden from agents (2026-09-22, product
 * decision: keep the dashboard to Biens / Demandes / Abonnement / Réglages).
 * Buyer enquiries live in Demandes, so an old link or bookmark lands there.
 * The data layer (lib/agentClients.js, the agent_clients tables) is kept, so
 * bringing the tab back is a nav entry and this page, not a migration.
 */
export default function AgentClientsPage() {
  redirect('/compte/agent/demandes');
}
