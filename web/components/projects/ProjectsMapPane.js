'use client';

import dynamic from 'next/dynamic';

/**
 * The Maps JS API only exists in the browser, and its loader is heavy: the
 * map module is split out (same reason ResponsiveMapPane imports every map
 * through next/dynamic). The frame owns the height — the map inside is h-full.
 */
const ProjectsMap = dynamic(() => import('./ProjectsMap'), {
  ssr: false,
  loading: () => <div className="h-full w-full rounded-card bg-canvas-alt" />,
});

export default function ProjectsMapPane({ pins, single = false }) {
  return (
    <div className={single ? 'h-[22rem]' : 'h-[calc(100dvh-9rem)] min-h-[24rem] lg:h-[calc(100vh-8rem)]'}>
      <ProjectsMap pins={pins} single={single} className="h-full" />
    </div>
  );
}
