import { MessageSquareText } from 'lucide-react';
import { getWhatsAppLog } from '@/lib/adminApi';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import { Chip, formatKinshasa } from './LeadRoutingUI';

/**
 * One number's WhatsApp history with Lukka Place (engine whatsapp_message_log,
 * 2026-11-09): every message our numbers sent to it and every message it sent
 * us, newest first. A template row shows the template's name and the values
 * it was filled with — its wording lives at Meta. "Envoyé" means Chakra
 * accepted the message: no delivery receipt ever reaches us.
 *
 * Read-only, server-rendered. Shows the latest `limit` messages; the log only
 * starts on the day it was deployed, so an empty panel for an older contact is
 * expected and says so.
 */
export default async function WhatsAppHistory({ waId, limit = 60 }) {
  const t = await getT();
  const digits = String(waId || '').replace(/\D/g, '');
  let rows = [];
  let failed = false;
  if (digits) {
    try {
      rows = (await getWhatsAppLog(digits, { limit })).data || [];
    } catch (err) {
      console.error(`[admin] WhatsApp history for ${digits}: ${err.message}`);
      failed = true;
    }
  }
  // Oldest first reads like a chat; the engine returns newest first.
  const ordered = [...rows].reverse();

  return (
    <section className="u-card flex flex-col gap-3 rounded-card bg-surface p-5">
      <h2 className="u-title-card flex items-center gap-2 text-ink">
        <MessageSquareText strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-35" />
        {t('admin.whatsappHistory.title')}
      </h2>
      <p className="u-micro text-ink-45">{t('admin.whatsappHistory.hint')}</p>
      {failed ? (
        <p className="u-micro text-danger">{t('admin.whatsappHistory.error')}</p>
      ) : ordered.length === 0 ? (
        <p className="u-micro text-ink-45">{t('admin.whatsappHistory.empty')}</p>
      ) : (
        <ol className="flex max-h-[32rem] flex-col gap-2 overflow-y-auto pr-1">
          {ordered.map((row) => {
            const inbound = row.direction === 'in';
            return (
              <li key={row.id} className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[85%] rounded-lg px-3 py-2 ${inbound ? 'bg-canvas-alt text-ink' : 'bg-blue-tint text-ink'}`}>
                  <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                    <span className="u-micro-strong text-ink-70">
                      {inbound ? t('admin.whatsappHistory.received') : t('admin.whatsappHistory.sent')}
                    </span>
                    {row.kind === 'template' ? <Chip tone="blue">{row.template_name}</Chip> : null}
                    {row.kind === 'button' ? <Chip>{t('admin.whatsappHistory.buttonTap')}</Chip> : null}
                    {row.media_count ? <Chip>{t('admin.whatsappHistory.media', { count: row.media_count })}</Chip> : null}
                    <span className="u-micro text-ink-45">{formatKinshasa(row.created_at)}</span>
                  </div>
                  {row.body ? (
                    <p className="u-micro whitespace-pre-wrap break-words">{row.body}</p>
                  ) : row.reply_id ? (
                    <p className="u-micro text-ink-70">{row.reply_id}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
