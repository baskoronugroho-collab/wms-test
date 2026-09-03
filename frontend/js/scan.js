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
      this.focus();
    }

    _bind() {
      const refocus = () => { if (document.visibilityState === 'visible') this.focus(); };
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
      if (code.length < this.opts.minLength) return;
      if (this.state === STATE.OFFLINE) { this.reject(this.root.dataset.offlineMsg || 'Tidak terhubung'); return; }
      this.handlers.forEach(fn => fn(code, this));
    }

    onScan(fn) { this.handlers.push(fn); return this; }
    focus() { try { this.input.focus({ preventScroll: true }); } catch (e) { this.input.focus(); } }

    _paint(state, label, prompt) {
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
