/* scan.js — the scan zone: keyboard-wedge capture, always focused.
   A barcode gun types fast and ends with Enter. Nothing here needs a mouse.

   Usage:
     const scan = new ScanZone(document.querySelector('.scanzone'));
     scan.onScan(code => { ... });          // fires on Enter or idle timeout
     scan.accept('Diterima', 'Glasting 07');
     scan.reject('Salah barang');
     scan.setOffline(true);
*/
(function (global) {
  'use strict';

  const STATE = { WAITING: 'waiting', ACCEPTED: 'accepted', REJECTED: 'rejected', OFFLINE: 'offline' };

  function beep(kind) {
    try {
      const Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return;
      const ctx = beep._ctx || (beep._ctx = new Ctx());
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = kind === 'reject' ? 220 : 880;
      gain.gain.value = 0.045;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + (kind === 'reject' ? 0.34 : 0.09));
    } catch (e) { /* audio is never the only feedback */ }
  }

  /* Callers pass the Indonesian label, and the server sends "Indonesian /
     English" messages. An English reader gets the English half. */
  const EN = {
    'Salah barang': 'Wrong item', 'Benar': 'Right', 'Gagal': 'Failed',
    'Ditolak': 'Refused', 'Diterima': 'Accepted', 'Tidak terhubung': 'Not connected',
    'Tunggu koneksi kembali': 'Wait for the connection to come back',
  };
  function say(text) {
    if (!text || localStorage.getItem('njw.lang') !== 'en') {
      const pair = /^(.{6,}?) \/ (.{6,})$/.exec(text || '');
      return pair ? pair[1] : text;
    }
    if (EN[text]) return EN[text];
    const pair = /^(.{6,}?) \/ (.{6,})$/.exec(text);
    return pair ? pair[2] : text;
  }

  class ScanZone {
    constructor(root, opts) {
      this.root = root;
      this.opts = Object.assign({ minLength: 4, idleMs: 60, holdMs: 1600, sound: true }, opts || {});
      this.handlers = [];
      this.state = STATE.WAITING;
      this.stateEl = root.querySelector('.scanzone__state');
      this.promptEl = root.querySelector('.scanzone__prompt');
      this.restingState = this.stateEl ? this.stateEl.textContent : '';
      this.restingPrompt = this.promptEl ? this.promptEl.textContent : '';

      this.input = root.querySelector('.scanzone__input');
      if (!this.input) {
        this.input = document.createElement('input');
        this.input.className = 'scanzone__input';
        this.input.setAttribute('aria-label', root.dataset.scanLabel || 'Scan');
        root.appendChild(this.input);
      }
      this.input.autocomplete = 'off';
      this.input.autocapitalize = 'off';
      this.input.spellcheck = false;
      this.input.inputMode = 'none';        // a gun types; no soft keyboard wanted

      this._bind();
      this._tools();
      this.focus();
    }

    /* A phone has no scanner gun: offer its camera, and typing as the last
       resort. Both feed the same handlers as the gun, so no screen changes. */
    _tools() {
      if (this.root.dataset.noTools != null) return;
      const bar = document.createElement('div');
      bar.className = 'scantools';
      const cam = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
      bar.innerHTML =
        (cam ? '<button type="button" class="btn btn--outline scantools__btn" data-scan-camera>' +
          '<span aria-hidden="true">\u{1F4F7}</span> <span data-id="Pindai dengan kamera" data-en="Scan with camera">Pindai dengan kamera</span></button>' : '') +
        '<button type="button" class="btn btn--outline scantools__btn" data-scan-type>' +
        '<span aria-hidden="true">\u2328</span> <span data-id="Ketik kode" data-en="Type the code">Ketik kode</span></button>' +
        '<form class="scantools__type" hidden><input type="text" inputmode="text" autocomplete="off" ' +
        'autocapitalize="characters" spellcheck="false" aria-label="Kode"><button type="submit" class="btn btn--primary">OK</button></form>';
      this.root.parentNode.insertBefore(bar, this.root.nextSibling);
      const en = localStorage.getItem('njw.lang') === 'en';
      bar.querySelectorAll('[data-id]').forEach(el => { el.textContent = en ? el.dataset.en : el.dataset.id; });
      this.toolsEl = bar;
      const form = bar.querySelector('form'), input = form.querySelector('input');
      bar.querySelector('[data-scan-type]').onclick = () => {
        form.hidden = !form.hidden;
        if (!form.hidden) input.focus(); else this.focus();
      };
      form.onsubmit = (e) => {
        e.preventDefault();
        const code = input.value.trim();
        input.value = '';
        if (code) this._emit(code);
      };
      const camBtn = bar.querySelector('[data-scan-camera]');
      if (camBtn) camBtn.onclick = () => this.openCamera();
    }

    _emit(code) {
      if (code.length < this.opts.minLength) return;
      if (this.state === STATE.OFFLINE) { this.reject(this.root.dataset.offlineMsg || 'Tidak terhubung'); return; }
      this.handlers.forEach(fn => fn(code, this));
    }

    /* Camera scanning: the browser's own BarcodeDetector where it exists
       (Chrome on Android), otherwise ZXing loaded on first use. One code per
       opening: the overlay closes on a read, like pulling a gun's trigger. */
    async openCamera() {
      const en = localStorage.getItem('njw.lang') === 'en';
      const ov = document.createElement('div');
      ov.className = 'camscan';
      ov.innerHTML = '<video playsinline muted></video><div class="camscan__frame"></div>' +
        '<div class="camscan__bar"><span class="camscan__hint">' +
        (en ? 'Point the camera at the barcode' : 'Arahkan kamera ke barcode') + '</span>' +
        '<button type="button" class="btn btn--primary">' + (en ? 'Close' : 'Tutup') + '</button></div>';
      document.body.appendChild(ov);
      const video = ov.querySelector('video'), hint = ov.querySelector('.camscan__hint');
      let stream = null, stopped = false, zx = null;
      const stop = () => {
        stopped = true;
        if (zx) { try { zx.reset(); } catch (e) { /* already stopped */ } }
        if (stream) stream.getTracks().forEach(t => t.stop());
        ov.remove();
        this.focus();
      };
      ov.querySelector('button').onclick = stop;
      const done = (code) => {
        if (stopped || !code) return;
        if (navigator.vibrate) navigator.vibrate(60);
        stop();
        this._emit(String(code).trim());
      };
      try {
        if ('BarcodeDetector' in global) {
          const want = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];
          const have = await global.BarcodeDetector.getSupportedFormats();
          const det = new global.BarcodeDetector({ formats: want.filter(f => have.includes(f)) });
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
          video.srcObject = stream;
          await video.play();
          const tick = async () => {
            if (stopped) return;
            try {
              const found = await det.detect(video);
              if (found.length) return done(found[0].rawValue);
            } catch (e) { /* next frame */ }
            requestAnimationFrame(tick);
          };
          tick();
        } else {
          if (!global.ZXing) {
            await new Promise((ok, bad) => {
              const sc = document.createElement('script');
              sc.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
              sc.onload = ok; sc.onerror = bad;
              document.head.appendChild(sc);
            });
          }
          zx = new global.ZXing.BrowserMultiFormatReader();
          await zx.decodeFromConstraints({ video: { facingMode: 'environment' } }, video,
            (result) => { if (result) done(result.getText()); });
        }
      } catch (e) {
        hint.textContent = en ? 'The camera is not available here. Use "Type the code".'
                              : 'Kamera tidak bisa dipakai di sini. Pakai "Ketik kode".';
      }
    }

    _bind() {
      // Take focus back only when nothing else wants it. A page with a search
      // box, a stepper or an AWB field next to the scan zone must be typeable;
      // stealing focus from those made them unusable.
      const refocus = () => {
        if (document.visibilityState !== 'visible') return;
        const a = document.activeElement;
        if (a && a !== this.input && a !== document.body &&
            a.matches('input, select, textarea, [contenteditable="true"]')) return;
        this.focus();
      };
      this.input.addEventListener('blur', () => setTimeout(refocus, 0));
      document.addEventListener('visibilitychange', refocus);
      document.addEventListener('pointerdown', (e) => {
        // keep the target hot unless the user is deliberately hitting a control
        if (!e.target.closest('button, a, input, select, textarea, [tabindex]')) setTimeout(refocus, 0);
      });
      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this._commit(); }
      });
      this.input.addEventListener('input', () => {
        clearTimeout(this._idle);
        this._idle = setTimeout(() => this._commit(), this.opts.idleMs + 140);
      });
      global.addEventListener('online', () => this.setOffline(false));
      global.addEventListener('offline', () => this.setOffline(true));
    }

    _commit() {
      clearTimeout(this._idle);
      const code = (this.input.value || '').trim();
      this.input.value = '';
      this._emit(code);
    }

    onScan(fn) { this.handlers.push(fn); return this; }
    focus() { try { this.input.focus({ preventScroll: true }); } catch (e) { this.input.focus(); } }

    _paint(state, label, prompt) {
      if (state !== STATE.WAITING) { label = say(label); prompt = say(prompt); }
      this.state = state;
      this.root.classList.remove('is-accepted', 'is-rejected', 'is-offline');
      if (state !== STATE.WAITING) this.root.classList.add('is-' + state);
      if (this.stateEl) this.stateEl.textContent = label;
      if (this.promptEl) this.promptEl.textContent = prompt;
      this.root.setAttribute('data-state', state);
    }

    rest() { this._paint(STATE.WAITING, this.restingState, this.restingPrompt); }

    accept(label, detail) {
      this._paint(STATE.ACCEPTED, label || 'Diterima', detail || '');
      if (this.opts.sound) beep('accept');
      clearTimeout(this._hold);
      this._hold = setTimeout(() => this.rest(), this.opts.holdMs);
    }

    reject(label, detail) {
      // An accept's pending auto-clear must not wipe a rejection that follows
      // it within the hold time: the rejection is the one that matters.
      clearTimeout(this._hold);
      this._paint(STATE.REJECTED, label || 'Salah barang', detail || '');
      if (this.opts.sound) beep('reject');
      // a rejection is held until the person acts on it — no auto-clear
    }

    setOffline(off) {
      if (off) this._paint(STATE.OFFLINE, 'Tidak terhubung', this.root.dataset.offlineMsg || 'Tunggu koneksi kembali');
      else this.rest();
    }
  }

  ScanZone.STATE = STATE;
  global.ScanZone = ScanZone;
})(window);
