/**
 * The /guides articles kept in code — shown in Guides & Actualités under the
 * "Guide" category whatever the `publicBlog` switch says (lib/blogRules.js
 * `articleFromGuide`). A post published with the same slug from /admin/blog
 * replaces its guide.
 *
 * One guide since 2026-11-11 (owner decision): the 3 + 1 + 1 article with
 * its live calculator. The three earlier guides (parcelle vs appartement,
 * louer sans arnaque, acheter une parcelle depuis la diaspora) were removed
 * on the owner's request; their URLs redirect to /guides (next.config.mjs).
 *
 * French first, with an optional English version (`en`: title, description,
 * body, all or nothing — the same rule as a post), written by hand, never
 * machine-translated. An English reader gets it; everyone else the French.
 *
 * Content rules, same as everywhere else on the site: no invented figure.
 * Every number is either a worked example the reader can change, or a
 * sourced fact named in the text. The law is Loi n° 15/025 du 31 décembre
 * 2015 relative aux baux à loyer non professionnels.
 *
 * Blocks: the lib/blogRules.js block shapes — { h2 } | { p } | { ul } |
 * { ol } | { stats } | { table } | { callout } | { calculator }. Text is a
 * plain string or inline segments ({ text, href }); no HTML anywhere.
 */

const LAW_URL = 'https://legalrdc.com/wp-content/uploads/2020/04/Loi_baux_non_professionnels.pdf';
const ACP_FEB_2026 = 'https://acp.cd/business/hausse-des-prix-de-maisons-en-location-observee-dans-des-communes-de-kinshasa-2/';
const ACP_APR_2026 = 'https://acp.cd/economie/flambee-de-prix-des-loyers-necessite-de-publication-dune-mercuriale/';
const GOV_DEC_2024 = 'https://7sur7.cd/2024/12/19/rdc-le-gouvernement-rappelle-que-la-garantie-locative-est-de-3-mois-pour-le-bail';

export const GUIDES = [
  {
    slug: 'garantie-3-1-1-kinshasa',
    title: 'La garantie « 3 + 1 + 1 » : ce que demandent les bailleurs, ce que la loi permet',
    description:
      'Garantie, avance, commission : calculez ce que vous payez à l’entrée, comparez au plafond de la loi de 2015 et apprenez à négocier.',
    published: '2026-11-11',
    updated: '2026-11-11',
    cta: { href: '/location', label: 'Voir les logements à louer' },
    body: [
      { p: 'Avant même la première nuit, un locataire à Kinshasa verse souvent cinq mois de loyer, parfois treize. La ligne « Garantie : 3 + 1 + 1 » d’une annonce décide souvent plus du budget que le loyer lui-même. Entrez votre loyer dans le calculateur ci-dessous pour voir le montant exact, poste par poste, et le comparer au plafond fixé par la loi de 2015 sur les baux.' },
      { stats: {
        items: [
          { value: '3 + 1 + 1', label: 'la formule la plus courante sur les annonces' },
          { value: '8 à 12 mois', label: 'de garantie demandés dans les communes du centre' },
          { value: '3 mois', label: 'de garantie au plus selon la loi (art. 18)' },
        ],
        source: 'ACP, 26 février 2026 ; loi n° 15/025 du 31 décembre 2015',
      } },
      { h2: 'Trois montants différents' },
      { ol: [
        'La garantie (ou caution) : plusieurs mois de loyer versés au bailleur, restitués en fin de bail, déduction faite des sommes que vous lui devez. Dans « 3 + 1 + 1 », c’est le 3.',
        'L’avance : du loyer payé à l’entrée. Le premier mois est le loyer du mois où vous emménagez ; tout mois en plus est du loyer payé d’avance. Elle n’est pas restituée. C’est le premier 1.',
        'La commission : la rémunération de l’agent ou du commissionnaire qui vous a trouvé le logement. Elle n’est pas restituée. C’est le second 1.',
      ] },
      { p: '« 3 + 1 + 1 » n’est donc pas « 5 mois de garantie ». Additionner les trois donne ce que vous déboursez le jour de l’entrée, pas ce que le bailleur vous rendra à la sortie : seule la garantie vous revient.' },
      { calculator: { kind: 'garantie' } },
      { h2: 'Ce que les bailleurs demandent vraiment' },
      { p: 'Sur un loyer de 670 $, « 3 + 1 + 1 » fait 3 350 $ à verser avant d’entrer, dont 2 010 $ que vous devez récupérer à la sortie.' },
      { p: [
        { text: 'Dans les communes du centre, la formule est souvent plus lourde. Une ' },
        { text: 'enquête de l’Agence congolaise de presse publiée en février 2026', href: ACP_FEB_2026 },
        { text: ' relève des garanties de 8 à 12 mois à la Gombe, Lemba, Bandalungwa, Limete, Kintambo et Ngaliema. ' },
        { text: 'À Ngaliema', href: ACP_APR_2026 },
        { text: ', un responsable de l’habitat a cité « cinq, six, sept, huit, neuf, parfois dix mois », parfois exigés en devises. Avec 10 mois de garantie, 2 mois d’avance et la commission, un loyer de 1 450 $ demande 18 850 $ le premier jour. Essayez la formule « 10+2+1 » dans le calculateur.' },
      ] },
      { h2: 'Ce que dit la loi de 2015' },
      { p: [
        { text: 'Les locations d’habitation sont régies par la ' },
        { text: 'loi n° 15/025 du 31 décembre 2015 relative aux baux à loyer non professionnels', href: LAW_URL },
        { text: '. Elle est courte et précise sur l’argent versé à l’entrée.' },
      ] },
      { table: {
        title: 'Loi n° 15/025 : l’argent versé à l’entrée',
        head: ['Article', 'Ce que dit la loi'],
        rows: [
          ['Art. 18', 'Garantie de 3 mois de loyer au plus pour un bail résidentiel (6 mois pour un bail socioculturel). Elle ne peut pas être augmentée pendant le bail, ne produit pas d’intérêts et ne peut pas servir à payer le loyer.'],
          ['Art. 22', '« Il est interdit au bailleur d’exiger le paiement anticipatif du loyer. »'],
          ['Art. 10', 'La commission de l’agence est d’un mois de loyer, payée par celui qui a fait appel à elle. Si le bailleur et le locataire passent par la même agence, elle est partagée à parts égales.'],
          ['Art. 19', 'La garantie est rendue à la fin du bail, déduction faite des sommes dues au bailleur. La loi ne fixe pas de délai.'],
          ['Art. 3 et 5', 'Le bail est un acte écrit, enregistré dans les 30 jours. Il indique le montant de la garantie locative.'],
          ['Art. 17', 'Un état des lieux contradictoire est dressé au début et à la fin du bail.'],
        ],
        source: 'Loi n° 15/025 du 31 décembre 2015, texte publié par legalrdc.com',
      } },
      { p: [
        { text: 'La loi prévoit aussi des sanctions. Le bailleur qui perçoit une garantie supérieure à trois mois encourt un à trois mois de servitude pénale et une amende de trois à six mois de loyer, ou l’une de ces peines (art. 39). Un bail contraire aux articles 18 ou 22 expose les parties à un à trois mois de servitude pénale et à une amende d’un mois de loyer (art. 43). Le gouvernement a ' },
        { text: 'rappelé le plafond de trois mois en décembre 2024', href: GOV_DEC_2024 },
        { text: '.' },
      ] },
      { callout: {
        tone: 'info',
        title: 'Ce que la loi change en pratique',
        blocks: [
          { p: 'La loi est peu appliquée et le marché va plus vite que les tribunaux. La connaître ne garantit pas d’obtenir 3 mois, mais elle vous donne un argument écrit et vous dit ce que vous pouvez exiger sur papier.' },
        ],
      } },
      { p: 'Une dernière précision : l’article 21 prévoit que le loyer se paie dans la monnaie ayant cours légal, le franc congolais, alors que presque tous les loyers de Kinshasa sont fixés en dollars. Le bouton USD / CDF du calculateur montre ce que votre entrée représente en francs.' },
      { h2: 'Comment négocier' },
      { ol: [
        'Arrivez avec le chiffre légal. Calculez avant la visite ce que coûte votre entrée selon la loi (3 mois de garantie, le premier loyer, la commission) et proposez ce montant calmement, en citant l’article 18.',
        'Offrez quelque chose en échange. Un bail plus long (deux ou trois ans), un paiement par virement, une attestation de l’employeur ou un garant rassurent un bailleur plus que deux mois de garantie supplémentaires.',
        'Refusez les mois d’avance en trop. Le premier loyer se paie à l’entrée. Au-delà, l’article 22 interdit d’exiger du loyer d’avance. Si le bailleur insiste, faites au moins écrire que cette avance couvre les mois suivants.',
        'Ne payez pas plus d’un mois de commission. La commission de l’agent correspond en général à un mois de loyer, et c’est aussi ce que fixe la loi (art. 10). Tout montant au-delà ne doit pas être accepté. La loi précise qu’elle est payée par celui qui a fait appel à l’agence. Si le bailleur et vous passez par la même agence, elle est partagée à parts égales. Sans agent, il n’y a pas de commission à payer.',
        'Faites tout écrire. Un bail signé par le bailleur avec le montant de la garantie, un reçu séparé pour chaque somme (garantie, loyer, commission) et un état des lieux avec photos datées.',
        'Ne payez rien avant d’avoir visité le logement et vérifié que la personne en face est bien le bailleur ou son mandataire.',
      ] },
      { h2: 'Les variantes à savoir lire' },
      { ul: [
        '« 4 + 1 » : en général quatre mois de garantie et un mois d’avance. La commission n’est pas mentionnée : demandez-la avant la visite.',
        '« Garantie : 3 mois » seule : l’annonce ne dit rien de l’avance ni de la commission. Cela ne veut pas dire qu’il n’y en a pas.',
        '« Sans commission » : la commission est de zéro, ce qui arrive quand vous traitez directement avec le propriétaire.',
      ] },
      { h2: 'Sur Lukka Place' },
      { p: 'Quand l’agent les indique, nos annonces affichent la garantie, l’avance et la commission séparément, avec le total à prévoir à l’entrée. Le filtre « Max Garantie » de la recherche écarte les logements qui demandent plus que ce que vous pouvez avancer.' },
      { p: 'Ce guide explique la loi ; il ne remplace pas l’avis d’un juriste pour un litige.' },
    ],
    en: {
      title: 'The “3 + 1 + 1” Deposit: What Landlords Ask and What the Law Allows',
      description:
        'Deposit, advance, commission: work out what you pay on entry, compare it with the 2015 lease law’s ceiling, and learn how to negotiate.',
      cta: { href: '/location', label: 'See homes for rent' },
      body: [
        { p: 'Before the first night in a new home, a Kinshasa tenant often pays five months of rent up front, sometimes thirteen. The “Garantie: 3 + 1 + 1” line on a listing often weighs more on the budget than the rent itself. Enter your rent in the calculator below to see the exact amount, item by item, next to the ceiling set by the 2015 lease law.' },
        { stats: {
          items: [
            { value: '3 + 1 + 1', label: 'the most common formula on listings' },
            { value: '8 to 12 months', label: 'of deposit asked in the central communes' },
            { value: '3 months', label: 'of deposit at most under the law (art. 18)' },
          ],
          source: 'ACP, 26 February 2026; Law no. 15/025 of 31 December 2015',
        } },
        { h2: 'Three Different Payments' },
        { ol: [
          'The deposit (garantie or caution): several months of rent paid to the landlord and returned when the lease ends, minus anything you owe them. In “3 + 1 + 1”, that is the 3.',
          'The advance (avance): rent paid on entry. The first month is the rent for the month you move in; any month beyond it is rent paid in advance. It does not come back. That is the first 1.',
          'The commission: the fee of the agent or commissionnaire who found you the home. It does not come back. That is the second 1.',
        ] },
        { p: '“3 + 1 + 1” is therefore not “5 months of deposit”. Adding the three gives what you pay on the day you move in, not what the landlord will return when you leave: only the deposit comes back to you.' },
        { calculator: { kind: 'garantie' } },
        { h2: 'What Landlords Actually Ask' },
        { p: 'On a $670 rent, “3 + 1 + 1” comes to $3,350 to pay before moving in, of which $2,010 should come back to you when you leave.' },
        { p: [
          { text: 'In the central communes the formula is often heavier. A ' },
          { text: 'February 2026 survey by the Congolese Press Agency (ACP)', href: ACP_FEB_2026 },
          { text: ' found deposits of 8 to 12 months in Gombe, Lemba, Bandalungwa, Limete, Kintambo and Ngaliema. ' },
          { text: 'In Ngaliema', href: ACP_APR_2026 },
          { text: ', a housing official listed “five, six, seven, eight, nine, sometimes ten months”, sometimes demanded in foreign currency. With a 10-month deposit, 2 months of advance and the commission, a $1,450 rent needs $18,850 on day one. Try the “10+2+1” formula in the calculator.' },
        ] },
        { h2: 'What the 2015 Law Says' },
        { p: [
          { text: 'Residential lettings are governed by ' },
          { text: 'Law no. 15/025 of 31 December 2015 on non-professional leases', href: LAW_URL },
          { text: '. It is short and precise about the money paid on entry.' },
        ] },
        { table: {
          title: 'Law no. 15/025: money paid on entry',
          head: ['Article', 'What the law says'],
          rows: [
            ['Art. 18', 'A deposit of 3 months’ rent at most for a residential lease (6 months for a socio-cultural one). It cannot be raised during the lease, earns no interest and cannot be used to pay rent.'],
            ['Art. 22', '“The landlord is prohibited from demanding advance payment of rent.”'],
            ['Art. 10', 'The agency fee is one month’s rent, paid by whoever hired the agency. If the landlord and the tenant use the same agency, it is split equally.'],
            ['Art. 19', 'The deposit is returned at the end of the lease, minus any sums owed to the landlord. The law sets no deadline.'],
            ['Art. 3 and 5', 'The lease is a written deed, registered within 30 days. It states the amount of the deposit.'],
            ['Art. 17', 'A joint inventory of condition (état des lieux) is drawn up at the start and at the end of the lease.'],
          ],
          source: 'Law no. 15/025 of 31 December 2015, text published by legalrdc.com',
        } },
        { p: [
          { text: 'The law also sets penalties. A landlord who collects a deposit above three months faces one to three months of penal servitude and a fine of three to six months’ rent, or either penalty (art. 39). A lease that breaches articles 18 or 22 exposes the parties to one to three months of penal servitude and a fine of one month’s rent (art. 43). The government ' },
          { text: 'restated the three-month cap in December 2024', href: GOV_DEC_2024 },
          { text: '.' },
        ] },
        { callout: {
          tone: 'info',
          title: 'What the Law Changes in Practice',
          blocks: [
            { p: 'The law is rarely enforced and the market moves faster than the courts. Knowing it will not guarantee you a 3-month deposit, but it gives you a written argument and tells you what you can insist on having on paper.' },
          ],
        } },
        { p: 'One more detail: article 21 says rent is paid in legal tender, the Congolese franc, while almost every Kinshasa rent is set in dollars. The USD / CDF switch in the calculator shows what your move-in cost means in francs.' },
        { h2: 'How to Negotiate' },
        { ol: [
          'Arrive with the legal figure. Before the viewing, work out your move-in cost under the law (3 months of deposit, the first month’s rent, the commission) and propose that amount calmly, citing article 18.',
          'Offer something in return. A longer lease (two or three years), payment by bank transfer, an employer’s letter or a guarantor reassure a landlord more than two extra months of deposit.',
          'Push back on extra advance months. The first month’s rent is paid on entry. Beyond that, article 22 forbids demanding rent in advance. If the landlord insists, at least have it written that the advance covers the following months.',
          'Pay no more than one month of commission. The agent’s commission is usually one month’s rent, which is also what the law sets (art. 10). Do not accept anything above that. The law says it is paid by whoever hired the agency. If you and the landlord use the same agency, it is split equally. With no agent involved, there is no commission to pay.',
          'Get everything in writing. A lease signed by the landlord stating the deposit, a separate receipt for each sum (deposit, rent, commission) and an inventory of condition with dated photos.',
          'Pay nothing before you have visited the home and checked that the person in front of you is the landlord or their authorised agent.',
        ] },
        { h2: 'Variants to Know How to Read' },
        { ul: [
          '“4 + 1”: usually four months of deposit and one month of advance. The commission is not mentioned: ask about it before the viewing.',
          '“Garantie: 3 mois” alone: the listing says nothing about the advance or the commission. That does not mean there are none.',
          '“Sans commission”: the commission is zero, which happens when you deal directly with the owner.',
        ] },
        { h2: 'On Lukka Place' },
        { p: 'When the agent provides them, our listings show the deposit, advance and commission separately, with the total to budget on entry. The “Max Garantie” search filter hides homes that ask for more than you can put down.' },
        { p: 'This guide explains the law; it does not replace a lawyer’s advice in a dispute.' },
      ],
    },
  },
];

export function getGuide(slug) {
  return GUIDES.find((g) => g.slug === slug) || null;
}

/** Guides removed on 2026-11-11; next.config.mjs sends their URLs to /guides. */
export const REMOVED_GUIDE_SLUGS = Object.freeze([
  'parcelle-maison-appartement-kinshasa',
  'louer-sans-arnaque-kinshasa',
  'acheter-parcelle-kinshasa-diaspora',
]);
