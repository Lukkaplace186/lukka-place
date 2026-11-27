# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The Play and App Store app is a Capacitor shell over `lukkaplace.com/app` (`mobile/`); its screens are web pages (`components/app/*`), so the design language is the site's, not native iOS or Android.

## Users

- **Home seekers in Kinshasa** (and 10 other DRC cities), mostly on budget Android phones, on slow and costly mobile data, often arriving from a Facebook ad. They want a place to rent (typical budget a few hundred dollars a month) or to buy, in a quartier they know.
- **Agents and commissionnaires**: independent agents and small agencies who publish listings by WhatsApp and want customers, visit requests and proof of their work.
- **The Lukka Place desk** (ops) moderates and follows up, in the web admin.

## Product Purpose

Lukka Place is Kinshasa's property portal: verified listings from real agents, prices people can compare, and a direct line to the agent on WhatsApp. Success is a customer who finds a place, contacts the right agent, and visits it; and an agent who gets real customers from the listings they send.

## Positioning

Listings arrive from agents on WhatsApp and are moderated before they go public; every listing names its agent, quartier and commune, and its price in USD. The platform connects people, it is not itself an agency.

## Operating Context

- WhatsApp is the medium of the market: agents send listings to our intake number; customers' "WhatsApp" buttons open the verified agent's own WhatsApp (owner decision 2026-11-15).
- Visits are requested in the app or site ("Demander une visite"), sur place or en vidéo, and the agent accepts, proposes another time, or declines.
- Alerts go to the app first (push), WhatsApp as fallback.

## Capabilities and Constraints

- French first; English exists. Place is always "quartier, commune". Prices in USD with a period (mois, jour, semaine); entry costs are deposit, advance and commission months, kept separate.
- Sign-in is a name and a WhatsApp number ("Continuer avec WhatsApp"), no password, no email (owner, 2026-11-26).
- In the app, "Ajouter un bien" sends the agent to the WhatsApp intake; there is no in-app listing form (owner, 2026-11-26).
- Never invent data: a missing fact is shown as missing.

## Brand Commitments

- Name "Lukka Place"; logo is the white "LukkaPlace" wordmark (bold "Lukka", light "Place") with a house roof over "Place", on Logo Royal #144FC5. Cut-out in `marketing/video-src/pub-facebook-4k/src/logo-white.png`.
- Lukka Place is never shown as an agent or mover.
- The 30-screen app mockup of 2026-11-26 (`web/Design/app/`) is the app's design reference; its UK copy is placeholder.

## Evidence on Hand

Real listings, photos, agents and prices live in production Supabase; the live site is lukkaplace.com. No testimonials or press to cite.

## Product Principles

1. The listing's own photo and price lead; the interface stays out of the way.
2. One tap to the agent on WhatsApp, one tap to ask for a visit.
3. Say what is unknown rather than fill a gap.
4. Built for a cheap phone on a slow link.
