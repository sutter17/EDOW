# DCEF Admin — Claude Reference

## Project Overview
DC Episcopal Fellowship website. Static HTML/CSS/JS hosted on Netlify (functions) and GitHub Pages. Events from Google Calendar ICS, RSVPs via Partiful, images via Cloudflare R2, newsletter via email.html generator.

## File Map
| File | Purpose |
|------|---------|
| `index.html` | Public website — events, calendar, hero, subscribe |
| `admin.html` | Admin dashboard — events, photos, site content |
| `email.html` | Standalone email generator — live preview + export |
| `events.ics` | Cached ICS (refreshed every 6h via GitHub Actions) |
| `netlify/functions/fetch-ics.js` | CORS proxy for Google Calendar ICS |
| `netlify/functions/fetch-config.js` | Reads optional config from Google Drive |
| `netlify/functions/partiful.js` | Partiful API proxy (list/create/update events) |
| `netlify/functions/r2-presign.js` | Cloudflare R2 list + presigned upload URLs |
| `netlify/functions/rsvp.js` | `/rsvp/:slug` redirect handler |
| `netlify/functions/rsvp-logs.js` | Read click log from Netlify Blobs |
| `netlify/functions/site-content.js` | GET/POST shared site content (welcome text, season, intros) |

## Required Environment Variables (Netlify)
| Variable | Used by | Notes |
|----------|---------|-------|
| `R2_ACCOUNT_ID` | r2-presign | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | r2-presign | R2 API key |
| `R2_SECRET_ACCESS_KEY` | r2-presign | R2 API secret |
| `R2_BUCKET_NAME` | r2-presign | Bucket name |
| `R2_PUBLIC_URL` | r2-presign | Public base URL, e.g. `https://pub-xxx.r2.dev` — no trailing slash |
| `PARTIFUL_API_KEY` | partiful | Partiful API key |
| `PARTIFUL_ORG_USER_ID` | partiful | Org user ID |
| `PARTIFUL_ACCOUNTS` | partiful | JSON array of account objects |
| `LOGS_SECRET` | rsvp-logs | Secret key to gate the logs read endpoint |

## RSVP Link Handler
- Route: `/rsvp/:slug` → `/.netlify/functions/rsvp?slug=:slug` (via `netlify.toml`)
- Slug = event summary lowercased, special chars stripped, spaces → hyphens
- Click logs stored in Netlify Blobs store `click-logs`, one entry per click
- Read logs: `/.netlify/functions/rsvp-logs?key=LOGS_SECRET` (JSON) or `&format=csv`
- UTM params pass through: `/rsvp/event-name?utm_source=newsletter&utm_campaign=may2026`

## Site Content Store
- Netlify Blobs store: `site-content`, key: `main`
- Shape: `{ season, welcomeHeading, welcomeText, upcomingIntro, dioceseIntro }`
- GET `/.netlify/functions/site-content` — public, returns current content
- POST `/.netlify/functions/site-content` — saves content (no auth, admin-only UI)
- `index.html` and `email.html` both fetch on load to stay in sync with admin edits
- Fields support HTML (links in intros); email.html strips tags before inserting into email output

---

## Known Issues

### R2 Image Previews Not Loading in Admin

Images load fine on the public site (`index.html`) because it uses a hardcoded custom domain:
```js
const R2_BASE_URL = 'https://images.dcepiscopalfellowship.org';
```
The admin Photos tab and image picker get their URLs from the `r2-presign` function, which uses `process.env.R2_PUBLIC_URL`. These are two separate URL sources — the env var and the hardcoded constant may not match or the env var may not be set at all.

**Cause 1 — `R2_PUBLIC_URL` env var not set in Netlify**
- Symptom: image `src` attributes in admin read `undefined/filename.jpg`
- Verify: open DevTools → Elements → inspect a `<img>` in the photo grid and check its `src`
- Fix: add `R2_PUBLIC_URL` to Netlify environment variables (Site settings → Environment variables) set to `https://images.dcepiscopalfellowship.org` — matching the hardcoded constant in `index.html`

**Cause 2 — `R2_PUBLIC_URL` set to the `r2.dev` subdomain instead of the custom domain**
- Symptom: images load on home page (custom domain) but return 403/404 in admin (`r2.dev` URL)
- Verify: check what `R2_PUBLIC_URL` is set to in Netlify; check if `pub-xxx.r2.dev` public access is enabled in Cloudflare
- Fix: set `R2_PUBLIC_URL` to `https://images.dcepiscopalfellowship.org` to match the custom domain already in use

---

## Architecture Notes

### ICS → Website flow
Google Calendar (public) → CORS proxy chain → `parseICS()` → `processEvent()` → render sections.
Events cached in `events.ics` via GitHub Actions every 6h as fallback.

### Shared content (index.html ↔ email.html)
Both pages fetch `/.netlify/functions/site-content` on load. Admin saves via Content tab.
Fallback to hardcoded strings if fetch fails.

### Event description tags (strip from display)
- `[image:filename]` → sets event photo
- `RSVP: <a href="...">` → sets RSVP button URL
- `[partiful:eventId]` → stripped (internal use only)
- `#DIOCESE` → routes event to diocese section

### Partiful token flow
Firebase ID token refreshed in-memory before 60s expiry. Google's `securetoken.googleapis.com` used for refresh. Firestore PATCH used for event updates (Partiful uses Firestore as backend).
