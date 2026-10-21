import { listingVideos } from '@/lib/listingVideos';

/**
 * The agent's own videos of the property (lib/listingVideos.js), as plain
 * <video> players. Nothing loads until the visitor presses play when there is
 * a cover frame (preload="none" — visitors pay per megabyte); without one,
 * only the metadata is fetched so the browser can draw the first frame
 * (`#t=0.1` makes iPhone Safari do the same). Renders nothing for a listing
 * with no video.
 *
 * @param {{ listing: object, heading: string, itemLabel: (n: number, total: number) => string }} props
 */
export default function ListingVideos({ listing, heading, itemLabel, id = 'videos' }) {
  const videos = listingVideos(listing);
  if (videos.length === 0) return null;
  return (
    <section id={id} className="flex scroll-mt-32 flex-col gap-3">
      <h2 className="u-h2 text-ink">{heading}</h2>
      <div className={videos.length > 1 ? 'grid gap-3 sm:grid-cols-2' : 'grid gap-3'}>
        {videos.map((video, index) => (
          <video
            key={video.url}
            className="aspect-video w-full rounded-2xl bg-ink object-contain"
            controls
            playsInline
            preload={video.poster ? 'none' : 'metadata'}
            poster={video.poster || undefined}
            aria-label={itemLabel(index + 1, videos.length)}
          >
            <source src={video.poster ? video.url : `${video.url}#t=0.1`} />
          </video>
        ))}
      </div>
    </section>
  );
}
