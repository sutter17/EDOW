const { getStore } = require('@netlify/blobs');

exports.handler = async function (event) {
  const secret = process.env.LOGS_SECRET;
  const provided =
    event.queryStringParameters?.key || event.headers['x-logs-key'];

  if (secret && provided !== secret) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  try {
    const store = getStore('click-logs');
    const { blobs } = await store.list();

    const entries = await Promise.all(
      blobs.map(({ key }) => store.get(key, { type: 'json' }))
    );

    // Sort oldest-first by timestamp
    entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const format = event.queryStringParameters?.format;

    if (format === 'csv') {
      const cols = [
        'timestamp', 'slug', 'ip', 'country', 'city', 'subdivision',
        'timezone', 'latitude', 'longitude', 'referrer', 'language',
        'userAgent', 'utm_source', 'utm_medium', 'utm_campaign',
        'utm_content', 'utm_term',
      ];
      const escape = (v) =>
        v == null ? '' : `"${String(v).replace(/"/g, '""')}"`;
      const rows = entries.map((e) =>
        [
          e.timestamp, e.slug, e.ip, e.country, e.city, e.subdivision,
          e.timezone, e.latitude, e.longitude, e.referrer, e.language,
          e.userAgent, e.utm?.source, e.utm?.medium, e.utm?.campaign,
          e.utm?.content, e.utm?.term,
        ].map(escape).join(',')
      );
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="rsvp-clicks.csv"',
        },
        body: [cols.join(','), ...rows].join('\n'),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entries, null, 2),
    };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};
