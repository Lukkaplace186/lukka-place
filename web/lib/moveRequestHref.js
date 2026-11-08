import 'server-only';
import { listMoveProjects } from './moveProjects';

/**
 * Where "Trouver pour moi" / "Nouvelle demande" lead in the account
 * (2026-11-08, owner request): one way to ask the agencies, the move project.
 * There used to be a second form (/compte/client/demandes) that asked again
 * what the project already knew.
 *
 * The newest project still searching (not found; a paused one still counts,
 * since sending a request is a reason to resume) opens on its request
 * section; no project → a new one (the cards), whose page then offers the
 * request. A project read that fails falls back to "new project".
 *
 * @returns {Promise<string>}
 */
export async function moveRequestHref(customerId) {
  const projects = await listMoveProjects(customerId).catch(() => []);
  const open = projects.filter((project) => project.status !== 'found');
  const latest = open[open.length - 1];
  if (latest && latest.id > 0) return `/compte/client/projet/${latest.id}#move-request`;
  if (latest) return '/compte/client/projet';
  return '/compte/client/projet/nouveau';
}
