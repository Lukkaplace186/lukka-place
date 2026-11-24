// The privacy policy shown at /confidentialite, the "Privacy Policy URL" given
// to Google Play and the App Store (2026-11-14, store submission).
//
// Every sentence describes something this codebase does: check the code
// before adding one, and change the text when the code changes. The company
// details are the owner's own (lib/legal/termsFr.js, article 1). Written in
// plain words, not by a lawyer: have it reviewed before relying on it in a
// dispute. French and English carry the same sections in the same order
// (tests/unit/store-legal.test.js).
//
// A section is { id, title, paragraphs }. `id` is the page anchor; the store
// listings link to `#suppression`, so that one must not be renamed.

import { SUPPORT_EMAIL, SUPPORT_WHATSAPP_DISPLAY } from './contact.js';

export const PRIVACY_UPDATED = '2026-11-14';

const fr = {
  title: 'Politique de confidentialité',
  updated: 'Mise à jour le 14 novembre 2026.',
  intro: 'Cette page dit quelles données Lukka Place enregistre sur le site lukkaplace.com et dans l’application Lukka Place (Android et iPhone), pourquoi, avec qui elles sont partagées, et comment les consulter ou les faire supprimer.',
  contents: 'Sommaire',
  sections: [
    { id: 'responsable', title: 'Qui est responsable de vos données', paragraphs: [
      'LukkaPlace TM SARL, immatriculée au Registre du Commerce et du Crédit Mobilier sous le numéro CD/KNG/RCCM/26-B-01668, dont le siège est au n°34C, Immeuble SOMIP, appartement V2, 3e étage, avenue du Commerce, commune de la Gombe, Kinshasa, République Démocratique du Congo.',
      `Pour toute question sur vos données : ${SUPPORT_EMAIL}, ou WhatsApp ${SUPPORT_WHATSAPP_DISPLAY}.`,
    ] },
    { id: 'donnees', title: 'Les données que vous nous donnez', paragraphs: [
      'Votre numéro de téléphone et votre nom quand vous créez un compte, pour vous connecter et vous joindre sur WhatsApp. Une adresse e-mail seulement si vous en indiquez une. Le numéro d’un compte agent est confirmé par WhatsApp.',
      'Votre mot de passe, gardé sous une forme chiffrée (hachée) que personne chez nous ne peut lire.',
      'Pour un agent : le nom de l’agence, la photo ou le logo, les communes couvertes, les annonces et leurs photos, et les documents envoyés pour la vérification (gardés dans un espace privé, consultés seulement par notre équipe).',
      'Vos favoris, vos recherches enregistrées, vos alertes, vos demandes « Trouver pour moi » et vos demandes de visite, pour vous les montrer et prévenir l’agent concerné.',
      'Les messages que vous échangez avec un agent dans la messagerie de Lukka Place, et ceux que vous envoyez à nos numéros WhatsApp. Les messages reçus sur WhatsApp sont lus par un service d’intelligence artificielle (OpenAI) pour comprendre une annonce ou une demande et y répondre.',
    ] },
    { id: 'appareil', title: 'Les informations sur votre appareil', paragraphs: [
      'Avec chaque page consultée : le type d’appareil (téléphone, tablette ou ordinateur), déduit de votre navigateur, et le site ou la publicité qui vous a amené. Un identifiant aléatoire gardé dans votre navigateur, qui ne contient rien sur vous, nous permet de compter des personnes plutôt que des pages.',
      'Votre adresse IP sert à limiter les abus (trop de demandes en peu de temps). Pour un compte agent, l’adresse IP et le navigateur de chaque connexion sont gardés dans un journal de sécurité.',
      'Des mesures de vitesse (temps de chargement des pages, type de connexion), sans lien avec votre compte.',
      'Dans l’application, si vous autorisez les notifications : l’identifiant de notification de votre téléphone, décrit plus bas.',
      'Des cookies et réglages gardés dans votre navigateur, nécessaires au fonctionnement : votre connexion, votre langue, votre devise, vos favoris, et votre choix sur la mesure publicitaire.',
    ] },
    { id: 'position', title: 'Votre position', paragraphs: [
      'Le site ne connaît votre position que si vous touchez le bouton « Autour de moi » et que vous l’autorisez. Elle sert, dans votre navigateur, à centrer la carte ou à trouver les communes proches ; nous ne l’enregistrons pas.',
      'L’application Android et iPhone ne demande pas votre position.',
    ] },
    { id: 'usages', title: 'Pourquoi nous utilisons ces données', paragraphs: [
      'Pour vous connecter à votre compte, vous mettre en relation avec les agents et les agences, vous envoyer les alertes que vous avez demandées, protéger les comptes et repérer la fraude, et savoir quelles pages et quelles publicités fonctionnent.',
      'Les prix des annonces servent aussi à calculer les loyers médians du guide des prix. Ce sont des chiffres sur les biens, pas sur vous.',
      'Vous acceptez ces usages en utilisant Lukka Place (article 11 des Conditions d’utilisation). Vous pouvez retirer votre accord à tout moment en supprimant votre compte ou en nous écrivant.',
    ] },
    { id: 'partage', title: 'Avec qui elles sont partagées', paragraphs: [
      'Les agents et agences : un agent reçoit votre nom et votre numéro quand vous le contactez, quand vous lui demandez une visite, ou quand il prend en charge votre demande « Trouver pour moi ». Pas avant.',
      'WhatsApp (Meta) et notre prestataire WhatsApp Business, pour les messages que nous échangeons avec vous sur WhatsApp.',
      'Google : Firebase pour les notifications de l’application, et Google Maps pour afficher les cartes.',
      'OpenAI, pour la lecture des messages WhatsApp décrite plus haut.',
      'Meta et TikTok, pour la mesure publicitaire décrite ci-dessous.',
      'Nos hébergeurs (serveurs et base de données), situés hors de la République Démocratique du Congo.',
      'Nous ne vendons pas vos données, et nous ne les donnons à personne d’autre.',
    ] },
    { id: 'publicite', title: 'Mesure publicitaire (Meta, TikTok)', paragraphs: [
      'Quand nos outils de mesure sont activés, les pixels de Meta (Facebook, Instagram) et de TikTok enregistrent certaines actions : page vue, annonce consultée, recherche, contact d’un agent, création de compte, demande de visite. Notre serveur envoie aussi ces actions à Meta et à TikTok, avec votre adresse IP, le type de votre navigateur et, lorsque vous en avez donné un, votre numéro de téléphone chiffré (haché), pour savoir quelles publicités ont fonctionné.',
      'En Europe et au Royaume-Uni, rien n’est chargé ni envoyé tant que vous n’avez pas accepté. Vous pouvez refuser : le site fonctionne de la même façon. Pour changer d’avis, effacez les cookies de lukkaplace.com ; la question vous sera posée à nouveau.',
    ] },
    { id: 'application', title: 'Application Lukka Place (Android et iPhone)', paragraphs: [
      'L’application affiche le site lukkaplace.com : elle enregistre les mêmes données que le site, et les outils de mesure décrits ci-dessus s’y appliquent de la même façon.',
      'Si vous autorisez les notifications, le service de notifications de Google (Firebase Cloud Messaging, qui passe par le service d’Apple sur iPhone) donne à votre téléphone un identifiant. Nous le gardons avec votre compte pour vous envoyer vos alertes : visites, demandes, messages, annonces qui correspondent à vos recherches. Une copie de chaque alerte reste dans la page Notifications de votre compte.',
      'Vous choisissez les types d’alertes dans les réglages de votre compte, ou vous les coupez dans les réglages du téléphone. En vous déconnectant, ce téléphone ne reçoit plus vos alertes. Une alerte urgente restée non lue peut aussi vous être envoyée sur WhatsApp.',
      'L’application ne lit ni votre position, ni vos contacts, ni vos SMS. Elle n’utilise l’appareil photo et vos photos que lorsque vous choisissez d’ajouter une photo.',
    ] },
    { id: 'duree', title: 'Combien de temps nous les gardons', paragraphs: [
      'Les données de votre compte sont gardées tant que le compte existe. Elles sont supprimées quand vous supprimez votre compte, à l’exception de ce qui est indiqué dans la section suivante.',
      'Les comptages de pages consultées et de recherches sont conservés : ils ne portent ni votre nom ni votre numéro.',
    ] },
    { id: 'suppression', title: 'Supprimer votre compte', paragraphs: [
      `Dans l’application ou sur le site : Espace client › Mon profil › Supprimer mon compte ; pour un agent, Paramètres › Supprimer mon compte. Vous pouvez aussi nous le demander à ${SUPPORT_EMAIL} ou sur WhatsApp au ${SUPPORT_WHATSAPP_DISPLAY}.`,
      'Sont supprimés : votre compte, vos favoris, vos alertes et recherches sauvegardées, vos téléphones enregistrés pour les notifications et votre page Notifications. Les annonces d’un agent sont retirées du site et ne portent plus son nom.',
      'Les demandes et visites déjà transmises à une agence restent dans son historique et le nôtre.',
    ] },
    { id: 'droits', title: 'Vos droits', paragraphs: [
      `Vous pouvez demander à consulter, corriger ou supprimer vos données, ou retirer votre accord, en écrivant à ${SUPPORT_EMAIL} ou sur WhatsApp au ${SUPPORT_WHATSAPP_DISPLAY}. Ces droits sont ceux prévus par l’Ordonnance-loi n°23/010 du 13 mars 2023 portant Code du numérique.`,
    ] },
    { id: 'securite', title: 'Sécurité', paragraphs: [
      'Le site et l’application ne fonctionnent qu’en connexion chiffrée (HTTPS). Les mots de passe sont hachés. Les documents de vérification des agents sont dans un espace privé, ouvert seulement par notre équipe.',
    ] },
    { id: 'mineurs', title: 'Mineurs', paragraphs: [
      'Lukka Place est réservé aux personnes d’au moins 18 ans, ou agissant sous la responsabilité d’un parent ou d’un tuteur légal (article 3 des Conditions d’utilisation). Nous ne cherchons pas à recueillir les données d’enfants.',
    ] },
    { id: 'modifications', title: 'Modifications de cette politique', paragraphs: [
      'Quand cette politique change, la date en haut de la page est mise à jour.',
    ] },
  ],
  contact: {
    title: 'Nous contacter',
    text: 'Pour une question, ou pour consulter ou supprimer vos données :',
    email: 'E-mail',
    whatsapp: 'WhatsApp',
    page: 'Aide et contact',
    terms: 'Conditions d’utilisation',
  },
};

const en = {
  title: 'Privacy Policy',
  updated: 'Updated 14 November 2026.',
  intro: 'This page says what data Lukka Place records on the lukkaplace.com website and in the Lukka Place app (Android and iPhone), why, who it is shared with, and how to see it or have it deleted.',
  contents: 'Contents',
  sections: [
    { id: 'responsable', title: 'Who Is Responsible for Your Data', paragraphs: [
      'LukkaPlace TM SARL, registered in the Registre du Commerce et du Crédit Mobilier under number CD/KNG/RCCM/26-B-01668, with its head office at n°34C, Immeuble SOMIP, appartement V2, 3rd floor, avenue du Commerce, commune de la Gombe, Kinshasa, Democratic Republic of the Congo.',
      `For any question about your data: ${SUPPORT_EMAIL}, or WhatsApp ${SUPPORT_WHATSAPP_DISPLAY}.`,
    ] },
    { id: 'donnees', title: 'The Data You Give Us', paragraphs: [
      'Your phone number and name when you create an account, to sign you in and reach you on WhatsApp. An e-mail address only if you enter one. An agent account’s number is confirmed on WhatsApp.',
      'Your password, kept in an encrypted (hashed) form nobody here can read.',
      'For an agent: the agency name, photo or logo, communes covered, listings and their photos, and the documents sent for verification (kept in private storage, opened only by our team).',
      'Your favourites, saved searches, alerts, “Find it for me” requests and visit requests, to show them to you and tell the agent concerned.',
      'The messages you exchange with an agent in Lukka Place messaging, and those you send to our WhatsApp numbers. Messages received on WhatsApp are read by an artificial-intelligence service (OpenAI) to understand a listing or a request and answer it.',
    ] },
    { id: 'appareil', title: 'Information About Your Device', paragraphs: [
      'With each page you open: the kind of device (phone, tablet or computer), worked out from your browser, and the site or ad that brought you. A random id kept in your browser, holding nothing about you, lets us count people rather than pages.',
      'Your IP address is used to limit abuse (too many requests in a short time). For an agent account, the IP address and browser of each sign-in are kept in a security log.',
      'Speed measurements (page load times, connection type), not linked to your account.',
      'In the app, if you allow notifications: your phone’s notification identifier, described below.',
      'Cookies and settings kept in your browser that the service needs to work: your sign-in, your language, your currency, your favourites, and your choice on ad measurement.',
    ] },
    { id: 'position', title: 'Your Location', paragraphs: [
      'The website knows your location only if you tap the “Near me” button and allow it. It is used, in your browser, to centre the map or find the nearby communes; we do not record it.',
      'The Android and iPhone app does not ask for your location.',
    ] },
    { id: 'usages', title: 'Why We Use This Data', paragraphs: [
      'To sign you in to your account, put you in touch with agents and agencies, send you the alerts you asked for, protect accounts and spot fraud, and learn which pages and which ads work.',
      'Listing prices are also used to work out the median rents in the price guide. Those are figures about properties, not about you.',
      'You accept these uses by using Lukka Place (article 11 of the Terms of Use). You can withdraw your agreement at any time by deleting your account or writing to us.',
    ] },
    { id: 'partage', title: 'Who It Is Shared With', paragraphs: [
      'Agents and agencies: an agent receives your name and number when you contact them, when you ask them for a visit, or when they take on your “Find it for me” request. Not before.',
      'WhatsApp (Meta) and our WhatsApp Business provider, for the messages we exchange with you on WhatsApp.',
      'Google: Firebase for the app’s notifications, and Google Maps to show the maps.',
      'OpenAI, for the reading of WhatsApp messages described above.',
      'Meta and TikTok, for the ad measurement described below.',
      'Our hosting providers (servers and database), located outside the Democratic Republic of the Congo.',
      'We do not sell your data, and we do not give it to anyone else.',
    ] },
    { id: 'publicite', title: 'Ad Measurement (Meta, TikTok)', paragraphs: [
      'When our measurement tools are switched on, the Meta (Facebook, Instagram) and TikTok pixels record some actions: page viewed, listing viewed, search, contacting an agent, creating an account, requesting a visit. Our server also sends these actions to Meta and TikTok, with your IP address, your browser type and, when you gave one, your phone number encrypted (hashed), to learn which ads worked.',
      'In Europe and the UK, nothing loads or is sent until you accept. You can refuse: the site works the same. To change your mind, clear lukkaplace.com’s cookies and you will be asked again.',
    ] },
    { id: 'application', title: 'The Lukka Place App (Android and iPhone)', paragraphs: [
      'The app shows the lukkaplace.com website: it records the same data as the site, and the measurement tools described above apply to it in the same way.',
      'If you allow notifications, Google’s notification service (Firebase Cloud Messaging, which goes through Apple’s service on iPhone) gives your phone an identifier. We keep it with your account to send you your alerts: visits, requests, messages, listings that match your searches. A copy of each alert stays on your account’s Notifications page.',
      'You choose which alerts you get in your account settings, or turn them off in the phone’s settings. When you log out, this phone stops receiving your alerts. An urgent alert left unread may also be sent to you on WhatsApp.',
      'The app does not read your location, your contacts or your SMS. It uses the camera and your photos only when you choose to add a photo.',
    ] },
    { id: 'duree', title: 'How Long We Keep It', paragraphs: [
      'Your account’s data is kept for as long as the account exists. It is deleted when you delete your account, except for what the next section lists.',
      'Counts of pages viewed and searches are kept: they carry neither your name nor your number.',
    ] },
    { id: 'suppression', title: 'Deleting Your Account', paragraphs: [
      `In the app or on the site: Customer Area › My profile › Delete my account; for an agent, Settings › Delete My Account. You can also ask us at ${SUPPORT_EMAIL} or on WhatsApp at ${SUPPORT_WHATSAPP_DISPLAY}.`,
      'What is deleted: your account, your favourites, your alerts and saved searches, the phones registered for notifications and your Notifications page. An agent’s listings are taken off the site and no longer carry their name.',
      'Requests and visits already passed to an agency stay in its history and ours.',
    ] },
    { id: 'droits', title: 'Your Rights', paragraphs: [
      `You can ask to see, correct or delete your data, or withdraw your agreement, by writing to ${SUPPORT_EMAIL} or on WhatsApp at ${SUPPORT_WHATSAPP_DISPLAY}. These are the rights set out in Ordonnance-loi n°23/010 of 13 March 2023 (the DRC Digital Code).`,
    ] },
    { id: 'securite', title: 'Security', paragraphs: [
      'The site and the app only work over an encrypted connection (HTTPS). Passwords are hashed. Agents’ verification documents are in private storage, opened only by our team.',
    ] },
    { id: 'mineurs', title: 'Children', paragraphs: [
      'Lukka Place is for people aged 18 or over, or acting under the responsibility of a parent or legal guardian (article 3 of the Terms of Use). We do not seek to collect children’s data.',
    ] },
    { id: 'modifications', title: 'Changes to This Policy', paragraphs: [
      'When this policy changes, the date at the top of the page is updated.',
    ] },
  ],
  contact: {
    title: 'Contact Us',
    text: 'For a question, or to see or delete your data:',
    email: 'E-mail',
    whatsapp: 'WhatsApp',
    page: 'Help and contact',
    terms: 'Terms of Use',
  },
};

export const PRIVACY_POLICY = { fr, en };

export function privacyPolicyFor(locale) {
  return PRIVACY_POLICY[locale === 'en' ? 'en' : 'fr'];
}
