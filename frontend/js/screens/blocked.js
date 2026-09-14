/* blocked.js — 14: the stop screen. Dark on purpose, reached without boot.
 *
 * Replaces the wire.js `blocked` handler, which left the design's incident
 * code, order and "last saved" time on screen. Everything shown now is
 * observed on this device: which order was in hand, when the last scan was
 * saved, and what a quick probe says is wrong. The incident code names that
 * probe result, so a supervisor hears the same code for the same fault.
 *
 * wire.js dispatches this screen BEFORE boot (a signed-out device cannot
 * boot), so W.me()/W.site() are null here and nothing may depend on them.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, bi, go, say, CTX } = W;

  async function probe() {
    if (!navigator.onLine) return 'E-NET';
    try {
      const h = await fetch('/api/health', { cache: 'no-store' });
      if (!h.ok) return 'E-SRV';
    } catch { return 'E-NET'; }
    try {
      await NJW.api.me();
      return 'OK';
    } catch (e) {
      if (e.status === 401) return 'E-401';
      if (e.status === 403) return 'E-403';
      return 'E-SRV';
    }
  }

  const COPY = {
    'E-NET': ['Koneksi ke sistem hilang.', 'The connection to the system dropped.'],
    'E-SRV': ['Sistem sedang tidak menjawab.', 'The system is not answering.'],
    'E-401': ['Kamu belum masuk, atau sesi masukmu berakhir.', 'You are not signed in, or your sign-in expired.'],
    'E-403': ['Akun ini belum punya akses ke aplikasi.', 'This account has no access to the app yet.'],
    'OK':    ['Sistem sudah terhubung lagi.', 'The system is connected again.'],
  };

  NJW.screens.blocked = async () => {
    const task = CTX.get('task');
    const info = CTX.get('blocked') || {};
    const ref = info.ref || (task && task.external_ref) || null;
    const back = ref ? '07-ambil-pesanan.html' : 'index.html';

    // No boot means no user: the design's name must not stay on screen.
    $$('.chrome__user').forEach(el => { el.textContent = ''; });
    const mode = $('.chrome__mode');
    if (mode) bi(mode, ref ? 'Ambil pesanan · ' + ref : 'Terkunci', ref ? 'Pick order · ' + ref : 'Blocked');

    const facts = $$('.fact__val');
    const lastSave = CTX.get('lastSave');
    if (facts[0]) facts[0].textContent = '…';
    if (facts[1]) facts[1].textContent = ref || '—';
    // Only a save for THIS order counts; an earlier order's time would mislead.
    if (facts[2]) facts[2].textContent =
      lastSave && lastSave.ref === ref && lastSave.at ? NJW.fmt.time(lastSave.at) : '—';

    const card = $('.blocked__card');
    const headline = card && card.children[0];
    const instr = card && card.children[1];

    async function diagnose() {
      const code = await probe();
      if (facts[0]) facts[0].textContent = code === 'OK' ? '—' : code;
      const c = COPY[code];
      bi(headline,
         ref && code === 'E-NET' ? 'Koneksi ke sistem hilang saat pesanan sedang diambil.' : c[0],
         ref && code === 'E-NET' ? 'The connection dropped while this order was being picked.' : c[1]);
      if (code === 'OK') {
        bi(instr, 'Tekan "Coba sambungkan ulang" untuk melanjutkan.', 'Press "Try reconnecting" to carry on.');
      } else if (ref) {
        bi(instr, 'Jangan ambil barang lagi dan jangan tutup layar ini. Panggil supervisor dan tunjukkan kode di bawah.',
                  'Do not pick any more items and do not close this screen. Call your supervisor and show the code below.');
      } else {
        bi(instr, 'Jangan tutup layar ini. Panggil supervisor dan tunjukkan kode di bawah.',
                  'Do not close this screen. Call your supervisor and show the code below.');
      }
      return code;
    }
    await diagnose();

    /* Retry goes back to the work in hand. The pick screen reloads the order
       from the server, so nothing saved before the drop is lost or doubled. */
    const retry = $('.btn--primary');
    if (retry) {
      retry.removeAttribute('onclick');
      retry.onclick = async () => {
        const code = await diagnose();
        if (code === 'OK') { CTX.del('blocked'); go(back); }
        else say(localStorage.getItem('njw.lang') === 'en' ? 'Still not connected.' : 'Masih belum terhubung.');
      };
    }
    const here = $('.stats a.btn--outline');
    if (here) {
      here.href = back;
      here.onclick = () => CTX.del('blocked');
    }
  };
})();
