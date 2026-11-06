// Opening week: text everyone their First Pour.
//
//   node scripts/send-codes.mjs                 → DRY RUN: prints what would be sent
//   node scripts/send-codes.mjs --send          → actually sends via Twilio
//   node scripts/send-codes.mjs --send --limit 5   (send to the first 5 only — test on yourselves first)
//
// Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID.
// Edit the message with FIRST_POUR_TEXT (use {code} where the code goes).
// Keeps a log in data/sent.jsonl so re-running never double-texts anyone.
import fs from 'node:fs/promises';
import { readEvents, fold } from './lib-read.mjs';
import { sendSms } from '../lib/signup.js';

const SEND = process.argv.includes('--send');
const limit = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || process.argv[process.argv.indexOf('--limit') + 1]) || Infinity;
const TEMPLATE = process.env.FIRST_POUR_TEXT ||
  "Saintwood: we're open. Your First Pour is on us — show this text at the counter any day this week. Code {code}. Reply STOP to opt out.";

const sentLog = 'data/sent.jsonl';
const already = new Set((await fs.readFile(sentLog, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l).phone));
const rows = fold(await readEvents()).filter((r) => !already.has(r.phone)).slice(0, limit);

console.log(`${SEND ? 'SENDING' : 'DRY RUN'} — ${rows.length} recipient(s), ${already.size} already sent\n`);
let ok = 0;
for (const r of rows) {
  const body = TEMPLATE.replace('{code}', r.code || '');
  if (!SEND) { console.log(`${r.phone}  →  ${body}`); continue; }
  try {
    const res = await sendSms(r.phone, body);
    await fs.appendFile(sentLog, JSON.stringify({ phone: r.phone, code: r.code, sid: res.sid, at: new Date().toISOString() }) + '\n');
    ok++; console.log('✓', r.phone);
    await new Promise((res) => setTimeout(res, 250)); // stay well under carrier throughput limits
  } catch (e) { console.error('✗', r.phone, e.message); }
}
if (SEND) console.log(`\nSent ${ok}/${rows.length}.`);
