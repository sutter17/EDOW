const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const store = getStore('site-content');

  if (event.httpMethod === 'GET') {
    try {
      const data = await store.get('main', { type: 'json' });
      return { statusCode: 200, headers: CORS, body: JSON.stringify(data || {}) };
    } catch (_) {
      return { statusCode: 200, headers: CORS, body: '{}' };
    }
  }

  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      const allowed = ['season', 'welcomeHeading', 'welcomeText', 'upcomingIntro', 'dioceseIntro'];
      const clean = {};
      for (const key of allowed) {
        if (typeof body[key] === 'string') clean[key] = body[key];
      }
      await store.setJSON('main', clean);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
    } catch (err) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
};
