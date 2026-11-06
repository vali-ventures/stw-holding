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
  // Bump when the SMS disclosure wording changes, so every stored consent
  // record says exactly which wording the person agreed to.
  consentVersion: 'sms-2026-11-v1',
  smsTermsUrl: '/sms-terms.html',
  privacyUrl: '/privacy.html',
};

export const COPY = {
  eyebrow: 'Saintwood · Bagels, Burgers & Coffee',
  headline: 'Pour the first one.',
  sub: 'We’re still behind the paper.\nThe real one’s on us.',
  steps: { pour: 'pour', sleeve: 'sleeve', lid: 'lid' },
  skip: 'Skip ahead — just save my free coffee',
  autoplay: 'Make it for me',

  // Gentle nudges when people do things out of order
  nudgeLidFirst: 'Lid goes on last.',
  nudgeSpill: 'Happens to the best of us.',
  nudgeEmpty: 'Set the press down to top it up.',

  doneHeadline: 'Now that’s a cup.',
  doneSub: 'Practice round, done.\nThe real one’s on us, opening week.',
  claim: 'Claim my free coffee',

  // Signup sheet
  q1Eyebrow: 'Quick question',
  q1Title: 'What are you most excited for?',
  q1Options: [
    { value: 'bagels', label: 'Bagels' },
    { value: 'burgers', label: 'Burgers' },
    { value: 'coffee', label: 'Coffee' },
  ],

  phoneEyebrow: 'Your First Pour',
  phoneTitle: 'Where should we text your free coffee?',
  phoneSub: 'One text when the doors open. Show it at the counter any day of opening week.',
  phoneCta: 'Text it to me',
  phoneSending: 'Saving…',
  phoneInvalid: 'That number doesn’t look right — 10 digits, US numbers only.',
  // TCPA-style disclosure shown next to the button. Have counsel review.
  smsDisclosure:
    'By tapping “Text it to me”, you agree to receive recurring automated marketing texts from Saintwood at this number. Consent isn’t a condition of purchase. Msg frequency varies. Msg & data rates may apply. Reply STOP to cancel, HELP for help.',

  emailEyebrow: 'Saved. You’re on the list.',
  emailTitle: 'Want the long version by email?',
  emailSub: 'Menus, opening day, the odd secret. Totally optional.',
  emailCta: 'Add me',
  emailSkip: 'No thanks',
  emailInvalid: 'Double-check that email.',
  emailDisclosure: 'Saintwood emails only. Unsubscribe any time.',

  igEyebrow: 'Last thing',
  igTitle: 'The reveal happens on Instagram.',
  igSub: 'We’ll show what’s behind the paper there first.',
  igCta: 'Follow @saintwoodcafe',
  igDone: 'Done',

  finalHeadline: 'You’re in.',
  finalSub: 'One of the first through the door.\nWatch your texts the week we open.',
  finalReturning: 'You’re already on the list. Your First Pour is saved.',
  peek: 'Not yet.',
  pourAnother: 'Pour another',
};
