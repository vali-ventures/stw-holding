// The signup sheet: question → phone → (optional) email → Instagram.
// The phone number is saved the moment it's submitted; everything after is a bonus.

import { CONFIG, COPY } from './config.js';
import { send, newId } from './api.js';
import * as A from './audio.js';

const ICONS = {
  bagels: '<svg viewBox="0 0 64 64"><ellipse cx="32" cy="34" rx="25" ry="17"/><ellipse cx="32" cy="32" rx="8" ry="4.6"/><path d="M8 33c1 9 11 15 24 15s23-6 24-15"/><path d="M17 25l2 1M24 21l1 2M40 21l-1 2M47 25l-2 1M20 40l2-1M44 40l-2-1M31 43h2"/></svg>',
  burgers: '<svg viewBox="0 0 64 64"><path d="M10 29c0-10 10-17 22-17s22 7 22 17z"/><path d="M8 35c4-3 8 3 12 0s8 3 12 0 8 3 12 0 8 3 12 0"/><rect x="9" y="38" width="46" height="6" rx="3"/><path d="M11 47h42c0 5-4 7-9 7H20c-5 0-9-2-9-7z"/><path d="M22 20l1 1M30 17l1 1M38 19l1 1M45 23l1 1"/></svg>',
  coffee: '<svg viewBox="0 0 64 64"><path d="M16 20h32l-4 36H20z"/><path d="M14 14h36v6H14z"/><path d="M18 30h28l-1.6 14H19.6z"/><path d="M27 8c-2 2 2 3 0 5M35 6c-2 2 2 3 0 5"/></svg>',
};

export class Flow {
  constructor(root, scrim, hooks) {
    this.root = root; this.scrim = scrim; this.hooks = hooks;
    this.state = { id: null, interest: null, phone: '', email: '' };
    this.steps = ['q', 'phone', 'email', 'ig'];
    this.cur = 'q';
    this._buildChoices();
    this._buildDigits();
    this._wire();
    this._keyboard();
  }

  // ── open / close ─────────────────────────────────────────
  open(step = 'q') {
    this.prevFocus = document.activeElement;
    this.root.hidden = false; this.scrim.hidden = false;
    this._show(step, true);
    requestAnimationFrame(() => requestAnimationFrame(() => { this.root.classList.add('show'); this.scrim.classList.add('show'); }));
    this.root.querySelector('.close').focus({ preventScroll: true });
  }
  close(done = false) {
    this.root.classList.remove('show'); this.scrim.classList.remove('show');
    document.activeElement && document.activeElement.blur();
    setTimeout(() => { this.root.hidden = true; this.scrim.hidden = true; }, 520);
    this.hooks.onClose && this.hooks.onClose(done || !!this.state.saved);
  }

  _show(name, instant = false) {
    const prev = this.root.querySelector(`.step[data-step="${this.cur}"]`);
    const next = this.root.querySelector(`.step[data-step="${name}"]`);
    const go = () => {
      this.root.querySelectorAll('.step').forEach((s) => (s.hidden = s !== next));
      next.classList.remove('leaving');
      this.cur = name;
      const i = this.steps.indexOf(name);
      this.root.querySelectorAll('.pips i').forEach((p, k) => { p.classList.toggle('on', k <= i); p.classList.toggle('cur', k === i); });
      this.root.querySelector('.sheet-inner').scrollTop = 0;
      if (name === 'phone') setTimeout(() => this.phoneInput.focus({ preventScroll: true }), instant ? 380 : 60);
      if (name === 'email') setTimeout(() => this.root.querySelector('#email').focus({ preventScroll: true }), 80);
    };
    if (prev && prev !== next && !instant && !prev.hidden) {
      prev.classList.add('leaving');
      setTimeout(go, 200);
    } else go();
  }

  // ── step 1: question ─────────────────────────────────────
  _buildChoices() {
    const box = this.root.querySelector('.choices');
    COPY.q1Options.forEach((o) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'choice'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false');
      b.dataset.value = o.value;
      b.innerHTML = (ICONS[o.value] || '') + `<span>${o.label}</span>`;
      b.addEventListener('click', () => {
        A.unlock(); A.tick(); A.haptic(6);
        box.querySelectorAll('.choice').forEach((c) => c.setAttribute('aria-checked', String(c === b)));
        this.state.interest = o.value;
        clearTimeout(this._adv);
        this._adv = setTimeout(() => this._show('phone'), 340);
      });
      box.appendChild(b);
    });
  }

  // ── step 2: phone ────────────────────────────────────────
  _buildDigits() {
    const d = this.root.querySelector('.digits');
    let html = '';
    for (let i = 0; i < 10; i++) {
      if (i === 3 || i === 6) html += '<i class="sep"></i>';
      html += `<span class="slot" style="--i:${i}"></span>`;
    }
    d.innerHTML = html;
    this.slots = [...d.querySelectorAll('.slot')];
    this.phoneInput = this.root.querySelector('#phone');
    this.phoneLabel = this.root.querySelector('.phone');
  }

  _digits(v) {
    let d = (v || '').replace(/\D/g, '');
    if (d.length === 11 && d[0] === '1') d = d.slice(1); // autofill gives +1…
    return d.slice(0, 10);
  }

  _renderPhone() {
    const d = this.state.phone;
    this.slots.forEach((s, i) => {
      const ch = d[i] || '';
      if (s.dataset.v !== ch) { s.innerHTML = ch ? `<span>${ch}</span>` : ''; s.dataset.v = ch; }
      s.classList.toggle('filled', !!ch);
      s.classList.toggle('cur', i === Math.min(d.length, 9) && d.length < 10);
    });
    const full = d.length === 10;
    this.phoneLabel.classList.toggle('full', full);
    this.root.querySelector('.send').disabled = !full;
  }

  _validPhone(d) {
    // NANP: area code and exchange can't start with 0/1
    return /^[2-9]\d{2}[2-9]\d{6}$/.test(d);
  }

  _wire() {
    const R = this.root;
    R.querySelector('.close').addEventListener('click', () => this.close());
    this.scrim.addEventListener('click', () => this.close());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !R.hidden) this.close(); });

    const inp = this.phoneInput, lab = this.phoneLabel, err = R.querySelector('#phone-err');
    inp.addEventListener('focus', () => { lab.classList.add('focus'); this._renderPhone(); });
    inp.addEventListener('blur', () => lab.classList.remove('focus'));
    inp.addEventListener('input', () => {
      const before = this.state.phone;
      const d = this._digits(inp.value);
      this.state.phone = d;
      if (inp.value !== d) inp.value = d;
      err.textContent = ''; lab.classList.remove('bad');
      if (d.length > before.length) { A.tick(); }
      this._renderPhone();
      if (d.length === 10 && before.length < 10) {
        if (!this._validPhone(d)) return this._phoneErr();
        // done typing: drop the keyboard, give it a little wave
        lab.classList.remove('done'); void lab.offsetWidth; lab.classList.add('done');
        A.haptic(10);
        setTimeout(() => inp.blur(), 120);
      }
    });
    // keep caret at the end; no mid-string editing weirdness
    inp.addEventListener('keydown', () => requestAnimationFrame(() => { try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch {} }));

    R.querySelector('form[data-step="phone"]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = this.state.phone;
      if (d.length !== 10 || !this._validPhone(d)) return this._phoneErr();
      const btn = R.querySelector('.send');
      btn.disabled = true; btn.textContent = COPY.phoneSending;
      this.state.id = this.state.id || newId();
      try {
        await send({
          type: 'signup', id: this.state.id, phone: '+1' + d, interest: this.state.interest,
          consent: { sms: true, version: CONFIG.consentVersion },
          company: R.querySelector('.hp').value || undefined, // honeypot
        });
        this.state.saved = true;
        this.hooks.onSaved && this.hooks.onSaved({ id: this.state.id, last4: d.slice(-4) });
        A.chime(); A.haptic(16);
        this._show('email');
      } catch (ex) {
        this._phoneErr(ex.message === 'invalid' || ex.field === 'phone' ? null : 'Something went wrong — try again in a sec.');
      } finally {
        btn.textContent = COPY.phoneCta; btn.disabled = this.state.phone.length !== 10;
      }
    });

    // step 3: email
    const em = R.querySelector('#email'), emErr = R.querySelector('#email-err');
    em.addEventListener('input', () => { emErr.textContent = ''; em.classList.remove('bad'); });
    R.querySelector('form[data-step="email"]').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = em.value.trim();
      if (!v) return this._show('ig');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
        emErr.textContent = COPY.emailInvalid; em.classList.remove('bad'); void em.offsetWidth; em.classList.add('bad'); A.haptic(30);
        return;
      }
      this.state.email = v;
      em.blur();
      send({ type: 'update', id: this.state.id, email: v }).catch(() => {});
      A.tick();
      this._show('ig');
    });
    R.querySelector('.skip-email').addEventListener('click', () => { em.blur(); this._show('ig'); });

    // step 4
    R.querySelector('.step[data-step="ig"] .ig').addEventListener('click', () => {
      if (this.state.id) send({ type: 'update', id: this.state.id, instagramClicked: true }).catch(() => {});
      setTimeout(() => this.close(true), 600);
    });
    R.querySelector('.finish').addEventListener('click', () => this.close(true));
  }

  _phoneErr(msg) {
    const lab = this.phoneLabel, err = this.root.querySelector('#phone-err');
    err.textContent = msg || COPY.phoneInvalid;
    lab.classList.remove('bad'); void lab.offsetWidth; lab.classList.add('bad');
    A.haptic(30);
  }

  // Keep the sheet sitting on top of the on-screen keyboard, without the
  // page jumping around. Uses the VisualViewport API (iOS + Android).
  _keyboard() {
    const vv = window.visualViewport;
    const root = document.documentElement;
    const update = () => {
      const h = vv ? vv.height : window.innerHeight;
      const kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
      root.style.setProperty('--vvh', h + 'px');
      root.style.setProperty('--kb', kb + 'px');
      this.root.classList.toggle('kb', kb > 80);
      if (window.scrollY || document.scrollingElement.scrollTop) window.scrollTo(0, 0);
    };
    if (vv) { vv.addEventListener('resize', update); vv.addEventListener('scroll', update); }
    window.addEventListener('resize', update);
    update();
  }
}
