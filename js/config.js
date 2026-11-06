// ─────────────────────────────────────────────────────────────
//  Everything the client is likely to tweak lives in this file:
//  copy, links, endpoint. Wording matters to Saintwood, so every
//  user-facing string on the page is here, in one place.
// ─────────────────────────────────────────────────────────────

export const CONFIG = {
  instagramHandle: 'saintwoodcafe',
  instagramUrl: 'https://www.instagram.com/saintwoodcafe/',
  // Where signups are POSTed. Same-origin serverless function by default.
  endpoint: '/api/signup',
  // Bump when the SMS disclosure wording changes (and keep the old text in
  // lib/signup.js CONSENT), so every stored consent says what was agreed to.
  consentVersion: 'sms-2026-11-v1',
  smsTermsUrl: '/sms-terms.html',
  privacyUrl: '/privacy.html',
};

export const COPY = {
  // First screen: why you're here, in two lines.
  headline: 'Make a coffee, get a free one.',
  sub: 'Build this cup, and your first coffee is free when we open.',
  steps: { pour: 'Pour', sleeve: 'Sleeve', lid: 'Lid' },
  autoplay: 'Make it for me',

  // Gentle nudges when things go sideways
  nudgeLidFirst: 'Lid goes on last.',
  nudgeSpill: 'Oops — a little spill.',
  nudgeEmpty: 'Empty. Set it down to refill.',
  nudgeBrew: 'Refilling…',

  doneHeadline: 'Your cup is ready.',
  doneSub: 'Now claim your free coffee for opening week.',
  claim: 'Claim my free coffee',
  backToStore: 'Back to the storefront',

  // Signup sheet
  q1Title: 'What are you most excited for?',
  q1Options: [
    { value: 'bagels', label: 'Bagels' },
    { value: 'burgers', label: 'Burgers' },
    { value: 'coffee', label: 'Coffee' },
  ],

  phoneTitle: 'Where should we text your free coffee?',
  phoneSub: 'We’ll text it when we open. Show the text at the counter.',
  phoneCta: 'Text it to me',
  phoneSending: 'Saving…',
  phoneInvalid: 'That number doesn’t look right — 10 digits, US only.',
  phoneIncomplete: 'Enter all 10 digits.',
  // TCPA-style disclosure shown under the button. Have counsel review.
  smsDisclosure:
    'By tapping “Text it to me”, you agree to receive recurring automated marketing texts from Saintwood at this number. Consent isn’t a condition of purchase. Msg frequency varies. Msg & data rates may apply. Reply STOP to cancel, HELP for help.',

  emailEyebrow: 'You’re on the list',
  emailTitle: 'Want updates by email too?',
  emailSub: 'Opening day and menu news. Optional.',
  emailCta: 'Add my email',
  emailSkip: 'No thanks',
  emailInvalid: 'Double-check that email.',
  emailDisclosure: 'Saintwood emails only. Unsubscribe any time.',

  // After signup: the storefront
  finalHeadline: 'You’re on the list.',
  finalSub: 'We’ll text your free coffee when we open.',
  finalReturning: 'We’ll text your free coffee when we open.',
  igCta: 'Follow @saintwoodcafe',
  peek: ['Not yet.', 'Coming soon.'],
};
