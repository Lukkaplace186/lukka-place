import { ShieldCheck } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * The scam-safety line under the inbox and the first message. Takes the
 * text, not `t`: it renders from a server page (the signed-out /messages)
 * and from client components alike, and a function cannot cross into a
 * client component.
 */
export default function ChatSafetyNote({ text, className = '' }) {
  return (
    <p className={cn('flex items-start gap-3 rounded-card bg-canvas-alt px-4 py-3.5 text-[0.8125rem] leading-relaxed text-ink-70', className)}>
      <ShieldCheck strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-5 w-5 flex-none text-blue" aria-hidden="true" />
      {text}
    </p>
  );
}
