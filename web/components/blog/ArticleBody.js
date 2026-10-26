import Link from 'next/link';

/**
 * The body of a guide or a post (lib/blogRules.js blocks). Server-rendered,
 * no client JavaScript. Text is rendered as text — there is no HTML path —
 * and a link is either a site path (next/link) or an https URL opened in a
 * new tab with rel="noopener nofollow".
 */
function Inline({ value }) {
  if (!Array.isArray(value)) return value;
  return value.map((segment, i) => {
    if (!segment.href) return <span key={i}>{segment.text}</span>;
    if (segment.href.startsWith('/')) {
      return (
        <Link key={i} href={segment.href} className="font-semibold text-blue-deep underline underline-offset-2">
          {segment.text}
        </Link>
      );
    }
    return (
      <a key={i} href={segment.href} target="_blank" rel="noopener nofollow" className="font-semibold text-blue-deep underline underline-offset-2">
        {segment.text}
      </a>
    );
  });
}

function Block({ block }) {
  if (block.h2) return <h2 className="u-h2 mt-4 text-ink">{block.h2}</h2>;
  if (block.p) return <p><Inline value={block.p} /></p>;
  if (block.ul) {
    return (
      <ul className="flex list-disc flex-col gap-2 pl-5">
        {block.ul.map((item, i) => <li key={i}><Inline value={item} /></li>)}
      </ul>
    );
  }
  if (block.ol) {
    return (
      <ol className="flex list-decimal flex-col gap-2 pl-5">
        {block.ol.map((item, i) => <li key={i}><Inline value={item} /></li>)}
      </ol>
    );
  }
  return null;
}

export default function ArticleBody({ blocks }) {
  return (blocks || []).map((block, i) => <Block key={i} block={block} />);
}
