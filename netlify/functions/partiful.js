/**
 * Partiful Netlify Function
 *
 * Actions (query string):
 *   GET  ?action=events              → upcoming events (personal feed)
 *   GET  ?action=get&eventId=xxx     → get single event + RSVP counts
 *   POST ?action=create              → create event  (body: event fields)
 *   POST ?action=update&eventId=xxx  → update event on Partiful (body: changed fields)
 *
 * Env vars: PARTIFUL_ACCOUNTS (JSON array) or legacy PARTIFUL_REFRESH_TOKEN + PARTIFUL_USER_ID
 */

const crypto = require('crypto');

const API_BASE       = 'https://api.partiful.com';
const TOKEN_URL      = 'https://securetoken.googleapis.com/v1/token';
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/getpartiful/databases/(default)/documents';
const API_KEY        = process.env.PARTIFUL_API_KEY || 'AIzaSyCky6PJ7cHRdBKk5X7gjuWERWaKWBHr4_k';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// Per-instance token cache keyed by userId
const tokenCache = {};

/* ── Account loading ───────────────────────────────────────── */
function loadAccounts() {
  if (process.env.PARTIFUL_ACCOUNTS) {
    return JSON.parse(process.env.PARTIFUL_ACCOUNTS);
  }
  if (process.env.PARTIFUL_REFRESH_TOKEN && process.env.PARTIFUL_USER_ID) {
    return [{ name: 'Default', userId: process.env.PARTIFUL_USER_ID, refreshToken: process.env.PARTIFUL_REFRESH_TOKEN }];
  }
  throw new Error('No Partiful accounts configured. Set PARTIFUL_ACCOUNTS in env vars.');
}

/* ── Token management ──────────────────────────────────────── */
async function getToken(account) {
  const cache = tokenCache[account.userId];
  if (cache && Date.now() < cache.expiry - 60_000) return cache.token;

  const res = await fetch(`${TOKEN_URL}?key=${API_KEY}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': 'https://partiful.com/' },
    body:    `grant_type=refresh_token&refresh_token=${account.refreshToken}`,
  });

  const data = await res.json();
  if (data.error) throw new Error(`Token refresh failed: ${data.error.message || data.error}`);

  tokenCache[account.userId] = {
    token:  data.id_token,
    expiry: Date.now() + parseInt(data.expires_in, 10) * 1000,
  };
  return data.id_token;
}

/* ── API helpers ───────────────────────────────────────────── */
function makeDeviceId() {
  return crypto.randomBytes(12).toString('base64').replace(/[+/=]/g, '');
}

function wrap(userId, params = {}) {
  return { data: { params, amplitudeSessionId: Date.now(), userId, amplitudeDeviceId: makeDeviceId() } };
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
  if (!res.ok) throw new Error(`Partiful ${endpoint} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function firestorePatch(eventId, updates, token) {
  const fieldMap = {
    title:       v => ({ stringValue: v }),
    location:    v => ({ stringValue: v }),
    description: v => ({ stringValue: v }),
    startDate:   v => ({ timestampValue: new Date(v).toISOString() }),
    endDate:     v => ({ timestampValue: new Date(v).toISOString() }),
  };

  const fields = {};
  const mask   = [];

  for (const [key, value] of Object.entries(updates)) {
    if (fieldMap[key] && value !== undefined && value !== null) {
      fields[key] = fieldMap[key](value);
      mask.push(key);
    }
  }

  if (!mask.length) return {};

  const qs  = mask.map(f => `updateMask.fieldPaths=${f}`).join('&');
  const res = await fetch(`${FIRESTORE_BASE}/events/${eventId}?${qs}`, {
    method:  'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Referer: 'https://partiful.com/' },
    body:    JSON.stringify({ fields }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Firestore PATCH → ${res.status}: ${text}`);
  return JSON.parse(text);
}

/* ── Handler ───────────────────────────────────────────────── */
exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const { action, eventId, account: accountParam } = event.queryStringParameters || {};

  try {
    const accounts = loadAccounts();

    // ── GET account list ───────────────────────────────────
    if (action === 'accounts') {
      return json({ accounts: accounts.map((a, i) => ({ name: a.name, index: i })) });
    }

    // Select account by name or index (defaults to first)
    let account = accounts[0];
    if (accountParam) {
      const lower = accountParam.toLowerCase();
      account = accounts.find(a => a.name.toLowerCase().includes(lower))
             || accounts[parseInt(accountParam, 10)]
             || accounts[0];
    }

    const token = await getToken(account);

    // ── GET upcoming events ────────────────────────────────
    if (action === 'events') {
      const data   = await partifulPost('/getMyUpcomingEventsForHomePage', account.userId, {}, token);
      const events = data?.result?.data?.upcomingEvents || data?.result?.data?.events || [];
      return json({ events: events.map(ev => ({
        id:           ev.id,
        title:        ev.title,
        startDate:    ev.startDate,
        endDate:      ev.endDate,
        location:     ev.location || '',
        going:        ev.guestStatusCounts?.GOING  ?? 0,
        maybe:        ev.guestStatusCounts?.MAYBE  ?? 0,
        url:          `https://partiful.com/e/${ev.id}`,
      })) });
    }

    // ── GET single event (via Firestore) ──────────────────
    if (action === 'get') {
      if (!eventId) return { statusCode: 400, headers: CORS, body: 'Missing eventId' };
      const res  = await fetch(`${FIRESTORE_BASE}/events/${eventId}`, {
        headers: { Authorization: `Bearer ${token}`, Referer: 'https://partiful.com/' },
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Firestore GET → ${res.status}: ${text}`);
      const doc = JSON.parse(text);
      const f   = doc.fields || {};
      const counts = f.guestStatusCounts?.mapValue?.fields || {};
      return json({
        id:          eventId,
        title:       f.title?.stringValue       || '',
        startDate:   f.startDate?.timestampValue || f.startDate?.stringValue,
        endDate:     f.endDate?.timestampValue   || f.endDate?.stringValue,
        location:    f.location?.stringValue     || '',
        description: f.description?.stringValue  || '',
        going:       parseInt(counts.GOING?.integerValue   || 0, 10),
        maybe:       parseInt(counts.MAYBE?.integerValue   || 0, 10),
        declined:    parseInt(counts.DECLINED?.integerValue || 0, 10),
        url:         `https://partiful.com/e/${eventId}`,
      });
    }

    // ── POST create event ──────────────────────────────────
    if (action === 'create') {
      if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Use POST' };
      const fields = JSON.parse(event.body || '{}');

      // Normalize dates to full UTC ISO strings (Partiful requires this)
      if (fields.startDate) fields.startDate = new Date(fields.startDate).toISOString();
      if (fields.endDate)   fields.endDate   = new Date(fields.endDate).toISOString();

      // Automatically add the DCEF org account as cohost
      const ORG_USER_ID = process.env.PARTIFUL_ORG_USER_ID || 'TdAJl2k33LHLrWpyeNeC';
      const cohostIds = [ORG_USER_ID].filter(id => id !== account.userId);

      const data = await partifulPost('/createEvent', account.userId, { event: fields, cohostIds }, token);
      console.log('[partiful create] raw response:', JSON.stringify(data));

      // Try every known path for the event ID
      const newId =
        data?.result?.data?.eventId  ||
        data?.result?.data?.event?.id ||
        data?.data?.eventId           ||
        data?.data?.event?.id         ||
        data?.eventId                 ||
        data?.id;

      return json({ eventId: newId, url: `https://partiful.com/e/${newId}`, _raw: data });
    }

    // ── POST update event ──────────────────────────────────
    if (action === 'update') {
      if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Use POST' };
      if (!eventId) return { statusCode: 400, headers: CORS, body: 'Missing eventId' };
      const updates = JSON.parse(event.body || '{}');
      await firestorePatch(eventId, updates, token);
      return json({ ok: true });
    }

    return { statusCode: 400, headers: CORS, body: 'Unknown action. Use: events, get, create, update' };
  } catch (err) {
    console.error('[partiful]', err.message);
    return { statusCode: 500, headers: CORS, body: err.message };
  }
};

function json(data) {
  return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}
