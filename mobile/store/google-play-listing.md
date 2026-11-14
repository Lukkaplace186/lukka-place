# Store listing — Lukka Place (Google Play, reused for the App Store)

Drafted 2026-11-11. Every line describes something the app does today; no
figures (listing counts change daily). French is the default language of the
listing, English is added as a translation in Play Console.

Images in this folder:
- `feature-graphic-1024x500.png` — Play "Feature graphic".
- `icon-512.png` — Play "App icon" (512 × 512).
- Phone screenshots (at least 2, 1080 × 2400): still to take on the
  emulator once logged in — listings, a listing page, the map, the agent
  space, the notifications page.

## Legal requirements (mandatory for approval)

Both stores reject an app without these. The values are the ones the website
publishes (`web/lib/legal/contact.js`); paste them as written.

| Asked for | Value | Where it goes |
|---|---|---|
| Privacy policy URL | https://lukkaplace.com/confidentialite | Play Console › App content › Privacy policy. App Store Connect › App Information › Privacy Policy URL. |
| Support URL | https://lukkaplace.com/contact | App Store Connect › version page › Support URL. Play Console › Store settings › Website. |
| Contact e-mail | info@lukkaplace.com | Play Console › Store settings › Email address (shown on the listing). App Store Connect › App Review Information › Email. |
| Contact phone (optional on Play, asked by App Review) | +243 846 962 654 | Play Console › Store settings › Phone. App Store Connect › App Review Information › Phone. |
| Account deletion URL | https://lukkaplace.com/confidentialite#suppression | Play Console › App content › Data safety › Data deletion. |
| Terms of use (optional) | https://lukkaplace.com/conditions | App Store Connect › License Agreement, only if a custom one is wanted. |

- The privacy policy covers the phone number, the name, device information
  (device type, IP address, the notification identifier), who the data is
  shared with, and deletion. It is the same page in French and in English
  (the language follows the visitor).
- Inside the app, the policy, the terms and the support page are three small
  links at the bottom of the Compte tab (customers and agents), and the
  policy is one tap from the support page. Apple checks that the policy can
  be reached in the app (guideline 5.1.1).
- The policy is written in plain words from what the code does, not by a
  lawyer. Have it read by one before relying on it in a dispute.

Category: **House & Home** (Maison et habitat).

---

## Français (par défaut)

**Nom de l'application** (30 caractères max) :
Lukka Place

**Description courte** (80 caractères max) :
Maisons, appartements et terrains à louer ou à acheter à Kinshasa et en RDC.

**Description complète** :

Lukka Place vous aide à trouver un logement à Kinshasa et dans les grandes villes de la RDC : appartements, maisons, villas, terrains et locaux commerciaux, à louer ou à acheter.

Chercher un bien
• Les annonces des agences, avec photos et prix affichés.
• Recherche par commune et quartier, par budget et par nombre de chambres.
• La carte des annonces.
• Les frais d'entrée détaillés : garantie, avance et commission.

Être prévenu
• Enregistrez une recherche : l'application vous prévient quand une annonce correspond.
• Enregistrez vos annonces favorites : vous êtes prévenu si le prix baisse ou si le bien est loué.
• Une notification pour chaque réponse à vos demandes de visite et à vos messages.

Visiter et contacter
• Demandez une visite en quelques secondes et suivez-la dans votre compte.
• Écrivez à l'agence sur WhatsApp ou par la messagerie de Lukka Place.
• « Trouver pour moi » : décrivez ce que vous cherchez, des agences vous proposent des biens.

Pour les agents et agences
• Publiez vos annonces en les envoyant sur WhatsApp.
• Recevez les demandes de visite et les demandes de clients en notification, même hors de WhatsApp.
• Gérez vos annonces, vos visites et vos clients depuis votre espace agent.

Lukka Place est une plateforme : les biens sont proposés par des agences et des agents immobiliers.

---

## English

**App name**:
Lukka Place

**Short description** (80 characters max):
Houses, flats and land to rent or buy in Kinshasa and across the DRC.

**Full description**:

Lukka Place helps you find a home in Kinshasa and in the main cities of the DRC: apartments, houses, villas, land and commercial space, to rent or to buy.

Search
• Listings from agencies, with photos and prices shown.
• Search by commune and neighbourhood, budget and number of bedrooms.
• A map of the listings.
• Entry costs itemised: deposit, advance and commission.

Get alerts
• Save a search: the app tells you when a listing matches.
• Save listings you like: you are told if the price drops or the place is let.
• A notification for every answer to your visit requests and messages.

Visit and contact
• Request a visit in seconds and follow it in your account.
• Message the agency on WhatsApp or through Lukka Place messaging.
• "Find it for me": describe what you are looking for and agencies send you properties.

For agents and agencies
• Publish listings by sending them on WhatsApp.
• Get visit requests and customer requests as notifications, even outside WhatsApp.
• Manage your listings, visits and customers from your agent space.

Lukka Place is a platform: properties are offered by real-estate agencies and agents.

---

## Play "Data safety" answers (to check against the form)

- **Collected**: phone number, name (account); photos (agents' listing
  photos, chosen by the user); app interactions (pages viewed, anonymous id);
  device or other ids (the notification token); messages (Lukka Place
  messaging between customers and agents, and visit/request details).
- **Shared**: the phone number with the agency a customer contacts or asks a
  visit from; ad-measurement events with Meta and TikTok when switched on
  (phone number hashed) — see the privacy policy.
- **Not collected**: location, contacts, financial info, health, SMS or
  e-mails.
- **Encrypted in transit**: yes (HTTPS only).
- **Users can ask for deletion**: yes, in the app and at the deletion link.
