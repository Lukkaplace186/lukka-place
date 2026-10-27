'use client';

import { useEffect, useRef } from 'react';
import { rememberInviteAction } from './actions';

/** Once per page load: remembers the inviting partner (see ./actions.js). Renders nothing. */
export default function RememberInvite({ code }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    rememberInviteAction(code).catch(() => {});
  }, [code]);
  return null;
}
