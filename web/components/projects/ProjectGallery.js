import SafeImage from '@/components/SafeImage';
import { getT } from '@/lib/i18n/server';

/**
 * A project's media: real photos first, then architectural renders, in one
 * swipeable rail (CSS scroll-snap — no script). Every render carries an
 * "Image d'illustration" label on the image itself, so a screenshot of a
 * render can never be passed off as the building as it stands.
 */
export default async function ProjectGallery({ project }) {
  const t = await getT();
  const media = [
    ...(project.photos || []).filter(Boolean).map((src) => ({ src, render: false })),
    ...(project.renders || []).filter(Boolean).map((src) => ({ src, render: true })),
  ];
  if (!media.length) return null;

  return (
    <div className="-mx-4 sm:mx-0">
      <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-2 sm:px-0 [scrollbar-width:thin]">
        {media.map((item, index) => (
          <figure
            key={`${item.src}-${index}`}
            className="relative aspect-[4/3] w-[88%] shrink-0 snap-center overflow-hidden rounded-card bg-canvas-alt sm:w-[62%] lg:w-[48%]"
          >
            <SafeImage
              src={item.src}
              alt={`${project.name} — ${index + 1}`}
              fill
              priority={index === 0}
              sizes="(min-width: 1024px) 600px, 88vw"
              className="object-cover"
            />
            <figcaption className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-[0.75rem] font-medium text-white">
              {item.render ? t('projects.render') : t('projects.realPhoto')}
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="px-4 text-[0.75rem] text-ink-45 sm:px-0">
        {t('projects.gallery.count', { photos: (project.photos || []).length, renders: (project.renders || []).length })}
      </p>
    </div>
  );
}
