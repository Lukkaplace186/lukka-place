/**
 * The empty-state graphic for a chart with no data yet: a ghost of the chart
 * that will fill in, drawn in the recessive line colour so it can never be
 * mistaken for real bars. Paired with a sentence saying why it is empty.
 */
export default function EmptyChart({ message, variant = 'bars' }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
      <svg viewBox="0 0 160 72" className="h-16 w-40 text-line" aria-hidden="true">
        <line x1="4" y1="68" x2="156" y2="68" stroke="currentColor" strokeWidth="1" />
        {variant === 'bars'
          ? [18, 40, 28, 52, 34, 22].map((height, index) => (
              <rect
                key={index}
                x={12 + index * 24}
                y={68 - height}
                width="14"
                height={height}
                rx="3"
                fill="currentColor"
                opacity={0.55 + index * 0.05}
              />
            ))
          : [14, 30, 46, 58, 38, 20].map((width, index) => (
              <rect key={index} x="4" y={4 + index * 10} width={width * 2.4} height="6" rx="3" fill="currentColor" opacity="0.7" />
            ))}
      </svg>
      <p className="u-micro max-w-sm text-ink-45">{message}</p>
    </div>
  );
}
