// The visitor's address behind Traefik and Cloudflare (lib/clientIp.js,
// 2026-11-17). Traefik replaces any client-sent X-Forwarded-For with the
// address that connected to it (measured with a header echo on the VPS) and
// passes CF-Connecting-IP through untouched, so CF-Connecting-IP may be
// believed only when that connecting address is a Cloudflare edge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { clientIpFromHeaders, isCloudflareIp } from '../../lib/clientIp.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const h = (obj) => new Headers(obj);

test('Cloudflare ranges match their edges and nothing else', () => {
  for (const ip of ['173.245.48.1', '104.16.0.1', '172.71.255.254', '162.159.24.201', '2606:4700::6810:84e5', '2a06:98c7:ffff::1', '::ffff:104.16.0.1']) {
    assert.equal(isCloudflareIp(ip), true, ip);
  }
  for (const ip of ['148.230.124.207', '172.16.1.1', '41.243.0.1', '104.32.0.1', '2a02:4780:35:bd89::1', '', 'garbage', '300.1.1.1', '1::2::3']) {
    assert.equal(isCloudflareIp(ip), false, ip);
  }
});

test('a direct visitor is the address Traefik saw, whatever headers it forged', () => {
  assert.equal(clientIpFromHeaders(h({ 'x-forwarded-for': '41.243.10.20', 'x-real-ip': '41.243.10.20' })), '41.243.10.20');
  // Not from Cloudflare: a forged CF-Connecting-IP is ignored.
  assert.equal(clientIpFromHeaders(h({ 'x-forwarded-for': '41.243.10.20', 'cf-connecting-ip': '7.7.7.7' })), '41.243.10.20');
});

test('through Cloudflare, the visitor is CF-Connecting-IP', () => {
  assert.equal(clientIpFromHeaders(h({ 'x-forwarded-for': '172.70.1.2', 'cf-connecting-ip': '41.243.10.20' })), '41.243.10.20');
  assert.equal(clientIpFromHeaders(h({ 'x-forwarded-for': '2a06:98c0::5', 'cf-connecting-ip': '2c0f:f4c0::1' })), '2c0f:f4c0::1');
  // Should Traefik ever be told to trust Cloudflare, it appends the edge last.
  assert.equal(clientIpFromHeaders(h({ 'x-forwarded-for': '6.6.6.6, 41.243.10.20, 172.70.1.2', 'cf-connecting-ip': '41.243.10.20' })), '41.243.10.20');
  // A Cloudflare hop with no usable visitor header falls back to the edge.
  assert.equal(clientIpFromHeaders(h({ 'x-forwarded-for': '172.70.1.2', 'cf-connecting-ip': 'nonsense' })), '172.70.1.2');
});

test('no headers is null, never a throw', () => {
  assert.equal(clientIpFromHeaders(h({})), null);
  assert.equal(clientIpFromHeaders(null), null);
  assert.equal(clientIpFromHeaders({ get() { throw new Error('boom'); } }), null);
  assert.equal(clientIpFromHeaders(h({ 'x-real-ip': '41.243.10.20' })), '41.243.10.20');
});

test('every reader of the visitor address goes through lib/clientIp.js', () => {
  for (const file of ['lib/adminAudit.js', 'lib/agentLoginLog.js', 'lib/eventIngest.js', 'lib/salesReferral.js', 'app/admin/impersonation/actions.js', 'app/admin/login/actions.js']) {
    const source = read(file);
    assert.match(source, /clientIpFromHeaders\(/, file);
    assert.doesNotMatch(source, /x-forwarded-for/i, `${file} reads the header itself`);
  }
});
