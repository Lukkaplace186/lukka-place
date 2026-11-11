import { getLocale } from '@/lib/i18n/server';

/**
 * What Lukka Place records and why, in plain words (growth plan item 7).
 * Factual about this codebase only — every sentence describes something the
 * code does. Not legal advice: have it reviewed before it is relied on as the
 * site's formal privacy policy. French and English inline, like /guides.
 */

const CONTENT = {
  fr: {
    title: 'Confidentialité et mesure d’audience',
    updated: 'Mis à jour le 11 novembre 2026.',
    sections: [
      ['Ce que nous enregistrons', [
        'Votre numéro de téléphone et votre nom quand vous créez un compte, pour vous connecter et vous joindre sur WhatsApp. Le numéro d’un compte agent est confirmé par WhatsApp.',
        'Pour un agent : le nom de l’agence, la photo ou le logo, les communes couvertes, les annonces et leurs photos, et les documents envoyés pour la vérification (gardés dans un espace privé, consultés seulement par notre équipe).',
        'Vos favoris, vos alertes et vos demandes de visite, pour vous les montrer et prévenir l’agent concerné.',
        'Les pages consultées, de façon anonyme : un identifiant aléatoire gardé dans votre navigateur, qui ne contient rien sur vous, nous permet de compter des personnes plutôt que des pages.',
        'D’où vient une visite (le site ou la publicité qui vous a amené, le code d’un partenaire), pour savoir quelles campagnes fonctionnent et rémunérer les agents qui nous présentent des clients.',
      ]],
      ['Mesure publicitaire (Meta, TikTok)', [
        'Quand nos outils de mesure sont activés, les pixels de Meta (Facebook, Instagram) et de TikTok enregistrent certaines actions : page vue, annonce consultée, recherche, contact d’un agent, création de compte, demande de visite. Notre serveur envoie aussi ces actions à Meta et à TikTok, avec votre numéro de téléphone chiffré (haché) lorsque vous en avez donné un, pour savoir quelles publicités ont fonctionné.',
        'En Europe et au Royaume-Uni, rien n’est chargé ni envoyé tant que vous n’avez pas accepté. Vous pouvez refuser : le site fonctionne de la même façon. Pour changer d’avis, effacez les cookies de lukkaplace.com ; la question vous sera posée à nouveau.',
      ]],
      ['Application Lukka Place (Android et iPhone)', [
        'L’application affiche le site lukkaplace.com : elle enregistre les mêmes données que le site, et les outils de mesure décrits ci-dessus s’y appliquent de la même façon.',
        'Si vous autorisez les notifications, le service de notifications de Google (Firebase Cloud Messaging, qui passe par le service d’Apple sur iPhone) donne à votre téléphone un identifiant. Nous le gardons avec votre compte pour vous envoyer vos alertes : visites, demandes, messages, annonces qui correspondent à vos recherches. Une copie de chaque alerte reste dans la page Notifications de votre compte.',
        'Vous choisissez les types d’alertes dans les réglages de votre compte, ou vous les coupez dans les réglages du téléphone. En vous déconnectant, ce téléphone ne reçoit plus vos alertes. Une alerte urgente restée non lue peut aussi vous être envoyée sur WhatsApp.',
        'L’application ne demande ni votre position, ni vos contacts. Elle n’accède qu’aux photos que vous choisissez d’envoyer.',
      ]],
      ['Supprimer votre compte', [
        'Dans l’application ou sur le site : Espace client › Mon profil › Supprimer mon compte ; pour un agent, Paramètres › Supprimer mon compte. Vous pouvez aussi nous le demander sur WhatsApp au +243 846 962 654.',
        'Sont supprimés : votre compte, vos favoris, vos alertes et recherches sauvegardées, vos téléphones enregistrés pour les notifications et votre page Notifications. Les annonces d’un agent sont retirées du site et ne portent plus son nom.',
        'Les demandes et visites déjà transmises à une agence restent dans son historique et le nôtre.',
      ], 'suppression'],
      ['Ce que nous ne faisons pas', [
        'Nous ne vendons pas votre numéro. Un agent ne reçoit votre numéro que lorsque vous le contactez ou demandez une visite.',
      ]],
      ['Nous contacter', [
        'Pour consulter ou supprimer vos données : WhatsApp +243 846 962 654, ou la page Contact (lukkaplace.com/contact).',
      ]],
    ],
  },
  en: {
    title: 'Privacy and Audience Measurement',
    updated: 'Updated 11 November 2026.',
    sections: [
      ['What we record', [
        'Your phone number and name when you create an account, to sign you in and reach you on WhatsApp. An agent account’s number is confirmed on WhatsApp.',
        'For an agent: the agency name, photo or logo, communes covered, listings and their photos, and the documents sent for verification (kept in private storage, opened only by our team).',
        'Your favourites, alerts and visit requests, to show them to you and tell the agent concerned.',
        'The pages you open, anonymously: a random id kept in your browser, holding nothing about you, lets us count people rather than pages.',
        'Where a visit came from (the site or the ad that brought you, a partner’s code), to know which campaigns work and to pay the agents who introduce customers to us.',
      ]],
      ['Ad measurement (Meta, TikTok)', [
        'When our measurement tools are switched on, the Meta (Facebook, Instagram) and TikTok pixels record some actions: page viewed, listing viewed, search, contacting an agent, creating an account, requesting a visit. Our server also sends these actions to Meta and TikTok, with your phone number encrypted (hashed) when you gave one, to learn which ads worked.',
        'In Europe and the UK, nothing loads or is sent until you accept. You can refuse: the site works the same. To change your mind, clear lukkaplace.com’s cookies and you will be asked again.',
      ]],
      ['The Lukka Place App (Android and iPhone)', [
        'The app shows the lukkaplace.com website: it records the same data as the site, and the measurement tools described above apply to it in the same way.',
        'If you allow notifications, Google’s notification service (Firebase Cloud Messaging, which goes through Apple’s service on iPhone) gives your phone an identifier. We keep it with your account to send you your alerts: visits, requests, messages, listings that match your searches. A copy of each alert stays on your account’s Notifications page.',
        'You choose which alerts you get in your account settings, or turn them off in the phone’s settings. When you log out, this phone stops receiving your alerts. An urgent alert left unread may also be sent to you on WhatsApp.',
        'The app does not ask for your location or your contacts. It only reaches the photos you choose to send.',
      ]],
      ['Deleting Your Account', [
        'In the app or on the site: Customer Area › My profile › Delete my account; for an agent, Settings › Delete My Account. You can also ask us on WhatsApp at +243 846 962 654.',
        'What is deleted: your account, your favourites, your alerts and saved searches, the phones registered for notifications and your Notifications page. An agent’s listings are taken off the site and no longer carry their name.',
        'Requests and visits already passed to an agency stay in its history and ours.',
      ], 'suppression'],
      ['What we do not do', [
        'We do not sell your number. An agent only receives your number when you contact them or request a visit.',
      ]],
      ['Contact us', [
        'To see or delete your data: WhatsApp +243 846 962 654, or the Contact page (lukkaplace.com/contact).',
      ]],
    ],
  },
};

export async function generateMetadata() {
  const locale = await getLocale();
  return { title: `${CONTENT[locale === 'en' ? 'en' : 'fr'].title} — Lukka Place`, alternates: { canonical: '/confidentialite' } };
}

export default async function PrivacyPage() {
  const locale = await getLocale();
  const copy = CONTENT[locale === 'en' ? 'en' : 'fr'];
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="u-title-hero text-ink">{copy.title}</h1>
      <p className="u-micro mt-2 text-ink-45">{copy.updated}</p>
      {copy.sections.map(([heading, paragraphs, anchor]) => (
        <section key={heading} id={anchor} className="mt-8 scroll-mt-24">
          <h2 className="u-title-section text-ink">{heading}</h2>
          {paragraphs.map((text) => (
            <p key={text.slice(0, 40)} className="u-body mt-3 text-ink-70">{text}</p>
          ))}
        </section>
      ))}
    </article>
  );
}
