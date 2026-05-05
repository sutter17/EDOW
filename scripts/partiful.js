#!/usr/bin/env node
/**
 * Partiful local script
 *
 * Accounts are stored in PARTIFUL_ACCOUNTS as a JSON array:
 *   [{ "name": "DCEF Org", "userId": "...", "refreshToken": "..." }, ...]
 *
 * Usage:
 *   node scripts/partiful.js accounts                                  — list configured accounts
 *   node scripts/partiful.js test [--account <name>]                   — verify auth
 *   node scripts/partiful.js events [--account <name>]                 — upcoming events for account
 *   node scripts/partiful.js org-events                                — all DCEF org events (needs org account)
 *   node scripts/partiful.js add-cohost <eventId> <userId> --account <name>  — add cohost to event
 *   node scripts/partiful.js create [--account <name>] [--live]        — create test event
 */

require('dotenv').config();
const crypto = require('crypto');

const API_BASE       = 'https://api.partiful.com';
const TOKEN_URL      = 'https://securetoken.googleapis.com/v1/token';
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/getpartiful/databases/(default)/documents';
const API_KEY        = process.env.PARTIFUL_API_KEY || 'AIzaSyCky6PJ7cHRdBKk5X7gjuWERWaKWBHr4_k';
const ORG_USER_ID    = process.env.PARTIFUL_ORG_USER_ID || 'TdAJl2k33LHLrWpyeNeC';

/* ── Account management ────────────────────────────────────── */
function loadAccounts() {
  // New multi-account format
  if (process.env.PARTIFUL_ACCOUNTS) {
    try {
      return JSON.parse(process.env.PARTIFUL_ACCOUNTS);
    } catch {
      console.error('❌ PARTIFUL_ACCOUNTS is not valid JSON.');
      process.exit(1);
    }
  }

  // Fall back to legacy single-account env vars
  if (process.env.PARTIFUL_REFRESH_TOKEN && process.env.PARTIFUL_USER_ID) {
    return [{
      name:         'Default',
      userId:       process.env.PARTIFUL_USER_ID,
      refreshToken: process.env.PARTIFUL_REFRESH_TOKEN,
    }];
  }

  console.error('❌ No Partiful accounts configured.');
  console.error('   Set PARTIFUL_ACCOUNTS in your .env file.');
  process.exit(1);
}

function selectAccount(accounts, nameOrIndex) {
  if (!nameOrIndex) return accounts[0];
  const lower = nameOrIndex.toLowerCase();
  // Match by name (case-insensitive) or index
  const byName  = accounts.find(a => a.name.toLowerCase().includes(lower));
  const byIndex = accounts[parseInt(nameOrIndex, 10)];
  const account = byName || byIndex;
  if (!account) {
    console.error(`❌ No account matching "${nameOrIndex}". Run "accounts" to see options.`);
    process.exit(1);
  }
  return account;
}

function parseFlags(flags) {
  const result = { account: null, live: false };
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--account' && flags[i + 1]) {
      result.account = flags[i + 1]; i++;
    }
    if (flags[i] === '--live') result.live = true;
  }
  return result;
}

/* ── Token ─────────────────────────────────────────────────── */
async function getToken(account) {
  console.log(`🔑 Refreshing token for "${account.name}"…`);
  const res = await fetch(`${TOKEN_URL}?key=${API_KEY}`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer':      'https://partiful.com/',
    },
    body: `grant_type=refresh_token&refresh_token=${account.refreshToken}`,
  });

  const data = await res.json();
  if (data.error) throw new Error(`Token refresh failed: ${data.error.message || data.error}`);

  const expiresAt = new Date(Date.now() + parseInt(data.expires_in, 10) * 1000);
  console.log(`✅ Token valid until ${expiresAt.toLocaleTimeString()}\n`);
  return { token: data.id_token, userId: account.userId };
}

/* ── API helpers ───────────────────────────────────────────── */
function makeDeviceId() {
  return crypto.randomBytes(12).toString('base64').replace(/[+/=]/g, '');
}

function wrap(userId, params = {}) {
  return {
    data: {
      params,
      amplitudeSessionId: Date.now(),
      userId,
      amplitudeDeviceId: makeDeviceId(),
    },
  };
}

async function partifulPost(endpoint, userId, params, token) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept:         'application/json, text/plain, */*',
      Origin:         'https://partiful.com',
      Referer:        'https://partiful.com/',
    },
    body: JSON.stringify(wrap(userId, params)),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`${endpoint} → HTTP ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function firestoreGet(path, token) {
  const res = await fetch(`${FIRESTORE_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Referer: 'https://partiful.com/' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Firestore GET failed (${res.status}): ${text}`);
  return JSON.parse(text);
}

async function firestorePatch(path, fields, updateMaskFields, token) {
  const mask = updateMaskFields.map(f => `updateMask.fieldPaths=${f}`).join('&');
  const res  = await fetch(`${FIRESTORE_BASE}/${path}?${mask}`, {
    method:  'PATCH',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      Referer:        'https://partiful.com/',
    },
    body: JSON.stringify({ fields }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Firestore PATCH failed (${res.status}): ${text}`);
  return JSON.parse(text);
}

/* ── Commands ──────────────────────────────────────────────── */
function cmdAccounts(accounts) {
  console.log(`${accounts.length} account(s) configured:\n`);
  accounts.forEach((a, i) => {
    const hasToken = a.refreshToken ? '✅' : '❌ no token';
    console.log(`  [${i}] ${a.name}  (${a.userId})  ${hasToken}`);
  });
  console.log();
  console.log('Use --account <name or index> to select one.');
}

async function cmdTest(account) {
  await getToken(account);
  console.log(`✅ "${account.name}" auth is working.`);
}

async function cmdEvents(account) {
  const { token, userId } = await getToken(account);
  console.log('📅 Fetching upcoming events…\n');
  const data   = await partifulPost('/getMyUpcomingEventsForHomePage', userId, {}, token);
  const events = data?.result?.data?.upcomingEvents || data?.result?.data?.events || [];

  if (!events.length) { console.log('No upcoming events found.'); return; }

  console.log(`Found ${events.length} event(s):\n`);
  events.forEach(ev => {
    const start   = ev.startDate ? new Date(ev.startDate).toLocaleString() : 'TBD';
    const isOwner = (ev.ownerIds || []).includes(userId);
    console.log(`${isOwner ? '★' : '·'} ${ev.title}`);
    console.log(`  Date:  ${start}`);
    console.log(`  ID:    ${ev.id}`);
    console.log(`  URL:   https://partiful.com/e/${ev.id}`);
    console.log(`  Going: ${ev.guestStatusCounts?.GOING ?? '?'}`);
    console.log();
  });
}

async function cmdOrgEvents(account) {
  const { token } = await getToken(account);
  const now = new Date().toISOString();
  console.log('📅 Fetching upcoming DCEF org events…\n');

  const query = {
    structuredQuery: {
      from: [{ collectionId: 'events' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'ownerIds' }, op: 'ARRAY_CONTAINS', value: { stringValue: ORG_USER_ID } } },
            { fieldFilter: { field: { fieldPath: 'startDate' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: now } } },
          ],
        },
      },
      orderBy: [{ field: { fieldPath: 'startDate' }, direction: 'ASCENDING' }],
      limit: 50,
    },
  };

  const res  = await fetch(`${FIRESTORE_BASE}:runQuery`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Referer: 'https://partiful.com/' },
    body:    JSON.stringify(query),
  });
  const rows = await res.json();
  if (!res.ok) throw new Error(`Firestore query failed: ${JSON.stringify(rows)}`);

  const events = rows.filter(r => r.document).map(r => {
    const f = r.document.fields;
    return {
      id:        r.document.name.split('/').pop(),
      title:     f.title?.stringValue || '(no title)',
      startDate: f.startDate?.timestampValue || f.startDate?.stringValue,
      location:  f.location?.stringValue || '',
      ownerIds:  f.ownerIds?.arrayValue?.values?.map(v => v.stringValue) || [],
    };
  });

  if (!events.length) { console.log('No events found.'); return; }

  events.forEach(ev => {
    const start = ev.startDate ? new Date(ev.startDate).toLocaleString() : 'TBD';
    console.log(`• ${ev.title}`);
    console.log(`  Date:    ${start}`);
    console.log(`  ID:      ${ev.id}`);
    console.log(`  Owners:  ${ev.ownerIds.join(', ')}`);
    console.log(`  URL:     https://partiful.com/e/${ev.id}`);
    console.log();
  });
}

async function cmdAddCohost(account, eventId, newUserId) {
  if (!eventId || !newUserId) {
    console.error('Usage: add-cohost <eventId> <userId> --account <name>');
    process.exit(1);
  }

  const { token } = await getToken(account);
  console.log(`🔍 Fetching event ${eventId}…`);

  // Get current event to read existing ownerIds
  const doc      = await firestoreGet(`events/${eventId}`, token);
  const existing = doc.fields?.ownerIds?.arrayValue?.values?.map(v => v.stringValue) || [];
  const title    = doc.fields?.title?.stringValue || eventId;

  if (existing.includes(newUserId)) {
    console.log(`ℹ️  ${newUserId} is already a cohost on "${title}".`);
    return;
  }

  const updated = [...existing, newUserId];
  console.log(`➕ Adding ${newUserId} to "${title}"…`);
  console.log(`   Current owners: ${existing.join(', ')}`);
  console.log(`   New owners:     ${updated.join(', ')}\n`);

  await firestorePatch(
    `events/${eventId}`,
    { ownerIds: { arrayValue: { values: updated.map(id => ({ stringValue: id })) } } },
    ['ownerIds'],
    token,
  );

  console.log(`✅ Done! ${newUserId} is now a cohost on "${title}".`);
  console.log(`   https://partiful.com/e/${eventId}`);
}

async function cmdCreate(account, live) {
  const { token, userId } = await getToken(account);
  const testEvent = {
    title:       'Test Event (delete me)',
    startDate:   new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    endDate:     new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
    location:    'Washington, DC',
    description: 'Created by DCEF admin script.',
    visibility:  'PRIVATE',
  };

  console.log('📝 Event to create:');
  console.log(JSON.stringify(testEvent, null, 2));

  if (!live) {
    console.log('\nℹ️  Dry run — pass --live to actually create this event.');
    return;
  }

  const data = await partifulPost('/createEvent', userId, { event: testEvent }, token);
  const id   = data?.result?.data?.eventId || data?.data?.eventId || '(unknown)';
  console.log(`✅ Event created! https://partiful.com/e/${id}`);
}

/* ── Main ──────────────────────────────────────────────────── */
async function main() {
  const accounts = loadAccounts();
  const [,, cmd, ...rest] = process.argv;

  if (!cmd || cmd === 'accounts') { cmdAccounts(accounts); return; }

  const flags   = parseFlags(rest);
  const account = selectAccount(accounts, flags.account);

  if (cmd === 'test')       return cmdTest(account);
  if (cmd === 'events')     return cmdEvents(account);
  if (cmd === 'org-events') return cmdOrgEvents(account);
  if (cmd === 'create')     return cmdCreate(account, flags.live);

  if (cmd === 'add-cohost') {
    const [eventId, userId] = rest.filter(a => !a.startsWith('--'));
    return cmdAddCohost(account, eventId, userId);
  }

  if (cmd === 'cancel') {
    const [eventId] = rest.filter(a => !a.startsWith('--'));
    if (!eventId) { console.error('Usage: cancel <eventId>'); process.exit(1); }
    const { token, userId } = await getToken(account);
    console.log(`🗑  Cancelling event ${eventId}…`);
    const data = await partifulPost('/cancelEvent', userId, { eventId }, token);
    console.log('✅ Event cancelled.', JSON.stringify(data));
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  console.error('Commands: accounts, test, events, org-events, add-cohost, create');
  process.exit(1);
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
