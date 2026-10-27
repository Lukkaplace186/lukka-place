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
    updated: 'Mis à jour le 27 octobre 2026.',
    sections: [
      ['Ce que nous enregistrons', [
        'Votre numéro de téléphone et votre nom quand vous créez un compte, pour vous connecter et vous joindre sur WhatsApp. Le numéro est confirmé par WhatsApp.',
        'Vos favoris, vos alertes et vos demandes de visite, pour vous les montrer et prévenir l’agent concerné.',
        'Les pages consultées, de façon anonyme : un identifiant aléatoire gardé dans votre navigateur, qui ne contient rien sur vous, nous permet de compter des personnes plutôt que des pages.',
        'D’où vient une visite (le site ou la publicité qui vous a amené, le code d’un partenaire), pour savoir quelles campagnes fonctionnent et rémunérer les agents qui nous présentent des clients.',
      ]],
      ['Mesure publicitaire (Meta, TikTok)', [
        'Quand nos outils de mesure sont activés, les pixels de Meta (Facebook, Instagram) et de TikTok enregistrent certaines actions : page vue, annonce consultée, recherche, contact d’un agent, création de compte, demande de visite. Notre serveur envoie aussi ces actions à Meta et à TikTok, avec votre numéro de téléphone chiffré (haché) lorsque vous en avez donné un, pour savoir quelles publicités ont fonctionné.',
        'En Europe et au Royaume-Uni, rien n’est chargé ni envoyé tant que vous n’avez pas accepté. Vous pouvez refuser : le site fonctionne de la même façon. Pour changer d’avis, effacez les cookies de lukkaplace.com ; la question vous sera posée à nouveau.',
      ]],
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
    updated: 'Updated 27 October 2026.',
    sections: [
      ['What we record', [
        'Your phone number and name when you create an account, to sign you in and reach you on WhatsApp. The number is confirmed on WhatsApp.',
        'Your favourites, alerts and visit requests, to show them to you and tell the agent concerned.',
        'The pages you open, anonymously: a random id kept in your browser, holding nothing about you, lets us count people rather than pages.',
        'Where a visit came from (the site or the ad that brought you, a partner’s code), to know which campaigns work and to pay the agents who introduce customers to us.',
      ]],
      ['Ad measurement (Meta, TikTok)', [
        'When our measurement tools are switched on, the Meta (Facebook, Instagram) and TikTok pixels record some actions: page viewed, listing viewed, search, contacting an agent, creating an account, requesting a visit. Our server also sends these actions to Meta and TikTok, with your phone number encrypted (hashed) when you gave one, to learn which ads worked.',
        'In Europe and the UK, nothing loads or is sent until you accept. You can refuse: the site works the same. To change your mind, clear lukkaplace.com’s cookies and you will be asked again.',
      ]],
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
      {copy.sections.map(([heading, paragraphs]) => (
        <section key={heading} className="mt-8">
          <h2 className="u-title-section text-ink">{heading}</h2>
          {paragraphs.map((text) => (
            <p key={text.slice(0, 40)} className="u-body mt-3 text-ink-70">{text}</p>
          ))}
        </section>
      ))}
    </article>
  );
}
