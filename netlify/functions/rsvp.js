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

exports.handler = async function (event) {
  const slug = event.queryStringParameters?.slug || '';

  if (!slug) {
    return { statusCode: 302, headers: { Location: '/' } };
  }

  try {
    const res = await fetch(GCAL_ICS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    const events = parseEvents(text);
    const matched = events.find((e) => e.slug === slug);

    if (matched) {
      return {
        statusCode: 302,
        headers: { Location: matched.rsvpUrl },
      };
    }

    return { statusCode: 302, headers: { Location: '/' } };
  } catch (_err) {
    return { statusCode: 302, headers: { Location: '/' } };
  }
};
