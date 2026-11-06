# Saintwood — opening-soon holding page

**“Pour the first one.”** People land on a pencil-drawn coffee bench in Saintwood’s house style. They drag the French press over the cup and it tips and pours. They slide the sleeve on and press the lid until it clicks. Then they save a free coffee for opening week with their phone number. Email is optional, and the last step sends them back to Instagram. They finish on the Saintwood storefront drawing with the windows papered over. One tear and an arrow are left in the paper, and tapping the tear peeks inside.

Everything is hand-built: no framework, no build step and no runtime dependencies. First load is about 150 KB compressed.

```
index.html          the page (all copy is injected from js/config.js)
css/style.css       layout, sheet, phone input, responsive rules
js/config.js        ← ALL user-facing copy + links + SMS consent version
js/scene.js         the bench: physics, pour, sleeve, lid, storefront finale
js/art.js           procedural pencil/ink sprites (cup, sleeve, lid, press, counter)
js/sketch.js        pencil / wash / hatch drawing kit
js/flow.js          signup sheet: question → phone → email → Instagram
js/api.js           client POST with retry + offline queue (never loses a signup)
js/audio.js         synthesized foley (pour, lid click…) — no audio files
api/signup.js       POST /api/signup (Vercel function) · GET = health check
lib/signup.js       validation + pluggable storage/notification "sinks"
server/dev.js       zero-dependency local server
scripts/export.mjs  CSV export, one row per phone number
scripts/send-codes.mjs  opening week: text everyone their First Pour code
sms-terms.html, privacy.html   required by carriers for SMS programs
```

## Run it locally

```bash
node server/dev.js
```

Open http://localhost:5173. Signups append to `data/signups.jsonl`, which is git-ignored. To try it on your phone over your wifi, run `HOST=0.0.0.0 node server/dev.js` and open your computer's IP address on port 5173.

## Deploy (Vercel)

1. Import the repo into Vercel. There is no build command and no framework preset; the output directory is the repo root.
2. Add storage, so signups actually save. The recommended option is Upstash Redis: Vercel → Storage → Marketplace → Upstash Redis, then connect it to the project. That sets `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_*`) for you.
3. Deploy, then check the health endpoint:

   ```bash
   curl https://YOUR-DOMAIN/api/signup
   ```

   You want `{"ok":true,"storage":["redis"],…}`. If `ok` is `false`, no storage is configured. The page still works and queues signups in the visitor's browser, but nothing reaches you until storage is set.

### Where signups can go (combine any; at least one storage sink must succeed)

| Sink | Env vars | Notes |
|---|---|---|
| **Redis** (primary) | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Atomic append. Fast. Free tier is plenty. |
| **Webhook** (CRM / Zapier / Make / Google Sheet) | `WEBHOOK_URL`, optional `WEBHOOK_SECRET` | POSTs `{source, event}` JSON. Signature header `X-Saintwood-Signature: t=…,v1=HMAC_SHA256(secret, "t.body")`. A Google Apps Script web app makes a free live sheet. |
| **GitHub** (audit log) | `GITHUB_TOKEN`, `GITHUB_REPO`, optional `GITHUB_BRANCH` (default `signups`) | One JSON file per event, so there's no size limit and no write conflicts. **Use a separate private repo** with a fine-grained token (Contents: read/write on that repo only). `vercel.json` disables deploys for the `signups` branch. |
| **File** | `SIGNUPS_FILE` | Local dev only by default. |
| **Twilio** (confirmation text) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` or `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_CONFIRM=1`, optional `TWILIO_CONFIRM_TEXT` | Sends one "you're on the list" text at signup. Best effort. |

To plug in a CRM later (Klaviyo, Attentive, HubSpot…), point `WEBHOOK_URL` at it, or at a Zap. Adding a native sink is one function in `lib/signup.js`.

Data is an event log:

```json
{"type":"signup","id":"…","phone":"+17025550123","interest":"coffee","code":"SW-7KQ2","consent":{"version":"sms-2026-11-v1","text":"By tapping…","ip":"…","userAgent":"…"},"attribution":{"utm_source":"instagram"},"at":"…"}
{"type":"update","id":"…","email":"a@b.com","at":"…"}
```

Redemption codes are derived from the signup id (`CODE_SECRET` env, set it to anything random), so retries never mint a second code.

## Opening week

```bash
# who signed up (CSV, de-duplicated by phone)
node scripts/export.mjs > signups.csv
```

```bash
# preview the texts (dry run)
node scripts/send-codes.mjs
```

```bash
# send to the first 3 only (test on the team)
node scripts/send-codes.mjs --send --limit 3
```

```bash
# send to everyone; never double-texts (logs to data/sent.jsonl)
node scripts/send-codes.mjs --send
```

Edit the message with `FIRST_POUR_TEXT="… {code} …"`. Run the scripts with the same env vars as production, e.g. `vercel env pull .env.local`, then load that file.

## Changing copy

Every word on the page lives in `js/config.js`. The SMS disclosure is versioned. **If you change `smsDisclosure`, bump `consentVersion`.** The server stores the exact wording each person agreed to; keep the old version's text in `CONSENT` in `lib/signup.js`. Have counsel review the disclosure, `sms-terms.html` and `privacy.html` before launch. For US texting you'll also need to register the number or brand for A2P 10DLC (or use a verified toll-free number) in Twilio.

## Testing

`scripts/test-mobile.cjs` plays the game with real touch input on four phone profiles (iPhone 13, iPhone SE, Pixel 7, Instagram's in-app browser) and with a real mouse on five desktop sizes (1024 to 2560 wide; set `SUITE=desktop` or `SUITE=all`): any-order building, lid/sleeve on and off, pouring onto the lid, shake-to-spill, pieces flung at the screen edges, and the full signup with the keyboard up. It answers the signup API itself, so nothing is written to the real database.

```bash
node server/dev.js
```

```bash
OUT=/tmp/shots node scripts/test-mobile.cjs
```

## Notes

- US numbers only (10-digit NANP). The phone field accepts typing, paste and autofill (`+1 (702) 555-0123` works).
- Tested at 280px to 2560px wide, in portrait and landscape. The on-screen keyboard is handled with the VisualViewport API, so the sheet rides above it.
- The canvas pauses while the signup sheet is open and drops to about 20 fps when nothing is moving.
- Respects `prefers-reduced-motion` for UI transitions. Sound is synthesized and muteable, and the mute choice is remembered.
