/**
 * The /guides articles — evergreen answers to what people in Kinshasa (and in
 * the diaspora) actually search before renting or buying. French only: the
 * searches are French, and a machine-translated English copy would compete
 * with the original for the same page.
 *
 * Content rules, same as everywhere else on the site: no invented figure. A
 * worked example uses round numbers and says it is an example; market prices
 * live on the /location and /vente pages, computed from real listings, and the
 * guides link there instead of quoting a number that would go stale.
 *
 * Blocks: { h2 } | { p } | { ul: [...] } | { ol: [...] }. Plain strings — no
 * HTML — so nothing here can inject markup.
 */

export const GUIDES = [
  {
    slug: 'garantie-3-1-1-kinshasa',
    title: 'Garantie « 3 + 1 + 1 » : ce que vous payez vraiment en entrant dans un logement à Kinshasa',
    description:
      'Garantie, avance, commission : les trois montants cachés derrière « 3 + 1 + 1 », un exemple chiffré et ce qu’il faut exiger avant de payer.',
    published: '2026-09-23',
    updated: '2026-09-23',
    cta: { href: '/location', label: 'Voir les logements à louer à Kinshasa' },
    body: [
      { p: 'Sur une annonce de location à Kinshasa, la ligne « Garantie : 3 + 1 + 1 » décide souvent plus du budget que le loyer lui-même. Elle ne désigne pas un seul montant mais trois, qui n’ont pas la même nature.' },
      { h2: 'Les trois montants, dans l’ordre' },
      { ol: [
        'La garantie (ou caution) : plusieurs mois de loyer versés au bailleur, en principe restitués en fin de bail, déduction faite des loyers impayés ou des dégâts constatés. Dans « 3 + 1 + 1 », c’est le 3.',
        'L’avance : du loyer payé à l’avance, qui couvre vos premiers mois d’occupation. Elle n’est pas restituée : vous l’« habitez ». C’est le premier 1.',
        'La commission : la rémunération de l’agent ou du commissionnaire qui vous a trouvé le logement. Elle n’est pas restituée. C’est le second 1.',
      ] },
      { h2: 'Un exemple chiffré' },
      { p: 'Pour un loyer de 500 $ par mois, avec « 3 + 1 + 1 » :' },
      { ul: [
        'Garantie : 3 × 500 $ = 1 500 $ (récupérable en fin de bail)',
        'Avance : 1 × 500 $ = 500 $ (votre premier mois)',
        'Commission : 1 × 500 $ = 500 $ (pour l’agent)',
        'Total à l’entrée : 2 500 $, soit cinq mois de loyer — dont 1 500 $ que vous devez pouvoir récupérer.',
      ] },
      { p: 'Retenez surtout ceci : « 3 + 1 + 1 » n’est pas « 5 mois de garantie ». Additionner les trois donne ce que vous déboursez le jour de l’entrée, pas ce que le bailleur vous doit à la sortie.' },
      { h2: 'Les variantes à savoir lire' },
      { ul: [
        '« 4 + 1 » : en général quatre mois de garantie et un mois d’avance. La commission n’est pas mentionnée — demandez-la avant la visite.',
        '« Garantie : 3 mois » seule : l’annonce ne dit rien de l’avance ni de la commission. Cela ne veut pas dire qu’il n’y en a pas.',
        '« Sans commission » : la commission est de zéro, ce qui arrive quand vous traitez directement avec le propriétaire.',
      ] },
      { h2: 'Ce qu’il faut exiger avant de payer' },
      { ul: [
        'Un contrat de bail écrit, signé par le bailleur, qui indique le montant de la garantie et les conditions de sa restitution.',
        'Un reçu pour chaque montant versé, qui distingue garantie, avance et commission.',
        'Un état des lieux d’entrée, avec des photos datées : c’est lui qui protège votre garantie à la sortie.',
        'Ne versez rien avant d’avoir visité le logement et vérifié qui vous le loue (voir notre guide pour louer sans se faire arnaquer).',
      ] },
      { h2: 'Sur Lukka Place' },
      { p: 'Quand l’agent les indique, nos annonces affichent la garantie, l’avance et la commission séparément, avec le total à prévoir à l’entrée. Le filtre « Max Garantie » de la recherche permet d’écarter les logements qui demandent plus que votre budget d’entrée.' },
    ],
  },
  {
    slug: 'parcelle-maison-appartement-kinshasa',
    title: 'Parcelle, maison, appartement, terrain : bien lire une annonce immobilière à Kinshasa',
    description:
      'Parcelle, « type locataire », portes, villa, terrain nu, référence : le vocabulaire des annonces immobilières de Kinshasa expliqué simplement.',
    published: '2026-09-23',
    updated: '2026-09-23',
    cta: { href: '/location', label: 'Voir les annonces à Kinshasa' },
    body: [
      { p: 'Les annonces immobilières de Kinshasa ont leur propre vocabulaire. Deux biens décrits avec les mêmes mots peuvent être très différents — et un mot mal compris peut vous faire visiter pour rien.' },
      { h2: 'Appartement' },
      { p: 'Un logement situé dans un immeuble à plusieurs niveaux : on parle d’étage, de niveau, d’immeuble. Un logement dans une cour, au rez-de-chaussée d’une parcelle, n’est pas un appartement même si l’annonce le dit parfois.' },
      { h2: 'Parcelle' },
      { p: 'Une parcelle est un terrain délimité — souvent clôturé — avec ce qui est construit dessus. C’est la forme de propriété la plus courante à Kinshasa. On en distingue trois grands cas :' },
      { ul: [
        'Maison « type locataire » : plusieurs logements indépendants dans une même parcelle, chacun loué séparément, avec une cour partagée.',
        'Villa : une maison seule sur sa parcelle, en général clôturée.',
        'Terrain nu : une parcelle sans construction, vendue pour bâtir.',
      ] },
      { h2: '« X portes »' },
      { p: 'Le nombre de portes est le nombre de logements indépendants dans une parcelle « type locataire ». « Parcelle de 6 portes » signifie six logements à louer ou déjà loués — une information clé pour un investisseur, qui peut estimer le revenu locatif.' },
      { h2: 'Dimensions : « 20 × 30 »' },
      { p: 'Deux nombres séparés par un « x » donnent les dimensions du terrain en mètres. 20 × 30 correspond à 600 m². Pour un terrain nu, c’est souvent l’information la plus importante de l’annonce, avec la situation.' },
      { h2: 'La « référence »' },
      { p: 'Beaucoup de rues de Kinshasa n’ont pas de nom ou de numéro utilisé au quotidien. Les adresses se donnent donc par une référence : un repère connu de tous — un arrêt, une église, une école, un marché. « Réf. arrêt Kintambo magasin » situe le bien mieux qu’un nom de rue.' },
      { h2: 'Les mots du confort' },
      { ul: [
        'SNEL : le fournisseur d’électricité. « Ligne dédiée » ou « cabine » signale une alimentation plus stable.',
        'REGIDESO : le fournisseur d’eau. « Forage » désigne un puits propre à la parcelle, « citerne » une réserve d’eau.',
        'Groupe électrogène, panneaux solaires, inverseur : les solutions de secours en cas de coupure.',
        'Gardiennage, clôture, portail : la sécurité de la parcelle.',
        'Route asphaltée : un accès praticable en saison des pluies, un vrai critère à Kinshasa.',
      ] },
      { h2: 'Sur Lukka Place' },
      { p: 'Nos annonces classent chaque bien selon ces catégories — appartement, parcelle et ses sous-types — et affichent le nombre de portes quand il est donné. La recherche permet de filtrer par groupe électrogène, forage, ligne dédiée, route asphaltée ou gardiennage.' },
    ],
  },
  {
    slug: 'louer-sans-arnaque-kinshasa',
    title: 'Louer à Kinshasa sans se faire arnaquer : 8 réflexes',
    description:
      'Visite avant paiement, vérification du bailleur, reçus, contrat, factures SNEL et REGIDESO : les réflexes qui protègent votre garantie.',
    published: '2026-09-23',
    updated: '2026-09-23',
    cta: { href: '/location', label: 'Voir les logements à louer' },
    body: [
      { p: 'La plupart des mauvaises surprises à la location suivent le même schéma : de l’argent versé trop tôt, à la mauvaise personne, sans trace écrite. Ces huit réflexes ferment la porte à l’essentiel d’entre elles.' },
      { ol: [
        'Visitez avant de payer quoi que ce soit. Aucune garantie, aucune avance, aucune « réservation » avant d’avoir vu le logement de vos yeux.',
        'Vérifiez qui vous loue. Demandez à rencontrer le propriétaire, ou un document écrit qui prouve que l’agent est mandaté par lui. Une personne qui a les clés n’est pas forcément celle qui a le droit de louer.',
        'Méfiez-vous d’un prix trop bas. Comparez avec les prix des annonces de la même commune : un loyer très en dessous du marché sert souvent d’appât.',
        'N’emménagez pas sans contrat signé par le bailleur. Le même logement peut être promis à plusieurs personnes qui ont chacune versé une garantie ; le contrat et les clés remis par le bailleur tranchent.',
        'Exigez un reçu pour chaque paiement, qui distingue garantie, avance et commission.',
        'Sachez ce que vous payez avant la visite. Si des frais de visite sont demandés, faites-vous préciser le montant à l’avance et demandez un reçu.',
        'Demandez les dernières factures SNEL et REGIDESO. Des arriérés au nom du logement peuvent vous retomber dessus, et les factures montrent si l’eau et l’électricité arrivent vraiment.',
        'Faites un état des lieux avec photos datées à l’entrée. C’est ce document qui vous permettra de récupérer votre garantie à la sortie.',
      ] },
      { h2: 'Ce que fait Lukka Place' },
      { ul: [
        'Chaque annonce est relue par notre équipe avant d’être publiée.',
        'Le numéro d’un agent n’est affiché que lorsque cet agent a prouvé qu’il détient ce numéro ; sinon, c’est le numéro de Lukka Place.',
        'Le badge « Annonce vérifiée » n’apparaît que sur les biens que notre équipe a elle-même confirmés.',
        'Le bouton « Demander une visite » transmet votre demande à l’agent et à notre équipe, qui suit la réponse.',
      ] },
      { p: 'Ces garanties réduisent le risque, elles ne le suppriment pas : les huit réflexes restent valables pour toute location, sur Lukka Place comme ailleurs.' },
    ],
  },
  {
    slug: 'acheter-parcelle-kinshasa-diaspora',
    title: 'Acheter une parcelle à Kinshasa depuis l’étranger : les étapes et les vérifications',
    description:
      'Certificat d’enregistrement, vérifications à la Conservation des titres immobiliers, procuration, paiement par étapes : acheter à Kinshasa depuis la diaspora.',
    published: '2026-09-23',
    updated: '2026-09-23',
    cta: { href: '/vente', label: 'Voir les biens à vendre à Kinshasa' },
    body: [
      { p: 'Acheter une parcelle à Kinshasa quand on vit à Bruxelles, Paris, Londres ou Montréal est un projet courant — et celui où une erreur coûte le plus cher, parce qu’on ne peut pas tout vérifier soi-même sur place. Ce guide présente les étapes essentielles. Il ne remplace pas l’avis d’un avocat ou d’un notaire en RDC, que nous vous recommandons fortement de consulter.' },
      { h2: '1. Le document qui compte : le certificat d’enregistrement' },
      { p: 'En RDC, le titre qui établit les droits sur une parcelle est le certificat d’enregistrement, délivré par le Conservateur des titres immobiliers. D’autres documents circulent — fiche parcellaire, attestation, contrat de location — mais ce sont des étapes vers le titre, pas le titre lui-même. Demandez dès le départ une copie du certificat d’enregistrement.' },
      { h2: '2. Vérifier le titre à la Conservation des titres immobiliers' },
      { p: 'Une copie ne suffit pas : faites vérifier, auprès de la Conservation des titres immobiliers dont dépend la parcelle, que :' },
      { ul: [
        'le certificat existe bien et correspond à la parcelle vendue (numéro, superficie, situation) ;',
        'le vendeur est bien le titulaire inscrit, ou dispose d’un mandat valable ;',
        'la parcelle n’est grevée d’aucune hypothèque ni d’un litige en cours.',
      ] },
      { h2: '3. Vérifier le terrain lui-même' },
      { ul: [
        'Que les limites sur le terrain correspondent au plan cadastral — un mesurage par un géomètre évite les mauvaises surprises.',
        'Que personne d’autre n’occupe ou ne revendique la parcelle : parlez aux voisins et au chef de quartier.',
        'Que le site n’est pas exposé à l’érosion ou aux inondations, et qu’il est accessible toute l’année.',
      ] },
      { h2: '4. Se faire représenter' },
      { p: 'Depuis l’étranger, désignez une personne de confiance par une procuration en bonne et due forme, et faites-vous accompagner par un avocat ou un notaire. La personne qui vous représente ne devrait pas être celle qui vous propose le bien.' },
      { h2: '5. Payer par étapes, jamais sans acte' },
      { ul: [
        'Ne payez jamais la totalité avant la signature de l’acte de vente.',
        'Liez chaque paiement à une étape vérifiée : vérification du titre, signature de l’acte, mutation.',
        'Privilégiez des paiements traçables (virement) et exigez un reçu signé pour chacun.',
      ] },
      { h2: '6. Faire établir le titre à votre nom' },
      { p: 'L’achat n’est complet que lorsque la mutation est enregistrée et qu’un certificat d’enregistrement est établi à votre nom. Renseignez-vous à l’avance sur les frais et les délais de cette étape auprès de votre avocat ou notaire.' },
      { h2: 'Sur Lukka Place' },
      { p: 'Les annonces de vente sont relues par notre équipe avant publication, et le badge « Annonce vérifiée » signale les biens que nous avons nous-mêmes confirmés. Ces contrôles ne remplacent pas les vérifications juridiques ci-dessus, qui restent indispensables pour tout achat.' },
    ],
  },
];

export function getGuide(slug) {
  return GUIDES.find((g) => g.slug === slug) || null;
}
