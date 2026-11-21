/**
 * /llms.txt (2026-11-21, marketing plan): a short map of the site for AI
 * assistants. ChatGPT was the source whose visitors contacted agents most
 * (57 WhatsApp taps from 435 visitors in ten days, before the November ad),
 * so the pages an assistant can cite — the price guide, the search pages,
 * the guides — are named here with what they hold. Only pages that exist;
 * the price-guide entries come from getPriceGuides (enough data behind each).
 *
 * Pure: the route (app/llms.txt/route.js) fetches and calls this.
 */
export function llmsTxt({ base, priceGuides = [] }) {
  const url = String(base || '').replace(/\/+$/, '');
  const lines = [
    '# Lukka Place',
    '',
    "> Plateforme immobilière de la République démocratique du Congo (Kinshasa d'abord, et Lubumbashi). Des agents et agences publient des logements et terrains à louer ou à vendre ; chaque annonce est relue par l'équipe avant publication, avec le prix et le coût d'entrée (garantie, avance, commission) détaillés. Le client écrit directement à l'agent sur WhatsApp. Lukka Place est la plateforme, pas une agence.",
    '',
    '## Chercher un logement',
    `- [Toutes les annonces en RDC](${url}/listings?ville=toutes): logements, terrains et locaux à louer ou à vendre, avec photos, prix et quartier`,
    `- [Location à Kinshasa](${url}/location): annonces à louer, par commune et par type`,
    `- [Vente à Kinshasa](${url}/vente): maisons, appartements et parcelles à vendre`,
    `- [Location à Lubumbashi](${url}/location/lubumbashi)`,
    `- [Agences et agents](${url}/agents): les agents qui publient sur Lukka Place, par commune`,
    `- [Trouver pour moi](${url}/trouver-pour-moi): décrire sa recherche sans compte ; les agences partenaires répondent sur WhatsApp`,
    '',
    '## Prix des loyers',
    `- [Combien coûte un logement à Kinshasa ?](${url}/combien-coute): loyers médians par commune et nombre de chambres, calculés à partir des annonces publiées et d'annonces observées sur d'autres sources, avec la méthode et la taille de l'échantillon`,
  ];
  for (const guide of priceGuides.slice(0, 60)) {
    if (!guide?.slug || !guide?.commune) continue;
    const rooms = Number(guide.beds) > 0 ? `${guide.beds} chambre${Number(guide.beds) > 1 ? 's' : ''}` : 'logement';
    lines.push(`- [${rooms} à ${guide.commune}](${url}/combien-coute/${guide.slug})`);
  }
  lines.push(
    '',
    '## Guides',
    `- [Guides et actualités](${url}/guides): louer, acheter et vérifier un bien en RDC`,
    '',
    '## À propos',
    `- [Qui sommes-nous](${url}/a-propos)`,
    `- [Contact](${url}/contact)`,
    '',
  );
  return lines.join('\n');
}
