'use client';

import { useState } from 'react';
import { BellRing, CalendarCheck, CircleAlert, FileText, Heart, Info, MoreHorizontal, Share2, Upload, WifiOff, X } from 'lucide-react';
import AppAvatar from '@/components/app/AppAvatar';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentDescription, AttachmentGroup, AttachmentMedia, AttachmentTitle,
} from '@/components/ui/attachment';
import { Badge } from '@/components/ui/badge';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Bubble, BubbleContent, BubbleGroup, BubbleReactions } from '@/components/ui/bubble';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Calendar } from '@/components/ui/calendar';
import { Carousel, CarouselContent, CarouselDots, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel';
import { ChartBars, ChartContainer } from '@/components/ui/chart';
import { DatePicker } from '@/components/ui/date-picker';
import { Marker, MarkerContent, MarkerTyping } from '@/components/ui/marker';
import { Message, MessageAvatar, MessageContent, MessageFooter } from '@/components/ui/message';
import {
  MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerProvider, MessageScrollerViewport,
} from '@/components/ui/message-scroller';
import { Skeleton } from '@/components/ui/skeleton';
import AppChatList from '@/components/chat/AppChatList';
import { useT } from '@/lib/i18n/client';
import { Spinner } from '@/components/ui/spinner';

function Panel({ title, children, className = '' }) {
  return (
    <section className={`rounded-2xl bg-canvas-alt p-5 ${className}`}>
      <p className="mb-4 text-[0.8125rem] font-bold uppercase tracking-wide text-ink-45">{title}</p>
      {children}
    </section>
  );
}

// Example replies for the chat demo, added one by one when "Ajouter un message" is pressed.
const NEXT_REPLIES = [
  'Oui, il est toujours disponible.',
  'Je peux vous le faire visiter demain à 14 h.',
  'La garantie, l’avance et la commission sont indiquées sur l’annonce.',
];

/**
 * The /app-demo components board (local only): every UI building block in
 * the Lukka Place style, on real data where there is data — the newest
 * listing's own photos and place, the live listing count per commune.
 * Chat lines are written examples, labelled as such; nothing here is sent.
 */
export default function ComponentsShowcase({ listing, communes }) {
  const [date, setDate] = useState(null);
  const [picked, setPicked] = useState(null);
  const [extra, setExtra] = useState([]);
  const photos = listing?.photos || [];
  const t = useT();
  // The app's real Messagerie list, with written example lines (nothing is sent).
  // A fixed time, so the server and the browser draw the same clock (no hydration mismatch).
  const minutesAgo = (n) => new Date(Date.parse('2026-11-12T10:00:00Z') - n * 60000).toISOString();
  const chatRows = [
    { id: 1, senderRole: 'customer', kind: 'text', body: 'Bonjour, l’appartement est-il toujours disponible ?', createdAt: minutesAgo(42) },
    { id: 'pending-a', clientId: 'a', senderRole: 'customer', kind: 'text', body: 'Il y a un parking ?', createdAt: minutesAgo(41), status: 'failed' },
    { id: 2, senderRole: 'agent', kind: 'text', body: 'Bonjour ! Oui, toujours disponible.', createdAt: minutesAgo(30) },
    ...(listing?.chatCard ? [{ id: 3, senderRole: 'agent', kind: 'listing', body: null, propertyId: listing.chatCard.id, listing: listing.chatCard, createdAt: minutesAgo(30) }] : []),
    { id: 4, senderRole: 'agent', kind: 'text', body: 'Vous voulez le visiter quand ?', createdAt: minutesAgo(29) },
    { id: 5, senderRole: 'customer', kind: 'text', body: 'Demain après-midi, c’est possible ?', createdAt: minutesAgo(5) },
  ].map((message, i) => ({ message, divider: i === 0 ? 'Aujourd’hui' : null }));

  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
      <Panel title="Accordion · questions fréquentes">
        <Accordion type="single" collapsible defaultValue="visit" className="rounded-2xl bg-surface px-4">
          <AccordionItem value="visit">
            <AccordionTrigger>Comment demander une visite ?</AccordionTrigger>
            <AccordionContent>Sur l’annonce, touchez « Demander une visite », choisissez un jour et une heure, puis laissez votre numéro WhatsApp. L’agent vous confirme sur WhatsApp.</AccordionContent>
          </AccordionItem>
          <AccordionItem value="whatsapp">
            <AccordionTrigger>Pourquoi WhatsApp passe par Lukka Place ?</AccordionTrigger>
            <AccordionContent>Votre message arrive d’abord chez Lukka Place : la demande est enregistrée, l’agent est prévenu et vous recevez aussitôt son numéro.</AccordionContent>
          </AccordionItem>
          <AccordionItem value="alerts">
            <AccordionTrigger>Comment être prévenu des nouveaux biens ?</AccordionTrigger>
            <AccordionContent>Enregistrez une recherche depuis les résultats, puis activez « Alertes » dans Enregistrés.</AccordionContent>
          </AccordionItem>
        </Accordion>
      </Panel>

      <Panel title="Alert">
        <div className="grid gap-3">
          <Alert variant="success"><CalendarCheck /><AlertTitle>Visite demandée</AlertTitle><AlertDescription>Votre demande de visite est envoyée à l’agent du bien.</AlertDescription></Alert>
          <Alert><Info /><AlertTitle>Activez les notifications</AlertTitle><AlertDescription>Pour savoir dès qu’un agent vous répond.</AlertDescription></Alert>
          <Alert variant="warning"><WifiOff /><AlertTitle>Hors ligne</AlertTitle><AlertDescription>Les annonces s’afficheront dès le retour de la connexion.</AlertDescription></Alert>
          <Alert variant="destructive"><CircleAlert /><AlertTitle>Jour indisponible</AlertTitle><AlertDescription>L’agent ne fait pas de visites ce jour-là. Choisissez un autre jour.</AlertDescription></Alert>
        </div>
      </Panel>

      <Panel title="Badge · Avatar · Skeleton">
        <div className="flex flex-wrap gap-2">
          <Badge>Nouveau</Badge>
          <Badge variant="success">Prix en baisse −10 %</Badge>
          <Badge variant="warning">Sous offre</Badge>
          <Badge variant="secondary">Loué</Badge>
          <Badge variant="destructive">Refusée</Badge>
          <Badge variant="outline">Courte durée</Badge>
        </div>
        <div className="mt-5 flex items-center gap-4">
          <AppAvatar name="Amara Okafor" size="md" />
          <AppAvatar name="Agence Exemple" size="md" verified verifiedLabel="Agent vérifié" />
          <Spinner className="size-5" />
        </div>
        <div className="mt-5 flex gap-3 rounded-2xl bg-surface p-3">
          <Skeleton className="size-20 rounded-xl" />
          <div className="flex-1 space-y-2 py-1">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
      </Panel>

      <Panel title="Carousel · photos réelles">
        {photos.length ? (
          <Carousel label="Photos de l’annonce" className="mx-auto max-w-sm">
            <CarouselContent>
              {photos.map((src, i) => (
                <CarouselItem key={src}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`Photo ${i + 1}`} draggable={false} className="aspect-[4/3] w-full object-cover" />
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious />
            <CarouselNext />
            <CarouselDots />
          </Carousel>
        ) : (
          <p className="text-[0.875rem] text-ink-45">Aucune photo disponible.</p>
        )}
        {listing?.place ? <p className="mt-2 text-center text-[0.8125rem] text-ink-70">{listing.place}</p> : null}
      </Panel>

      <Panel title="Calendar · DatePicker">
        <div className="flex flex-col items-start gap-4">
          <Calendar selected={date} onSelect={setDate} disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))} />
          <div className="w-full max-w-xs">
            <DatePicker value={picked} onChange={setPicked} placeholder="Date d’emménagement" />
          </div>
        </div>
      </Panel>

      <Panel title="Chart · biens en ligne par commune">
        <ChartContainer title="Biens en ligne" caption="Nombre réel d’annonces publiques, communes les plus fournies.">
          <ChartBars data={communes.map((c) => ({ label: c.commune, value: c.count }))} highlight={communes[0]?.commune} />
        </ChartContainer>
      </Panel>

      <Panel title="Breadcrumb · ButtonGroup">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem><BreadcrumbLink href="/">Accueil</BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbLink href="/listings">Kinshasa</BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>{listing?.place || 'Annonce'}</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="mt-5 flex flex-wrap gap-3">
          <ButtonGroup>
            <Button variant="outline" size="lg"><Share2 />Partager</Button>
            <Button variant="outline" size="lg"><Heart />Enregistrer</Button>
            <Button variant="outline" size="icon-lg" aria-label="Plus d’actions"><MoreHorizontal /></Button>
          </ButtonGroup>
          <ButtonGroup>
            <Button variant="outline" size="lg">Liste</Button>
            <Button variant="outline" size="lg">Carte</Button>
          </ButtonGroup>
        </div>
      </Panel>

      <Panel title="Attachment · photos d’annonce">
        {photos.length >= 3 ? (
          <AttachmentGroup>
            {photos.slice(0, 3).map((src, i) => (
              <Attachment key={src} orientation="vertical">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <AttachmentMedia variant="image"><img src={src} alt="" /></AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{i === 0 ? 'Couverture' : `Photo ${i + 1}`}</AttachmentTitle>
                </AttachmentContent>
              </Attachment>
            ))}
          </AttachmentGroup>
        ) : null}
        <div className="mt-3 grid gap-2">
          <Attachment state="uploading" progress={64}>
            <AttachmentMedia><Upload /></AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>Photo 4</AttachmentTitle>
              <AttachmentDescription>Envoi · 64 %</AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions><AttachmentAction aria-label="Annuler l’envoi"><X /></AttachmentAction></AttachmentActions>
          </Attachment>
          <Attachment>
            <AttachmentMedia><FileText /></AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>Pièce d’identité</AttachmentTitle>
              <AttachmentDescription>Document de vérification</AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions><AttachmentAction aria-label="Retirer le document"><X /></AttachmentAction></AttachmentActions>
          </Attachment>
        </div>
      </Panel>

      <Panel title="Messagerie de l’app (exemple)" className="md:col-span-2 xl:col-span-1">
        <div className="max-h-[30rem] overflow-y-auto rounded-2xl border border-line bg-canvas-alt p-4">
          <AppChatList
            rows={chatRows}
            side="customer"
            person={{ name: 'Agence Exemple', role: 'agent' }}
            name="Agence Exemple"
            lastMine={chatRows[chatRows.length - 1].message}
            otherLastReadId={5}
            isNew={() => false}
            onRetry={() => {}}
            locale="fr"
            t={t}
          />
        </div>
      </Panel>

      <Panel title="Message · Bubble · MessageScroller (exemple)" className="md:col-span-2 xl:col-span-1">
        <MessageScrollerProvider>
          <div className="flex h-[26rem] flex-col overflow-hidden rounded-2xl border border-line bg-canvas">
            <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
              <AppAvatar name="Agence Exemple" size="md" verified verifiedLabel="Agent vérifié" />
              <div className="min-w-0">
                <p className="truncate text-[0.9375rem] font-semibold text-ink">Agence Exemple</p>
                <p className="truncate text-[0.75rem] text-ink-45">{listing?.place || 'Annonce'}</p>
              </div>
            </div>
            <MessageScroller className="flex-1">
              <MessageScrollerViewport>
                <MessageScrollerContent className="p-4">
                  <Marker><MarkerContent>Aujourd’hui</MarkerContent></Marker>
                  <Message align="end">
                    <MessageContent>
                      <Bubble align="end"><BubbleContent>Bonjour, l’appartement est-il toujours disponible ?</BubbleContent></Bubble>
                      <MessageFooter>Envoyé</MessageFooter>
                    </MessageContent>
                  </Message>
                  <Message>
                    <MessageAvatar><AppAvatar name="Agence Exemple" size="md" /></MessageAvatar>
                    <MessageContent>
                      <BubbleGroup>
                        <Bubble><BubbleContent>Bonjour ! Oui.</BubbleContent></Bubble>
                        <Bubble>
                          <BubbleContent>Vous voulez le visiter quand ?</BubbleContent>
                          <BubbleReactions aria-label="Réaction : pouce levé"><span>👍</span></BubbleReactions>
                        </Bubble>
                      </BubbleGroup>
                    </MessageContent>
                  </Message>
                  {extra.map((text, i) => (
                    <Message key={i}>
                      <MessageAvatar><AppAvatar name="Agence Exemple" size="md" /></MessageAvatar>
                      <MessageContent><Bubble appear><BubbleContent>{text}</BubbleContent></Bubble></MessageContent>
                    </Message>
                  ))}
                  <Marker role="status"><MarkerContent><MarkerTyping />L’agent écrit…</MarkerContent></Marker>
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
            <div className="border-t border-line bg-surface p-3">
              <button
                type="button"
                onClick={() => setExtra((list) => [...list, NEXT_REPLIES[list.length % NEXT_REPLIES.length]])}
                className="u-press flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue text-[0.875rem] font-semibold text-white"
              >
                <BellRing className="size-4" aria-hidden="true" />
                Ajouter un message (exemple)
              </button>
            </div>
          </div>
        </MessageScrollerProvider>
      </Panel>
    </div>
  );
}
