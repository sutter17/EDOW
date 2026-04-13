const GCAL_ICS_URL =
  'https://calendar.google.com/calendar/ical/dcepiscopalfellowship%40gmail.com/public/basic.ics';

exports.handler = async function () {
  try {
    const res = await fetch(GCAL_ICS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Invalid ICS');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
      body: text,
    };
  } catch (err) {
    return { statusCode: 502, body: err.message };
  }
};
