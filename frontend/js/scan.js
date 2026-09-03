/* The scan handler — the single most important component in the product.
 *
 * Primary input is a Bluetooth/USB HID scanner, which behaves as a keyboard:
 * it types the digits fast and presses Enter. We detect that by inter-keystroke
 * timing so a scan never looks like typing. The field is also usable by hand,
 * which is how testing works before scanners arrive.
 *
 * Owns: focus (a stray click must not swallow a scan), duplicate suppression,
 * and audible + visual feedback on every result.
 */
const Scan = (() => {
  let audioCtx = null;

  function tone(freq, ms, type = 'sine') {
    if (localStorage.getItem('wms.mute') === '1') return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.value = 0.06;
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + ms / 1000);
    } catch { /* audio is a nicety, never a dependency */ }
  }

  const beepOk   = () => tone(1050, 90);
  const beepWarn = () => tone(620, 150, 'triangle');
  const beepBad  = () => { tone(240, 260, 'square'); };

  /* Mount a scan field. `onScan(code)` is called with a trimmed, non-empty code.
   * Returns handles the view can use to show state and reclaim focus. */
  function mount(zoneEl, onScan) {
    const input = zoneEl.querySelector('input');
    let lastCode = '', lastAt = 0, lastKeyAt = 0, fastKeys = 0;

    input.addEventListener('keydown', e => {
      const now = Date.now();
      if (e.key !== 'Enter') {
        // < 50 ms between characters means a machine is typing, not a person.
        if (now - lastKeyAt < 50) fastKeys++;
        else fastKeys = 0;
        lastKeyAt = now;
        return;
      }
      e.preventDefault();
      const code = input.value.trim();
      input.value = '';
      if (!code) return;

      // The same barcode twice inside 300 ms is one unit, scanned twice.
      if (code === lastCode && now - lastAt < 300) return;
      lastCode = code; lastAt = now;

      onScan(code, { fromScanner: fastKeys >= 3 });
      fastKeys = 0;
    });

    // Keep the target focused. A click anywhere that is not another control
    // returns focus here, so a scan is never lost to a stray tap.
    const refocus = () => {
      if (document.activeElement && document.activeElement !== document.body) {
        const t = document.activeElement.tagName;
        if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA' || t === 'BUTTON') return;
      }
      input.focus();
    };
    document.addEventListener('click', refocus);
    setTimeout(refocus, 60);

    return {
      focus: refocus,
      state(kind) {                       // '', 'ok', 'warn', 'bad'
        zoneEl.classList.remove('ok', 'warn', 'bad');
        if (kind) zoneEl.classList.add(kind);
        if (kind === 'ok') beepOk();
        if (kind === 'warn') beepWarn();
        if (kind === 'bad') beepBad();
      },
      destroy() { document.removeEventListener('click', refocus); },
    };
  }

  return { mount, beepOk, beepWarn, beepBad };
})();
