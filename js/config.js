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
  headline: 'Pour the first one.',
  sub: 'We’re still behind the paper.\nThe real one’s on us.',
  steps: { pour: 'pour', sleeve: 'sleeve', lid: 'lid' },
  skip: 'Skip to the free coffee',
  autoplay: 'Pour it for me',

  // Gentle nudges when people do things out of order
  nudgeLidFirst: 'Lid goes on last.',
  nudgeSpill: 'Happens to the best of us.',
  nudgeEmpty: 'Bone dry. Set it down for a fresh pot.',
  nudgeBrew: 'Brewing a fresh pot…',

  doneHeadline: 'Now that’s a cup.',
  doneSub: 'That one’s practice.\nThe real one’s on us, opening week.',
  claim: 'Save my free coffee',

  // Signup sheet
  q1Eyebrow: 'Before you go in',
  q1Title: 'What are you coming in for?',
  q1Options: [
    { value: 'bagels', label: 'Bagels' },
    { value: 'burgers', label: 'Burgers' },
    { value: 'coffee', label: 'Coffee' },
  ],

  phoneEyebrow: 'Your First Pour',
  phoneTitle: 'Where should we text your free coffee?',
  phoneSub: 'We’ll text you when the paper comes down. Show it at the counter any day of opening week.',
  phoneCta: 'Text it to me',
  phoneSending: 'Saving…',
  phoneInvalid: 'That number doesn’t look right — 10 digits, US numbers only.',
  // TCPA-style disclosure shown next to the button. Have counsel review.
  smsDisclosure:
    'By tapping “Text it to me”, you agree to receive recurring automated marketing texts from Saintwood at this number. Consent isn’t a condition of purchase. Msg frequency varies. Msg & data rates may apply. Reply STOP to cancel, HELP for help.',

  emailEyebrow: 'Saved. You’re on the list.',
  emailTitle: 'Want the long version?',
  emailSub: 'Menus, opening day, the odd secret — by email. Optional.',
  emailCta: 'Add me',
  emailSkip: 'No thanks',
  emailInvalid: 'Double-check that email.',
  emailDisclosure: 'Saintwood emails only. Unsubscribe any time.',

  igEyebrow: 'Last thing',
  igTitle: 'The paper comes down on Instagram first.',
  igSub: 'Watch the windows.',
  igCta: 'Follow @saintwoodcafe',
  igDone: 'Done',

  finalHeadline: 'You’re in.',
  finalSub: 'One of the first through the door.\nWatch your texts opening week.',
  finalReturning: 'You’re on the list.\nYour free coffee is waiting.',
  peek: ['No peeking.', 'Nice try.', 'Soon.', 'Patience. It’s worth it.'],
  pourAnother: 'Pour another',
};
