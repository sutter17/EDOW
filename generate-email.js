#!/usr/bin/env node
/**
 * generate-email.js
 * Reads events.ics → writes a newsletter email to email-out.html
 *
 * Usage:  node generate-email.js
 *
 * Edit the CONFIG block below to customise each send — hero image,
 * subject line, welcome text, footer, etc.  Everything else is pulled
 * automatically from events.ics (same data as the website).
 */

'use strict';
const fs   = require('fs');
const path = require('path');

/* ═══════════════════════════════════════════════════════════
   CONFIG  — edit these before each send
═══════════════════════════════════════════════════════════ */
const CONFIG = {
  outputFile:  'email-out.html',
  icsFile:     'events.ics',

  // Absolute base URL for images (no trailing slash).
  // If you've moved images to Google Drive, replace individual
  // image values in heroImage / pastEventImages with Drive URLs.
  siteBaseUrl: 'https://edow.netlify.app',

  // Hero image shown at the top of the email
  heroImage:   'images/242e9a9fc21b5f936f40236a56e20ac2.jpg',

  // Season / edition label
  season: 'Spring 2026',

  // Opening welcome paragraph
  welcomeText: 'As we enter the seasons of Easter and spring, everything is blooming. '
             + 'We celebrate the joy of the resurrection as our world wakes up from its winter slumber. '
             + 'Please join us for our spring events, filled with faith, fellowship, and lots of fun!',

  // Upcoming events section intro
  upcomingIntro: 'This spring, we have a full calendar of fun events! From baseball to scavenger hunts, '
               + 'we hope you will join us as we come together in this season of joy and community. '
               + 'You can find all of the information for all of our events on the '
               + '<a href="https://www.instagram.com/dc_episcopal_fellowship/" style="color:#1a62ff">DCEF Instagram</a> '
               + 'or <a href="https://partiful.com/u/TdAJl2k33LHLrWpyeNeC" style="color:#1a62ff">Partiful</a>!',

  // Diocese section intro
  dioceseIntro: 'We are also partnering with other organizations to host and spread word of events '
              + 'young adults in the diocese might be interested in. If you have any ideas of events '
              + 'you know about or are hosting please share it with us using '
              + '<a href="https://forms.gle/epcKDnZ1tQeatfwU9" style="color:#1a62ff">this form</a>!',

  footerText: 'Forwarded this email? Email '
            + '<a href="mailto:dcepiscopalfellowship@gmail.com" style="color:#ffffff">dcepiscopalfellowship@gmail.com</a>'
            + ' to get on the email list!',
};

/* ═══════════════════════════════════════════════════════════
   COLOUR / STYLE CONSTANTS  (mirror the website's CSS vars)
═══════════════════════════════════════════════════════════ */
const C = {
  navy:   '#00277d',
  blue:   '#1a62ff',
  cream:  '#faf3eb',
  sand:   '#e9ddcd',
  brown:  '#47342b',
  page:   '#f0f1f5',
  border: '#ddd0be',
  white:  '#ffffff',
  diocese:'#5a8a5a',
};

const FONT_HEADING = '"League Spartan", Arial, Helvetica, sans-serif';
const FONT_BODY    = 'Verdana, Geneva, sans-serif';

/* ═══════════════════════════════════════════════════════════
   DATE HELPERS
═══════════════════════════════════════════════════════════ */
const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];
const DAY_NAMES   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function parseDt(s) {
  const c = s.replace('Z', '');
  const y = +c.substr(0,4), mo = +c.substr(4,2)-1, d = +c.substr(6,2);
  const h = c.length > 8 ? +c.substr(9,2) : 0;
  const m = c.length > 11 ? +c.substr(11,2) : 0;
  return new Date(y, mo, d, h, m);
}

function formatTime(date) {
  let h = date.getHours(), m = date.getMinutes();
  const ap = h >= 12 ? 'p.m.' : 'a.m.';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2,'0')} ${ap}`;
}

function formatDateMeta(date, hasTime, location) {
  const parts = [`${DAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`];
  if (hasTime) parts.push(formatTime(date));
  if (location) parts.push(location);
  return parts.join(' &bull; ');
}

/* ═══════════════════════════════════════════════════════════
   ICS PARSER  (same logic as the website)
═══════════════════════════════════════════════════════════ */
function unescapeICS(s) {
  return s.replace(/\\n/g,'\n').replace(/\\,/g,',').replace(/\\;/g,';').replace(/\\\\/g,'\\');
}

function parseICS(text) {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const lines    = unfolded.split(/\r?\n/);
  const events   = [];
  let ev         = null;

  for (const raw of lines) {
    const ci = raw.indexOf(':');
    if (ci === -1) continue;
    const keyFull = raw.slice(0, ci).trim();
    const val     = raw.slice(ci + 1);
    const key     = keyFull.split(';')[0].toUpperCase();
    const params  = keyFull.includes(';') ? keyFull.slice(keyFull.indexOf(';') + 1).toUpperCase() : '';

    if (key === 'BEGIN' && val.trim() === 'VEVENT') { ev = {}; continue; }
    if (key === 'END'   && val.trim() === 'VEVENT') { if (ev) events.push(ev); ev = null; continue; }
    if (!ev) continue;

    const v = unescapeICS(val.trim());
    switch (key) {
      case 'SUMMARY':     ev.summary     = v; break;
      case 'DESCRIPTION': ev.description = v; break;
      case 'LOCATION':    ev.location    = v; break;
      case 'URL':         ev.url         = v; break;
      case 'CATEGORIES':  ev.categories  = v.toUpperCase().split(',').map(s => s.trim()); break;
      case 'X-IMAGE':     ev.image       = v; break;
      case 'DTSTART': {
        const isDateOnly = params.includes('VALUE=DATE') || !val.includes('T');
        ev.dtstart = parseDt(val.trim());
        ev.hasTime = !isDateOnly;
        break;
      }
    }
  }

  events.forEach(processEvent);
  return events;
}

function processEvent(ev) {
  const raw = ev.description || '';

  if (!ev.url) {
    const m = raw.match(/RSVP:\s*<a[^>]+href="([^"]+)"/i)
               || raw.match(/RSVP:\s*(https?:\/\/[^\s<"]+)/i);
    if (m) ev.url = m[1];
  }

  let desc = raw.replace(/<[^>]+>/g, '');
  desc = desc.replace(/&quot;/g,'"').replace(/&amp;/g,'&')
             .replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');

  if (!ev.image) {
    desc = desc.replace(/\[image:\s*"?([^"\]\n]+?)"?\s*\]/gi, (_, p) => {
      const p2 = p.trim();
      ev.image = p2.includes('/') ? p2 : 'images/' + p2;
      return '';
    });
  }

  desc = desc.replace(/RSVP:\s*[^\n]*/gi, '');

  const tagCategories = [];
  desc = desc.replace(/#(DIOCESE)\b/gi, (_, c) => { tagCategories.push(c.toUpperCase()); return ''; });

  ev.description = desc.replace(/\n{3,}/g, '\n\n').trim();

  if (!ev.categories || !ev.categories.length) {
    const today = new Date(); today.setHours(0,0,0,0);
    ev.categories = tagCategories.length ? tagCategories
                  : [ev.dtstart >= today ? 'UPCOMING' : 'PAST'];
  } else if (tagCategories.includes('DIOCESE')) {
    ev.categories = ['DIOCESE'];
  }
}

/* ═══════════════════════════════════════════════════════════
   HTML HELPERS
═══════════════════════════════════════════════════════════ */
function esc(s) {
  return String(s||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function imgUrl(src) {
  if (!src) return '';
  if (src.startsWith('http')) return src;
  return `${CONFIG.siteBaseUrl}/${src.replace(/^\//,'')}`;
}

/* Wrap content in the standard 600px centred email shell */
function shellOpen() {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"
  "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
  <title>DC Episcopal Fellowship — ${esc(CONFIG.season)}</title>
  <style>
    body, table, td { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; }
    body { margin:0; padding:0; background-color:${C.page}; }
    a { color:${C.blue}; }
    @media screen and (max-width:600px) {
      .email-body  { width:100% !important; }
      .col-half    { display:block !important; width:100% !important; }
      .col-spacer  { display:none !important; }
      .rsvp-btn    { display:block !important; text-align:center !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${C.page};">
<table width="100%" border="0" cellpadding="0" cellspacing="0"
       style="background-color:${C.page};">
  <tr><td align="center" style="padding:24px 0;">
    <!-- ── email body ── -->
    <table class="email-body" width="600" border="0" cellpadding="0" cellspacing="0"
           style="max-width:600px;width:100%;background-color:${C.cream};border-radius:6px;
                  overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.10);">`;
}

function shellClose() {
  return `
    </table>
    <!-- ── /email body ── -->
  </td></tr>
</table>
</body>
</html>`;
}

/* ── Individual section renderers ── */

function renderHeader() {
  return `
      <!-- HEADER -->
      <tr><td bgcolor="${C.navy}" style="background-color:${C.navy};padding:20px 24px;text-align:center;">
        <p style="margin:0;font-family:${FONT_HEADING};font-size:18px;font-weight:800;
                  color:${C.white};letter-spacing:0.06em;text-transform:uppercase;">
          DC EPISCOPAL FELLOWSHIP
        </p>
        <p style="margin:6px 0 0;font-family:${FONT_HEADING};font-size:13px;font-weight:600;
                  color:rgba(255,255,255,.75);letter-spacing:0.04em;text-transform:uppercase;">
          ${esc(CONFIG.season)}
        </p>
      </td></tr>`;
}

function renderHero() {
  const url = imgUrl(CONFIG.heroImage);
  return `
      <!-- HERO IMAGE -->
      <tr><td style="padding:0;font-size:0;line-height:0;">
        <img src="${esc(url)}" width="600" alt="DC Episcopal Fellowship"
             style="display:block;width:100%;max-width:600px;height:auto;">
      </td></tr>`;
}

function renderWelcome() {
  return `
      <!-- WELCOME -->
      <tr><td style="background-color:${C.cream};padding:28px 36px 24px;">
        <p style="margin:0;font-family:${FONT_BODY};font-size:14px;line-height:1.75;color:${C.brown};">
          ${CONFIG.welcomeText}
        </p>
      </td></tr>`;
}

function renderSectionHeading(title) {
  return `
      <tr><td bgcolor="${C.sand}" style="background-color:${C.sand};padding:14px 36px;">
        <p style="margin:0;font-family:${FONT_HEADING};font-size:18px;font-weight:700;
                  color:${C.navy};letter-spacing:0.03em;">${esc(title)}</p>
      </td></tr>`;
}

function renderDivider() {
  return `
      <tr><td style="font-size:0;height:1px;background-color:${C.border};">&nbsp;</td></tr>`;
}

/* Past events — 2-column grid */
function renderPastEvents(past) {
  if (!past.length) return '';

  const cells = past.map(ev => {
    const label = `${MONTH_NAMES[ev.dtstart.getMonth()]} ${ev.dtstart.getFullYear()}`
                + (ev.location ? ` &mdash; ${esc(ev.location.split(',')[0])}` : '');
    const imgTag = ev.image
      ? `<img src="${esc(imgUrl(ev.image))}" width="252" alt="${esc(ev.summary)}"
              style="display:block;width:100%;max-width:252px;height:160px;
                     object-fit:cover;border-radius:3px;margin-bottom:12px;">`
      : '';
    return `<td class="col-half" valign="top" width="252"
                style="width:252px;padding:18px 18px 22px;vertical-align:top;">
        ${imgTag}
        <p style="margin:0 0 4px;font-family:${FONT_HEADING};font-size:11px;font-weight:700;
                  color:${C.navy};text-transform:uppercase;letter-spacing:0.04em;">${label}</p>
        <p style="margin:0 0 8px;font-family:${FONT_HEADING};font-size:14px;font-weight:700;
                  color:${C.navy};line-height:1.25;">${esc(ev.summary)}</p>
        <p style="margin:0;font-family:${FONT_BODY};font-size:13px;line-height:1.7;color:${C.brown};">
          ${esc(ev.description || '')}
        </p>
      </td>`;
  });

  // Pair events into rows of two
  const rows = [];
  for (let i = 0; i < cells.length; i += 2) {
    const spacer = cells[i+1]
      ? `<td class="col-spacer" width="16" style="width:16px;">&nbsp;</td>`
      : `<td width="268" style="width:268px;">&nbsp;</td>`;
    rows.push(`
      <tr>
        <td style="padding:0 20px;">
          <table width="100%" border="0" cellpadding="0" cellspacing="0">
            <tr>
              ${cells[i]}
              ${spacer}
              ${cells[i+1] || ''}
            </tr>
          </table>
        </td>
      </tr>`);
  }

  return renderSectionHeading('Looking Back') + rows.join('');
}

/* Upcoming events — full-width cards */
function renderUpcomingEvents(upcoming) {
  if (!upcoming.length) return '';

  const cards = upcoming.map(ev => {
    const meta    = formatDateMeta(ev.dtstart, ev.hasTime, ev.location);
    const imgTag  = ev.image
      ? `<tr><td style="padding:0;font-size:0;line-height:0;">
           <img src="${esc(imgUrl(ev.image))}" width="600" alt="${esc(ev.summary)}"
                style="display:block;width:100%;max-width:600px;height:auto;
                       max-height:280px;object-fit:cover;">
         </td></tr>`
      : '';
    const rsvpBtn = ev.url
      ? `<tr><td style="padding:6px 0 0;">
           <a class="rsvp-btn" href="${esc(ev.url)}"
              style="display:inline-block;background-color:${C.navy};color:${C.white};
                     font-family:${FONT_HEADING};font-size:12px;font-weight:700;
                     letter-spacing:0.06em;text-transform:uppercase;text-decoration:none;
                     padding:10px 22px;border-radius:3px;">RSVP Here</a>
         </td></tr>`
      : '';

    return `
      ${renderDivider()}
      <tr><td style="background-color:${C.cream};">
        <table width="100%" border="0" cellpadding="0" cellspacing="0">
          ${imgTag}
          <tr><td style="padding:20px 28px 22px;">
            <p style="margin:0 0 6px;font-family:${FONT_HEADING};font-size:17px;font-weight:700;
                      color:${C.navy};line-height:1.25;">${esc(ev.summary)}</p>
            <p style="margin:0 0 10px;font-family:${FONT_HEADING};font-size:12px;font-weight:700;
                      color:${C.brown};letter-spacing:0.03em;">${meta}</p>
            <p style="margin:0 0 14px;font-family:${FONT_BODY};font-size:13px;
                      line-height:1.7;color:${C.brown};">${esc(ev.description || '')}</p>
            <table border="0" cellpadding="0" cellspacing="0">
              ${rsvpBtn}
            </table>
          </td></tr>
        </table>
      </td></tr>`;
  });

  return renderSectionHeading('Upcoming Events')
    + `\n      <tr><td style="padding:16px 28px 8px;">
        <p style="margin:0;font-family:${FONT_BODY};font-size:14px;line-height:1.75;color:${C.brown};">
          ${CONFIG.upcomingIntro}
        </p>
      </td></tr>`
    + cards.join('');
}

/* Diocese events — 2-column grid */
function renderDioceseEvents(diocese) {
  if (!diocese.length) return '';

  const cells = diocese.map(ev => {
    const meta   = formatDateMeta(ev.dtstart, ev.hasTime, ev.location);
    const imgTag = ev.image
      ? `<img src="${esc(imgUrl(ev.image))}" width="252" alt="${esc(ev.summary)}"
              style="display:block;width:100%;max-width:252px;height:auto;
                     max-height:180px;object-fit:cover;border-radius:3px;margin-bottom:10px;">`
      : '';
    const link   = ev.url
      ? ` <a href="${esc(ev.url)}" style="color:${C.blue};text-decoration:none;">Learn more</a>`
      : '';
    return `<td class="col-half" valign="top" width="252"
                style="width:252px;padding:16px 18px 20px;vertical-align:top;">
        ${imgTag}
        <p style="margin:0 0 4px;font-family:${FONT_HEADING};font-size:14px;font-weight:700;
                  color:${C.navy};line-height:1.25;">${esc(ev.summary)}</p>
        <p style="margin:0 0 8px;font-family:${FONT_HEADING};font-size:11px;font-weight:700;
                  color:${C.brown};letter-spacing:0.03em;">${meta}</p>
        <p style="margin:0;font-family:${FONT_BODY};font-size:13px;line-height:1.7;color:${C.brown};">
          ${esc(ev.description || '')}${link}
        </p>
      </td>`;
  });

  const rows = [];
  for (let i = 0; i < cells.length; i += 2) {
    const spacer = cells[i+1]
      ? `<td class="col-spacer" width="16" style="width:16px;">&nbsp;</td>`
      : `<td width="268" style="width:268px;">&nbsp;</td>`;
    rows.push(`
      <tr>
        <td style="padding:0 20px;">
          <table width="100%" border="0" cellpadding="0" cellspacing="0">
            <tr>
              ${cells[i]}
              ${spacer}
              ${cells[i+1] || ''}
            </tr>
          </table>
        </td>
      </tr>`);
  }

  return renderSectionHeading('Events Around the Diocese')
    + `\n      <tr><td style="padding:14px 28px 4px;">
        <p style="margin:0;font-family:${FONT_BODY};font-size:14px;line-height:1.75;color:${C.brown};">
          ${CONFIG.dioceseIntro}
        </p>
      </td></tr>`
    + rows.join('');
}

function renderFooter() {
  return `
      <!-- FOOTER -->
      ${renderDivider()}
      <tr><td bgcolor="${C.navy}" style="background-color:${C.navy};padding:24px 36px;text-align:center;">
        <p style="margin:0;font-family:${FONT_HEADING};font-size:13px;color:rgba(255,255,255,.8);
                  line-height:1.7;">${CONFIG.footerText}</p>
      </td></tr>`;
}

/* ═══════════════════════════════════════════════════════════
   MAIN
═══════════════════════════════════════════════════════════ */
function main() {
  const icsPath = path.join(__dirname, CONFIG.icsFile);
  if (!fs.existsSync(icsPath)) {
    console.error(`❌  ${CONFIG.icsFile} not found. Download it from Google Calendar first:`);
    console.error('   Calendar Settings → Export → unzip → rename to events.ics');
    process.exit(1);
  }

  const icsText = fs.readFileSync(icsPath, 'utf8');
  const events  = parseICS(icsText);

  const today   = new Date(); today.setHours(0,0,0,0);
  const past     = events.filter(e => e.categories.includes('PAST'))
                         .sort((a,b) => b.dtstart - a.dtstart);
  const upcoming = events.filter(e => e.categories.includes('UPCOMING') && e.dtstart >= today)
                         .sort((a,b) => a.dtstart - b.dtstart);
  const diocese  = events.filter(e => e.categories.includes('DIOCESE') && e.dtstart >= today)
                         .sort((a,b) => a.dtstart - b.dtstart);

  console.log(`📅  Parsed ${events.length} events: ${upcoming.length} upcoming, ${past.length} past, ${diocese.length} diocese`);

  const html = [
    shellOpen(),
    renderHeader(),
    renderHero(),
    renderWelcome(),
    past.length     ? renderPastEvents(past)         : '',
    upcoming.length ? renderUpcomingEvents(upcoming)  : '',
    diocese.length  ? renderDioceseEvents(diocese)    : '',
    renderFooter(),
    shellClose(),
  ].join('\n');

  const outPath = path.join(__dirname, CONFIG.outputFile);
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`✅  Written to ${CONFIG.outputFile}`);
  console.log(`    Open it in a browser to preview before sending.`);
}

main();
