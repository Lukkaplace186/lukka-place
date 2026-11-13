// Motion's layout features (shared-element "layoutId" animations), loaded by
// LazyMotion in GuideCards only after the page is interactive, so /guides'
// first paint never waits for them.
import { domMax } from 'motion/react';

export default domMax;
