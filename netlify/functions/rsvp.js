const { getStore } = require('@netlify/blobs');

const GCAL_ICS_URL =
  'https://calendar.google.com/calendar/ical/dcepiscopalfellowship%40gmail.com/public/basic.ics';

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function extractRsvpUrl(description) {
  if (!description) return null;
  const match = description.match(/RSVP:\s*<a[^>]+href="([^"]+)"/i);
  return match ? match[1] : null;
}

function parseEvents(icsText) {
  const unfolded = icsText.replace(/\r?\n[ \t]/g, '');
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  const events = [];

  for (const block of blocks) {
    const get = (key) => {
      const m = block.match(new RegExp(`^${key}(?:;[^:\\r\\n]*)?:(.+)$`, 'm'));
      return m ? m[1].trim() : '';
    };

    const summary = get('SUMMARY')
      .replace(/\\,/g, ',')
      .replace(/\\n/g, ' ')
      .replace(/\\\\/g, '\\');
    const description = get('DESCRIPTION')
      .replace(/\\n/g, '\n')
      .replace(/\\,/g, ',')
      .replace(/\\\\/g, '\\');

    const rsvpUrl = extractRsvpUrl(description);
    if (summary && rsvpUrl) {
      events.push({ summary, slug: slugify(summary), rsvpUrl });
    }
  }

  return events;
}

function buildLogEntry(event, slug) {
  const h = event.headers || {};
  const q = event.queryStringParameters || {};

  let geo = {};
  try { geo = JSON.parse(h['x-nf-geo'] || '{}'); } catch (_) {}

  return {
    timestamp: new Date().toISOString(),
    slug,
    ip: h['x-forwarded-for']?.split(',')[0]?.trim() || h['client-ip'] || null,
    userAgent: h['user-agent'] || null,
    referrer: h['referer'] || h['referrer'] || null,
    language: h['accept-language']?.split(',')[0] || null,
    country: geo.country?.code || h['x-country'] || null,
    city: geo.city || null,
    subdivision: geo.subdivision?.code || null,
    timezone: geo.timezone || null,
    latitude: geo.latitude || null,
    longitude: geo.longitude || null,
    utm: {
      source: q.utm_source || null,
      medium: q.utm_medium || null,
      campaign: q.utm_campaign || null,
      content: q.utm_content || null,
      term: q.utm_term || null,
    },
  };
}

exports.handler = async function (event) {
  const slug = event.queryStringParameters?.slug || '';

  if (!slug) {
    return { statusCode: 302, headers: { Location: '/' } };
  }

  const logEntry = buildLogEntry(event, slug);
  const logKey = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;

  // Fetch ICS and write log in parallel
  const [icsResult] = await Promise.all([
    fetch(GCAL_ICS_URL)
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .catch(() => null),
    getStore('click-logs').setJSON(logKey, logEntry).catch(() => {}),
  ]);

  if (icsResult) {
    const events = parseEvents(icsResult);
    const matched = events.find((e) => e.slug === slug);
    if (matched) {
      return { statusCode: 302, headers: { Location: matched.rsvpUrl } };
    }
  }

  return { statusCode: 302, headers: { Location: '/' } };
};
