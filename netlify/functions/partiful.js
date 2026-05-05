/**
 * Partiful Netlify Function
 *
 * Actions (via query string):
 *   GET  ?action=events   → upcoming events
 *   GET  ?action=past     → past events
 *   POST ?action=create   → create event  (JSON body: event fields)
 *
 * Required env vars: PARTIFUL_API_KEY, PARTIFUL_REFRESH_TOKEN, PARTIFUL_USER_ID
 */

const crypto = require('crypto');

const API_BASE  = 'https://api.partiful.com';
const TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// In-memory token cache (lives for the duration of the function instance)
let cachedToken  = null;
let tokenExpiry  = 0;

/* ── Token management ──────────────────────────────────────── */
async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60_000) return cachedToken;

  const res = await fetch(`${TOKEN_URL}?key=${process.env.PARTIFUL_API_KEY}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': 'https://partiful.com/' },
    body:    `grant_type=refresh_token&refresh_token=${process.env.PARTIFUL_REFRESH_TOKEN}`,
  });

  const data = await res.json();
  if (data.error) throw new Error(`Token refresh failed: ${data.error.message || data.error}`);

  cachedToken = data.id_token;
  tokenExpiry = Date.now() + parseInt(data.expires_in, 10) * 1000;
  return cachedToken;
}

/* ── API helpers ───────────────────────────────────────────── */
function makeDeviceId() {
  return crypto.randomBytes(12).toString('base64').replace(/[+/=]/g, '');
}

function wrap(params = {}) {
  return {
    data: {
      params,
      amplitudeSessionId: Date.now(),
      userId:             process.env.PARTIFUL_USER_ID,
      amplitudeDeviceId:  makeDeviceId(),
    },
  };
}

async function partifulPost(endpoint, params, token) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method:  'POST',
    headers: {
      Authorization:   `Bearer ${token}`,
      'Content-Type':  'application/json',
      Accept:          'application/json, text/plain, */*',
      Origin:          'https://partiful.com',
      Referer:         'https://partiful.com/',
    },
    body: JSON.stringify(wrap(params)),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Partiful ${endpoint} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

/* ── Handler ───────────────────────────────────────────────── */
exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const { action } = event.queryStringParameters || {};

  try {
    const token = await getToken();

    // GET ?action=events — upcoming events
    if (action === 'events') {
      const data = await partifulPost('/getMyUpcomingEventsForHomePage', {}, token);
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      };
    }

    // GET ?action=past — past events
    if (action === 'past') {
      const data = await partifulPost('/getMyPastEventsForHomePage', {}, token);
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      };
    }

    // POST ?action=create — create a new event
    if (action === 'create') {
      if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: CORS, body: 'Use POST for create' };
      }
      const eventFields = JSON.parse(event.body || '{}');
      const data = await partifulPost('/createEvent', { event: eventFields }, token);
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      };
    }

    return { statusCode: 400, headers: CORS, body: 'Unknown action. Use: events, past, create' };
  } catch (err) {
    console.error('[partiful]', err.message);
    return { statusCode: 500, headers: CORS, body: err.message };
  }
};
