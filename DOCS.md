# DCEF Website — Technical Reference

## Google Calendar Event Formatting

Add these tags anywhere in a Google Calendar event's **description** field.
All tags are stripped from the displayed text on the website.

### Tags

| Tag | Example | Effect |
|-----|---------|--------|
| `[image:filename]` | `[image:baseball.png]` | Sets the event photo. Just the filename — `images/` is prepended automatically. |
| `RSVP: url` | `RSVP: https://partiful.com/e/abc123` | Adds an RSVP button. Must be on its own line. |
| `#DIOCESE` | `#DIOCESE` | Routes the event to the "Events Around the Diocese" section instead of Upcoming. |

### Category Logic

Events are automatically sorted by date — no tagging needed for the common case:

- **Future events** → Upcoming Events section
- **Past events** → Looking Back section
- **`#DIOCESE` tag** → Events Around the Diocese section (future dates only)

### Example Description

```
Join us at Lincoln Park for evening prayer followed by happy hour at Barrel.

RSVP: https://partiful.com/e/flQMZuaZj5SS6fv5LEIR
[image:evening-prayer.png]
```

---

## CORS

Browsers block direct cross-origin requests to third-party URLs. Two places this affects the site:

### Google Calendar ICS

Google Calendar's ICS feed (`calendar.google.com/...`) does not include CORS headers, so it can't be fetched directly from the browser. The site routes the request through a free CORS proxy.

**Two proxies are tried in order — if the first fails, the second is used automatically:**

1. `https://api.allorigins.win/raw?url=...&_={timestamp}` — primary
2. `https://corsproxy.io/?...` — fallback

The `Date.now()` timestamp on allorigins.win prevents it from returning a cached copy of the calendar.

**If both proxies fail**, the site falls back to the local `events.ics` file.

**Requirement:** The Google Calendar must be set to **public**:
> Google Calendar → Settings → *(your calendar)* → Access permissions → Make available to public ✓

### Google Apps Script (Email Signups)

The signup form POSTs to a Google Apps Script web app. Apps Script always returns a `302 redirect` before executing, which triggers a CORB (Cross-Origin Read Blocking) warning in the browser. This is expected and harmless — the script executes and writes to the Sheet regardless. The site uses `mode: 'no-cors'` so no response reading is attempted.

**Requirement:** The Apps Script deployment must be set to:
> Execute as: **Me** · Who has access: **Anyone**

After editing the Apps Script, always redeploy:
> Deploy → Manage deployments → edit (pencil) → New version → Deploy

---

## APIs & External Services

| Service | URL | Purpose | Key required? |
|---------|-----|---------|---------------|
| Google Calendar ICS | `calendar.google.com/calendar/ical/dcepiscopalfellowship%40gmail.com/public/basic.ics` | Live event feed | No — calendar must be public |
| allorigins.win | `api.allorigins.win/raw` | CORS proxy for calendar | No — free, no account |
| corsproxy.io | `corsproxy.io` | CORS proxy fallback | No — free, no account |
| Google Apps Script | `script.google.com/macros/s/.../exec` | Email signup logging | No — deployed as public web app |

### Config constants in `index.html`

```js
const GCAL_ICS_URL     = 'https://calendar.google.com/calendar/ical/dcepiscopalfellowship%40gmail.com/public/basic.ics';
const SIGNUP_ENDPOINT  = 'https://script.google.com/macros/s/.../exec';
```

### Hero image slideshow

Images are loaded from `hero-images/` based on `hero-images/manifest.json`:

```json
{
  "images": ["photo1.jpg", "photo2.jpg"],
  "interval": 6000
}
```

Drop images into `hero-images/`, add their filenames to `manifest.json`. If the manifest is empty the original hero image is used as a fallback.

---

## Hosting (GitHub Pages)

The site is static HTML/CSS/JS — no build step, no dependencies.

- **Repo:** `dcepiscopalfellowship.github.io` (public)
- **Deploy:** push files to `main` branch, GitHub Pages serves automatically within ~1 min
- **URL:** `https://dcepiscopalfellowship.github.io`

To update the site: upload changed files to the repo. Google Calendar changes are live immediately on next page load — no redeployment needed.
