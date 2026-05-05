#!/usr/bin/env node
/**
 * Partiful local script — for testing and one-off operations.
 * Reads credentials from .env in the project root.
 *
 * Usage:
 *   node scripts/partiful.js test           — verify auth works
 *   node scripts/partiful.js events         — list upcoming events
 *   node scripts/partiful.js past           — list past events
 *   node scripts/partiful.js create         — create a test event (dry run by default)
 *   node scripts/partiful.js create --live  — actually create the event
 */

require('dotenv').config();
const crypto = require('crypto');

const API_BASE  = 'https://api.partiful.com';
const TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';

const { PARTIFUL_API_KEY, PARTIFUL_REFRESH_TOKEN, PARTIFUL_USER_ID } = process.env;
const PARTIFUL_ORG_USER_ID = process.env.PARTIFUL_ORG_USER_ID || 'TdAJl2k33LHLrWpyeNeC';
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/getpartiful/databases/(default)/documents';

function checkEnv() {
  const missing = ['PARTIFUL_API_KEY', 'PARTIFUL_REFRESH_TOKEN', 'PARTIFUL_USER_ID']
    .filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`❌ Missing env vars: ${missing.join(', ')}`);
    console.error('   Copy .env.example → .env and fill in your values.');
    process.exit(1);
  }
}

/* ── Token ─────────────────────────────────────────────────── */
async function getToken() {
  console.log('🔑 Refreshing Partiful token…');
  const res = await fetch(`${TOKEN_URL}?key=${PARTIFUL_API_KEY}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': 'https://partiful.com/' },
    body:    `grant_type=refresh_token&refresh_token=${PARTIFUL_REFRESH_TOKEN}`,
  });

  const data = await res.json();
  if (data.error) throw new Error(`Token refresh failed: ${data.error.message || data.error}`);

  const expiresAt = new Date(Date.now() + parseInt(data.expires_in, 10) * 1000);
  console.log(`✅ Token valid until ${expiresAt.toLocaleTimeString()}\n`);
  return data.id_token;
}

/* ── API ───────────────────────────────────────────────────── */
function makeDeviceId() {
  return crypto.randomBytes(12).toString('base64').replace(/[+/=]/g, '');
}

function wrap(params = {}) {
  return {
    data: {
      params,
      amplitudeSessionId: Date.now(),
      userId:             PARTIFUL_USER_ID,
      amplitudeDeviceId:  makeDeviceId(),
    },
  };
}

async function partifulPost(endpoint, params, token) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept:         'application/json, text/plain, */*',
      Origin:         'https://partiful.com',
      Referer:        'https://partiful.com/',
    },
    body: JSON.stringify(wrap(params)),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`${endpoint} → HTTP ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

/* ── Commands ──────────────────────────────────────────────── */
async function cmdTest() {
  await getToken();
  console.log('✅ Auth is working. Your refresh token is valid.');
}

async function cmdEvents(token) {
  console.log('📅 Fetching upcoming events…\n');
  const data = await partifulPost('/getMyUpcomingEventsForHomePage', {}, token);
  const events = data?.result?.data?.upcomingEvents || data?.result?.data?.events || data?.data?.events || [];

  if (!events.length) {
    console.log('No upcoming events found.');
    return;
  }

  console.log(`Found ${events.length} events:\n`);
  events.forEach(ev => {
    const start   = ev.startDate ? new Date(ev.startDate).toLocaleString() : 'TBD';
    const isOwner = (ev.ownerIds || []).includes(PARTIFUL_USER_ID);
    console.log(`${isOwner ? '★' : '·'} ${ev.title}`);
    console.log(`  Date:     ${start}`);
    console.log(`  Owner:    ${(ev.ownerIds || []).join(', ')}`);
    console.log(`  URL:      https://partiful.com/e/${ev.id}`);
    console.log(`  Going:    ${ev.guestStatusCounts?.GOING ?? '?'}`);
    console.log();
  });
}

async function cmdPast(token) {
  console.log('📅 Fetching past events…\n');
  const data = await partifulPost('/getMyPastEventsForHomePage', {}, token);
  const events = data?.result?.data?.upcomingEvents || data?.result?.data?.events || data?.data?.events || [];

  if (!events.length) {
    console.log('No past events found.');
    return;
  }

  events.forEach(ev => {
    const start = ev.startDate ? new Date(ev.startDate).toLocaleString() : 'TBD';
    console.log(`• ${ev.title}  (${start})  — ID: ${ev.id}`);
  });
}

async function cmdOrgEvents(token, past = false) {
  const now = new Date().toISOString();
  console.log(`📅 Fetching ${past ? 'past' : 'upcoming'} DCEF events from Firestore…\n`);

  const query = {
    structuredQuery: {
      from: [{ collectionId: 'events' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: 'ownerIds' },
                op: 'ARRAY_CONTAINS',
                value: { stringValue: PARTIFUL_ORG_USER_ID },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: 'startDate' },
                op: past ? 'LESS_THAN' : 'GREATER_THAN_OR_EQUAL',
                value: { timestampValue: now },
              },
            },
          ],
        },
      },
      orderBy: [{ field: { fieldPath: 'startDate' }, direction: past ? 'DESCENDING' : 'ASCENDING' }],
      limit: 50,
    },
  };

  const res = await fetch(`${FIRESTORE_BASE}:runQuery`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      Referer:        'https://partiful.com/',
    },
    body: JSON.stringify(query),
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
      going:     f.guestStatusCounts?.mapValue?.fields?.GOING?.integerValue ?? '?',
    };
  });

  if (!events.length) { console.log('No events found.'); return; }

  events.forEach(ev => {
    const start = ev.startDate ? new Date(ev.startDate).toLocaleString() : 'TBD';
    console.log(`• ${ev.title}`);
    console.log(`  Date:     ${start}`);
    console.log(`  Location: ${ev.location || '—'}`);
    console.log(`  Going:    ${ev.going}`);
    console.log(`  URL:      https://partiful.com/e/${ev.id}`);
    console.log();
  });
}

async function cmdCreate(token, live) {
  // Sample event — edit these fields as needed
  const testEvent = {
    title:       'Test Event (delete me)',
    startDate:   new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 1 week from now
    endDate:     new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
    location:    'Washington, DC',
    description: 'Created by DCEF admin script.',
    visibility:  'PRIVATE',
  };

  console.log('📝 Event to create:');
  console.log(JSON.stringify(testEvent, null, 2));
  console.log();

  if (!live) {
    console.log('ℹ️  Dry run — pass --live to actually create this event.');
    return;
  }

  console.log('🚀 Creating event on Partiful…');
  const data = await partifulPost('/createEvent', { event: testEvent }, token);
  const id   = data?.result?.data?.eventId || data?.data?.eventId || '(unknown)';
  console.log(`✅ Event created! https://partiful.com/e/${id}`);
}

/* ── Main ──────────────────────────────────────────────────── */
async function main() {
  checkEnv();

  const [,, cmd, ...flags] = process.argv;
  const live = flags.includes('--live');

  if (!cmd || cmd === 'test') {
    await cmdTest();
    return;
  }

  const token = await getToken();

  if (cmd === 'events')     return cmdEvents(token);
  if (cmd === 'past')       return cmdPast(token);
  if (cmd === 'org-events') return cmdOrgEvents(token, false);
  if (cmd === 'org-past')   return cmdOrgEvents(token, true);
  if (cmd === 'create')     return cmdCreate(token, live);

  console.error(`Unknown command: ${cmd}`);
  console.error('Usage: node scripts/partiful.js [test|events|past|create [--live]]');
  process.exit(1);
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
