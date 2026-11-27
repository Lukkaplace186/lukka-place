/**
 * The visitor's address, behind Traefik and (for lukkaplace.com) Cloudflare.
 *
 * Measured on the VPS 2026-11-17 with a header echo behind Traefik:
 * Traefik trusts no forwarded headers, so it REPLACES any X-Forwarded-For /
 * X-Real-IP a client sends with the address that actually connected to it —
 * one entry, unforgeable. It passes CF-Connecting-IP through untouched, so
 * that header is forgeable by anyone who reaches the server directly.
 *
 * With Cloudflare in front, the connecting address is a Cloudflare edge, the
 * same one for thousands of visitors. Then, and only then, CF-Connecting-IP
 * is the visitor (Cloudflare overwrites whatever the client sent). Reading it
 * whenever present would let a direct request pick its own address and dodge
 * the per-address limits (admin login throttle, referral fraud patterns).
 *
 * Ranges: https://www.cloudflare.com/ips-v4 and /ips-v6, fetched 2026-11-17.
 * Cloudflare rarely changes them; a stale list only means a new edge's
 * visitors are counted under the edge address, never a forged one trusted.
 */

export const CLOUDFLARE_RANGES = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];

/** An address as a BigInt plus its width (32 or 128), or null. */
function parseIp(raw) {
  let ip = String(raw || '').trim();
  if (!ip) return null;
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) ip = mapped[1];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.some((p) => p > 255)) return null;
    return { value: parts.reduce((acc, p) => (acc << 8n) + BigInt(p), 0n), bits: 32 };
  }
  if (!ip.includes(':') || !/^[0-9a-f:]+$/i.test(ip)) return null;
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return { value: groups.reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g, 16)), 0n), bits: 128 };
}

const PARSED_RANGES = CLOUDFLARE_RANGES.map((cidr) => {
  const [base, len] = cidr.split('/');
  const parsed = parseIp(base);
  const shift = BigInt(parsed.bits - Number(len));
  return { bits: parsed.bits, shift, prefix: parsed.value >> shift };
});

export function isCloudflareIp(raw) {
  const ip = parseIp(raw);
  if (!ip) return false;
  return PARSED_RANGES.some((r) => r.bits === ip.bits && (ip.value >> r.shift) === r.prefix);
}

/**
 * The visitor's address from request headers (a Headers object or anything
 * with get()), or null. Never throws.
 */
export function clientIpFromHeaders(headers) {
  const get = (name) => {
    try {
      return headers?.get?.(name) || '';
    } catch {
      return '';
    }
  };
  // Traefik's own entry is the LAST one (and today the only one).
  const hops = get('x-forwarded-for').split(',').map((s) => s.trim()).filter(Boolean);
  const peer = hops[hops.length - 1] || get('x-real-ip').trim();
  if (peer && isCloudflareIp(peer)) {
    const visitor = get('cf-connecting-ip').trim();
    if (parseIp(visitor)) return visitor.slice(0, 64);
  }
  return peer ? peer.slice(0, 64) : null;
}
