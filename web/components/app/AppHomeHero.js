'use client';

import { getImageProps } from 'next/image';
import { m, useReducedMotion, useScroll, useTransform } from 'motion/react';
import heroSunlit from '../../Hero/hero-sunlit.jpg';
import { useT } from '@/lib/i18n/client';

// The title, then the line under it: part of the home screen's one entrance
// (AppHomeTop continues it with the search card and the rail). Transform
// only, never opacity: the server HTML is what a phone on 3G shows first.
const rise = {
  hidden: { y: 18 },
  shown: (i = 0) => ({ y: 0, transition: { delay: 0.06 * i, type: 'spring', stiffness: 260, damping: 30 } }),
};

/**
 * The same picture the website's hero shows (components/Hero.js): the one
 * set on /admin/cms, else the built-in Kinshasa photograph. Below 640px the
 * 640w file is pinned whatever the screen density, as on the website: this
 * photo is the first thing a phone on 3G downloads.
 */
function Picture({ src, alt, blur }) {
  const common = { src, alt, fill: true, ...(blur ? { placeholder: 'blur' } : {}) };
  const { props } = getImageProps({ ...common, sizes: '100vw', fetchPriority: 'high', loading: 'eager' });
  const mobile = getImageProps({ ...common, sizes: '640px' }).props.srcSet
    ?.split(', ')
    .find((entry) => entry.endsWith(' 640w'))
    ?.replace(/ 640w$/, '');
  return (
    <picture>
      {mobile ? <source media="(max-width: 640px)" srcSet={mobile} /> : null}
      <img {...props} alt={alt} className="object-cover object-[50%_62%]" />
    </picture>
  );
}

/**
 * The app home's photograph (2026-11-12, the owner's reference layout): the
 * website's own hero picture, running up under the top bar, with the title
 * and the real number of live listings on its sky. The search card sits on
 * its lower edge (AppHomeTop).
 *
 * Scroll: the photo moves at a third of the page's speed and grows a little,
 * and the title lifts away as the page takes over. Both follow the finger
 * (no timer) and are off for a phone set to reduce motion.
 *
 * The only thing over the photo is a royal tint on the top of the sky, so the
 * logo and the white title stay readable where a cloud sits behind them. No
 * scrim on the street scene itself.
 */
export default function AppHomeHero({ image = null, liveCount = 0 }) {
  const t = useT();
  const still = useReducedMotion();
  const { scrollY } = useScroll();
  const photoY = useTransform(scrollY, [0, 360], [0, 110]);
  const photoScale = useTransform(scrollY, [0, 360], [1.02, 1.12]);
  const titleY = useTransform(scrollY, [0, 220], [0, -28]);
  const titleOpacity = useTransform(scrollY, [40, 200], [1, 0]);

  return (
    <section className="relative -mt-16 h-[18.5rem] overflow-hidden bg-blue-900 sm:h-[22rem]">
      <m.div aria-hidden={image?.alt ? undefined : true} className="absolute inset-0" style={still ? undefined : { y: photoY, scale: photoScale }}>
        {image?.imageUrl ? <Picture src={image.imageUrl} alt={image.alt || ''} /> : <Picture src={heroSunlit} alt="" blur />}
      </m.div>
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-3/5 bg-gradient-to-b from-blue-900/60 to-transparent" />
      {image?.credit ? (
        <span className="absolute bottom-[4.25rem] right-3 z-10 max-w-[60%] truncate text-[0.6875rem] text-white/90 [text-shadow:0_1px_2px_rgb(0_0_0_/_0.8)]">
          {image.credit}
        </span>
      ) : null}

      <m.div className="relative z-10 px-5 pt-[4.75rem] text-white" style={still ? undefined : { y: titleY, opacity: titleOpacity }}>
        <m.h1 variants={rise} initial="hidden" animate="shown" custom={0} className="u-title-hero text-balance [text-shadow:0_2px_16px_rgb(12_29_80_/_0.35)]">
          {t('appShell.home.title')}
        </m.h1>
        {liveCount > 0 ? (
          <m.p
            variants={rise}
            initial="hidden"
            animate="shown"
            custom={1}
            className="mt-1.5 text-[0.9375rem] font-medium text-white [text-shadow:0_1px_10px_rgb(12_29_80_/_0.45)]"
          >
            {t('appShell.home.count', { count: liveCount })}
          </m.p>
        ) : null}
      </m.div>
    </section>
  );
}
