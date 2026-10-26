/**
 * SQL for a sales rep's scope (lib/salesScope.js), kept free of imports so
 * every reader can use it without an import cycle.
 *
 * Is the agent `agentExpr` one of rep `repParam`'s agents? An ACTIVE
 * assignment to the rep, or the rep's permanent launch attribution — the same
 * set the Sales team page counts as "brought in".
 */
export function repAgentCondition(agentExpr, repParam) {
  return `(EXISTS (SELECT 1 FROM sales_account_assignments rsa
                    WHERE rsa.agent_id = ${agentExpr} AND rsa.rep_id = ${repParam} AND rsa.ended_at IS NULL)
        OR EXISTS (SELECT 1 FROM sales_agent_attributions rat
                    WHERE rat.agent_id = ${agentExpr} AND rat.rep_id = ${repParam}))`;
}
