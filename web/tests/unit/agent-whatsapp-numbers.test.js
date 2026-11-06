// Extra WhatsApp numbers on an agent (2026-11-03): agent #50 sent every
// listing from a second SIM and none was attributed. The engine half (the
// match, the claim, the refusals) is pinned by scripts/verify-pipeline.js §68;
// this pins the console: the form, the wording, and that it stays admin-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ADMIN_AGENT_ERROR_KEYS, adminAgentRefusal, parseAgentNumberForm } from '../../lib/adminAgentCreate.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function form(fields) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

test('the number is read in international form; ours and malformed ones are refused before the engine', () => {
  assert.deepEqual(parseAgentNumberForm(form({ phone: '0910 314 309', phoneCountry: 'CD' })), { ok: true, phone: '243910314309' });
  assert.deepEqual(parseAgentNumberForm(form({ phone: '+243 910 314 309' })), { ok: true, phone: '243910314309' });
  assert.equal(parseAgentNumberForm(form({ phone: '12', phoneCountry: 'CD' })).errorKey, ADMIN_AGENT_ERROR_KEYS['phone-invalid']);
  assert.equal(parseAgentNumberForm(form({ phone: '+243 976 321 848' })).errorKey, ADMIN_AGENT_ERROR_KEYS['phone-ours']);
});

test('every engine refusal has words in both languages', () => {
  const t = (key, vars) => `${key}:${vars?.id ?? ''}`;
  assert.equal(adminAgentRefusal(t, { code: 'phone-linked', agentId: 51 }), 'admin.agentNumbers.errorLinked:51');
  for (const lang of ['fr', 'en']) {
    const dict = JSON.parse(read(`lib/i18n/${lang}.json`));
    for (const code of ['phone-own', 'phone-linked', 'numbers-unavailable']) {
      const key = ADMIN_AGENT_ERROR_KEYS[code];
      const value = key.split('.').reduce((node, part) => node?.[part], dict);
      assert.equal(typeof value, 'string', `${lang}: ${key}`);
    }
    for (const key of ['label', 'add', 'warning', 'added', 'removeConfirm', 'noteAdded', 'noteRemoved', 'unavailable']) {
      assert.equal(typeof dict.admin.agentNumbers[key], 'string', `${lang}: admin.agentNumbers.${key}`);
    }
  }
});

test('both actions require agents.manage and record who did it; the engine is reached through adminApi', () => {
  const actions = read('app/admin/agents/[id]/whatsappNumberActions.js');
  assert.match(actions, /^'use server';/);
  assert.match(actions, /export async function addAgentWhatsAppNumberAction[\s\S]*?requireAdmin\('agents\.manage'\)/);
  assert.match(actions, /export async function removeAgentWhatsAppNumberAction[\s\S]*?requireAdmin\('agents\.manage'\)/);
  assert.match(actions, /action: 'agent\.whatsapp_number_add'/);
  assert.match(actions, /action: 'agent\.whatsapp_number_remove'/);
  const api = read('lib/adminApi.js');
  assert.match(api, /\/admin\/agents\/\$\{encodeURIComponent\(agentId\)\}\/whatsapp-numbers`, \{\s*method: 'POST'/);
  assert.match(api, /method: 'DELETE'/);
  const page = read('app/admin/agents/[id]/page.js');
  assert.match(page, /<AgentWhatsAppNumbers[\s\S]*?canManage=\{can\(session\?\.role, 'agents\.manage'\)\}/);
});

test('no public page reaches the linking actions', () => {
  for (const dir of ['app/(site)', 'app/(portfolio)', 'app/api']) {
    const hits = [];
    const walk = (d) => {
      for (const entry of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
        const rel = path.join(d, entry.name);
        if (entry.isDirectory()) walk(rel);
        else if (/\.(js|mjs)$/.test(entry.name) && /whatsappNumberActions|addAgentWhatsAppNumber|removeAgentWhatsAppNumber/.test(read(rel))) hits.push(rel);
      }
    };
    walk(dir);
    assert.deepEqual(hits, [], `${dir} must not reach the number linking`);
  }
});
