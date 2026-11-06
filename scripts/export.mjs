// Export signups as CSV (one row per phone number) — for a CRM import,
// a spreadsheet, or a quick count.
//   node scripts/export.mjs > signups.csv          (GitHub branch if GITHUB_* set, else data/signups.jsonl)
//   node scripts/export.mjs --local > signups.csv  (force local file)
import { readEvents, fold } from './lib-read.mjs';

const rows = fold(await readEvents());
const cols = [...new Set(['phone', 'email', 'interest', 'code', 'signedUpAt', 'emailAt', 'instagramClicked', 'consentVersion', 'id', ...rows.flatMap(Object.keys)])];
const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
process.stdout.write(cols.join(',') + '\n' + rows.map((r) => cols.map((c) => esc(r[c])).join(',')).join('\n') + '\n');
console.error(`${rows.length} people · ${rows.filter((r) => r.email).length} with email · ` +
  ['bagels', 'burgers', 'coffee'].map((k) => `${k} ${rows.filter((r) => r.interest === k).length}`).join(' · '));
