/* pengaturan-printer.js: Pengaturan, tab Printer.
 *
 * Two printers per hub, the same set up as Hiryu's packing slip (HIRYU-POS 1.5):
 *   thermal 80 mm receipt printer (Posmac/Birch CP-Q1T, USB, ESC/POS) at the
 *   packing counter, shared with Hiryu: the putaway slip, later any slip;
 *   A4 office printer: rack and bin labels, the return note, the guide.
 * Settings are per device: saved in this browser profile (js/print.js,
 * localStorage njw.printer), not per person, like Hiryu's Receipt printer page.
 * Every role may open this tab and set its own device. No API.
 */
(function () {
  'use strict';
  const S = NJW.shell;
  const { esc, bis, biAttr, icon, t } = S;

  if (!document.getElementById('pp-css')) {
    const st = document.createElement('style');
    st.id = 'pp-css';
    st.textContent = '.pp-cols{display:grid;gap:16px;align-items:start}@media(min-width:1024px){.pp-cols{grid-template-columns:repeat(2,minmax(0,1fr))}}' +
      '.pp-docs{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:8px}.pp-docs li{line-height:1.4}.pp-where{display:block;font-size:13px;color:var(--muted)}' +
      '.pp-set{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;padding:14px 0;border-top:1px solid var(--rule)}.pp-set:first-of-type{border-top:0;padding-top:0}' +
      '.pp-set__label{font-weight:700}.pp-set.is-off{opacity:.55}.pp-set .k-segment{justify-self:start;flex-wrap:wrap}' +
      '.pp-guide{margin:0;padding-left:22px;display:flex;flex-direction:column;gap:12px}.pp-guide li{line-height:1.45}' +
      '.pp-code{display:block;margin-top:6px;padding:10px 12px;border-radius:10px;background:var(--sunk);font-family:var(--mono);font-size:13px;overflow-wrap:anywhere;color:var(--ink)}' +
      '.pp-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}';
    document.head.appendChild(st);
  }

  const P = () => NJW.print;
  const sp = (id, en, cls) => bis(id, en, cls);
  const p = (id, en, cls) => '<p class="' + (cls || 'k-p') + '" style="margin:0">' + bis(id, en) + '</p>';
  const doc = (id, en, whereId, whereEn) => '<li>' + bis(id, en, 'k-strong') + '<span class="pp-where" ' + biAttr(whereId, whereEn) + '>' + esc(t(whereId, whereEn)) + '</span></li>';
  const seg = (attr, items, cur, disabled) => '<div class="k-segment" role="group">' + items.map((x) =>
    '<button type="button" ' + attr + '="' + x[0] + '" aria-pressed="' + (String(cur) === String(x[0])) + '"' + (disabled ? ' disabled' : '') + '>' + bis(x[1], x[2]) + '</button>').join('') + '</div>';

  /* ---------- what goes where ---------- */
  function printersCard() {
    return '<div class="pp-cols">' +
      '<div class="k-card k-card--pad k-stack">' +
        '<div class="pp-head">' + icon('print', 22) + '<h2 class="k-h2" style="margin:0" ' + biAttr('Printer thermal 80 mm', 'Thermal printer, 80 mm') + '></h2></div>' +
        p('Printer struk USB di meja kemas, yang sama dengan printer slip kemas Hiryu (Posmac/Birch CP-Q1T, ESC/POS). Satu printer dipakai bersama oleh Hiryu dan WMS. Kertas 80 mm, 48 karakter per baris.',
          'The USB receipt printer at the packing counter, the same one Hiryu prints its packing slips on (Posmac/Birch CP-Q1T, ESC/POS). Hiryu and the WMS share one printer. 80 mm paper, 48 characters a line.') +
        '<ol class="pp-docs">' +
          doc('Slip putaway', 'Putaway slip', 'Barang masuk, langkah Cetak slip: satu slip per bin sementara (atau cetak otomatis saat penerimaan selesai).', 'Inbound, the Print slips step: one slip per temporary bin (or auto-print when the receipt is finished).') +
          doc('Slip kemas pesanan', 'Order packing slip', 'Dicetak oleh Hiryu, bukan oleh WMS, di printer yang sama.', 'Printed by Hiryu, not by the WMS, on the same printer.') +
          doc('Slip lain nanti', 'Other slips later', 'Slip baru di WMS memakai printer ini juga.', 'New WMS slips use this printer too.') +
        '</ol></div>' +
      '<div class="k-card k-card--pad k-stack">' +
        '<div class="pp-head">' + icon('report', 22) + '<h2 class="k-h2" style="margin:0" ' + biAttr('Printer A4', 'A4 printer') + '></h2></div>' +
        p('Printer kantor apa saja yang memakai kertas A4. Cetak dari profil Chrome biasa, lalu pilih printer A4 di dialog cetak. Skala 100%.',
          'Any office printer that takes A4 paper. Print from the normal Chrome profile and choose the A4 printer in the print dialog. Scale 100%.') +
        '<ol class="pp-docs">' +
          doc('Label rak dan bin', 'Rack and bin labels', 'Rak & bin: Cetak label per rak, Cetak ulang label satu bin, dan label bin khusus (bin sementara, baki karantina, keranjang pesanan).', 'Rak & bin: Cetak label for a rack, Cetak ulang label for one bin, and the special bin labels (temporary bins, quarantine trays, order baskets).') +
          doc('Nota retur ke merek, 2 salinan', 'Return note to the brand, 2 copies', 'Karantina & retur, Retur ke merek: Cetak nota retur.', 'Karantina & retur, Retur ke merek: Cetak nota retur.') +
          doc('Panduan dan halaman lain', 'The guide and other pages', 'Dicetak dari browser (Ctrl+P).', 'Printed from the browser (Ctrl+P).') +
          doc('Slip putaway, jika perangkat ini tidak punya printer thermal', 'The putaway slip, when this device has no thermal printer', 'Slip yang sama, di kertas A4.', 'The same slip, on A4 paper.') +
        '</ol></div></div>';
  }

  /* ---------- this device ---------- */
  function deviceCard(s) {
    const th = s.thermal === true;
    const status = s.thermal === true ? S.pill('ok', 'Thermal ' + s.width + ' mm', 'Thermal ' + s.width + ' mm')
      : s.thermal === false ? S.pill('info', 'Tanpa thermal: slip di A4', 'No thermal: slips on A4')
        : S.pill('caution', 'Belum diatur', 'Not set up');
    return '<div class="k-card k-card--pad k-stack">' +
      '<div class="k-line k-line--between" style="flex-wrap:wrap;gap:10px"><h2 class="k-h2" style="margin:0" ' + biAttr('Perangkat ini', 'This device') + '></h2>' + status + '</div>' +
      p('Disimpan di profil browser ini di PC ini, bukan per orang. Sama seperti pengaturan printer di Hiryu. Atur sekali di setiap profil Chrome yang dipakai untuk mencetak.',
        'Saved in this browser profile on this PC, not per person, the same as Hiryu\'s printer settings. Set it once in each Chrome profile used for printing.', 'k-caption') +
      '<div>' +
        '<div class="pp-set"><span class="pp-set__label" ' + biAttr('Perangkat ini punya printer thermal', 'This device has a thermal printer') + '></span>' +
          seg('data-thermal', [['1', 'Ya', 'Yes'], ['0', 'Tidak', 'No']], s.thermal === true ? '1' : s.thermal === false ? '0' : '') +
          '<span class="k-caption" ' + biAttr('Tidak: slip dicetak di kertas A4.', 'No: slips print on A4 paper.') + '></span></div>' +
        '<div class="pp-set' + (th ? '' : ' is-off') + '"><span class="pp-set__label" ' + biAttr('Lebar kertas', 'Paper width') + '></span>' +
          seg('data-width', [['80', '80 mm (disarankan)', '80 mm (recommended)'], ['58', '58 mm', '58 mm']], s.width, !th) +
          '<span class="k-caption" ' + biAttr('80 mm: 48 karakter per baris, sama dengan Hiryu. 58 mm: 32 karakter, nama produk lebih sering pindah baris.', '80 mm: 48 characters a line, as in Hiryu. 58 mm: 32 characters, product names wrap more often.') + '></span></div>' +
        '<div class="pp-set' + (th ? '' : ' is-off') + '"><label class="k-check"><input type="checkbox" data-kiosk' + (s.kiosk ? ' checked' : '') + (th ? '' : ' disabled') + '>' +
          sp('Profil Chrome ini mencetak tanpa dialog (kiosk-printing)', 'This Chrome profile prints without a dialog (kiosk-printing)') + '</label>' +
          '<span class="k-caption" ' + biAttr('Halaman web tidak bisa memeriksanya sendiri. Centang hanya jika profil ini dibuka dengan --kiosk-printing (langkah 4 di bawah).', 'A web page cannot check this itself. Tick it only when this profile is started with --kiosk-printing (step 4 below).') + '></span></div>' +
        '<div class="pp-set' + (th ? '' : ' is-off') + '"><div class="k-switchrow"><button type="button" class="k-switch" data-auto aria-checked="' + !!s.autoSlip + '"' + (th ? '' : ' disabled') +
          ' data-aria-id="Cetak slip putaway otomatis" data-aria-en="Auto-print the putaway slip" aria-label="' + esc(t('Cetak slip putaway otomatis', 'Auto-print the putaway slip')) + '"></button>' +
          sp('Cetak slip putaway otomatis saat penerimaan selesai', 'Auto-print the putaway slip when a receipt is finished', 'pp-set__label') + '</div>' +
          '<span class="k-caption" ' + biAttr('Seperti cetak otomatis slip kemas di Hiryu: sekali per penerimaan, dari perangkat ini. Nyalakan di satu profil saja, kalau tidak slip tercetak dua kali. Perangkat lain menampilkan tombol Cetak slip.',
            'Like Hiryu\'s packing slip auto-print: once per receipt, from this device. Switch it on in one profile only, or every slip prints twice. Other devices show the Print slips button instead.') + '></span></div>' +
      '</div></div>';
  }

  function testCard(s) {
    return '<div class="k-card k-card--pad k-stack">' +
      '<h2 class="k-h2" style="margin:0" ' + biAttr('Cetak tes', 'Test print') + '></h2>' +
      p('Tes thermal mencetak penggaris ' + (s.thermal === true ? (s.width === 58 ? 32 : 48) : 48) + ' kolom, seperti halaman tes Hiryu, jadi terlihat di mana nama panjang terpotong. Tes A4 mencetak garis 100 mm untuk mengecek skala label.',
        'The thermal test prints a ' + (s.thermal === true ? (s.width === 58 ? 32 : 48) : 48) + ' column ruler, like Hiryu\'s test page, so you see where a long name gets cut. The A4 test prints a 100 mm line to check the label scale.', 'k-caption') +
      '<div class="k-line" style="gap:10px;flex-wrap:wrap">' +
        '<button type="button" class="k-btn k-btn--primary" data-test-thermal>' + icon('print') + sp('Cetak tes thermal', 'Thermal test print') + '</button>' +
        '<button type="button" class="k-btn k-btn--secondary" data-test-a4>' + icon('print') + sp('Cetak tes A4', 'A4 test print') + '</button></div>' +
      (s.thermal === true ? '' : '<div class="k-note k-note--info">' + icon('info', 20) + sp('Perangkat ini belum ditandai punya printer thermal, jadi tes thermal keluar di kertas A4.', 'This device is not marked as having a thermal printer, so the thermal test comes out on A4.') + '</div>') +
      '</div>';
  }

  /* ---------- the set up guide, the same as Hiryu's ---------- */
  function guideCard() {
    const step = (id, en, extra) => '<li>' + bis(id, en) + (extra || '') + '</li>';
    return '<div class="k-card k-card--pad k-stack">' +
      '<h2 class="k-h2" style="margin:0" ' + biAttr('Cara memasang, sama seperti Hiryu', 'How to set up, the same as Hiryu') + '></h2>' +
      p('Printer thermal dan cara pasangnya sama dengan slip kemas Hiryu. Kerjakan sekali di PC meja kemas, bersama pemasangan printer Hiryu.',
        'The thermal printer and its set up are the same as for Hiryu\'s packing slip. Do it once on the packing counter PC, together with the Hiryu printer set up.', 'k-caption') +
      '<div class="k-note k-note--stop">' + icon('warn', 20) + sp('Pakai jalur printer Windows, bukan USB langsung. Jalur USB langsung di panduan Hiryu mengganti driver printer dengan WinUSB lewat Zadig. Setelah itu tidak ada program lain di PC itu yang bisa mencetak: printer A4 tidak, WMS juga tidak. Printer thermal dipakai bersama oleh Hiryu dan WMS, jadi jalur itu tidak boleh dipakai.',
        'Use the Windows printer route, not direct USB. The direct USB route in Hiryu\'s guide swaps the printer driver for WinUSB with Zadig. After that nothing else on the PC can print: not the A4 printer, not the WMS. Hiryu and the WMS share the thermal printer, so that route must not be used.') + '</div>' +
      '<ol class="pp-guide">' +
        step('Colokkan printer thermal lewat USB dan pasang driver Windows-nya. Di Windows, Printer, Printing preferences, atur ukuran kertas 80 mm (lebar cetak 72 mm).',
          'Plug the thermal printer in over USB and install its Windows driver. In Windows, Printers, Printing preferences, set the paper size to 80 mm (72 mm printable).') +
        step('Jadikan printer thermal printer default Windows.', 'Make the thermal printer the Windows default printer.') +
        step('Pasang printer A4 di PC yang sama, tetapi jangan jadikan default.', 'Install the A4 printer on the same PC, but do not make it the default.') +
        step('Buat profil Chrome "Kemas" yang mencetak tanpa dialog. Buat shortcut di desktop dengan target ini, lalu selalu buka Kemas dari shortcut itu:',
          'Make a Chrome profile "Kemas" that prints without a dialog. Make a desktop shortcut with this target, and always open Kemas from that shortcut:',
          '<code class="pp-code">"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir="C:\\Chrome-Kemas" --kiosk-printing</code>' +
          '<span class="k-caption" style="display:block;margin-top:6px" ' + biAttr('Folder sendiri membuat Kemas berjalan terpisah dari Chrome biasa, jadi kiosk-printing tidak ikut ke profil biasa. Di Kemas, buka Hiryu Live Orders dan WMS, lalu masuk di keduanya. Slip kemas Hiryu dan slip WMS keluar diam-diam di printer default, yaitu thermal.',
            'Its own folder keeps Kemas apart from the normal Chrome, so kiosk-printing does not reach the normal profile. In Kemas, open Hiryu Live Orders and the WMS and sign in to both. Hiryu packing slips and WMS slips then print silently on the default printer, the thermal one.') + '></span>') +
        step('Di profil Kemas, buka Pengaturan, Printer ini: Ya, 80 mm, centang kiosk-printing. Nyalakan cetak otomatis di sini saja jika dipakai.',
          'In the Kemas profile, open this Settings, Printer tab: Yes, 80 mm, tick kiosk-printing. Switch auto-print on here only, if used.') +
        step('Pakai profil Chrome biasa untuk cetakan A4 (label rak dan bin, nota retur). Dialog cetak muncul: pilih printer A4 sekali, Chrome mengingatnya. Di profil biasa, pilih Tidak untuk printer thermal, atau Ya tanpa centang kiosk-printing.',
          'Use the normal Chrome profile for A4 prints (rack and bin labels, return notes). The print dialog appears: choose the A4 printer once and Chrome remembers it. In the normal profile choose No for the thermal printer, or Yes without ticking kiosk-printing.') +
        step('Tes: di Kemas tekan Cetak tes thermal. Slip harus keluar tanpa dialog dan penggaris tidak terpotong. Di profil biasa tekan Cetak tes A4 dan ukur garis 100 mm.',
          'Test: in Kemas press Cetak tes thermal. The slip must come out with no dialog and the ruler uncut. In the normal profile press Cetak tes A4 and measure the 100 mm line.') +
      '</ol>' +
      '<div class="k-note k-note--info">' + icon('info', 20) + sp('Kenapa dua profil? Halaman web tidak bisa memilih printer sendiri. Profil Kemas selalu mencetak tanpa dialog ke printer default (thermal). Profil biasa menampilkan dialog, jadi staf bisa memilih printer A4.',
        'Why two profiles? A web page cannot choose a printer by itself. The Kemas profile always prints without a dialog to the default printer (thermal). The normal profile shows the dialog, so staff can choose the A4 printer.') + '</div>' +
      '</div>';
  }

  /* ---------- test prints (paper copy is Indonesian, like the other printouts) ---------- */
  function thermalTest() {
    const pr = P(), s = pr.settings(), W = pr.cols();
    const tens = Array.from({ length: W }, (_, i) => ((i + 1) % 10 === 0 ? String(((i + 1) / 10) % 10) : ' ')).join('');
    const ones = Array.from({ length: W }, (_, i) => String((i + 1) % 10)).join('');
    const ticks = Array.from({ length: W }, (_, i) => ((i + 1) % 10 === 0 ? '|' : (i + 1) % 5 === 0 ? '+' : '.')).join('');
    const name = 'Labore GentleBiome Mild Cleanser Sensitive Skin 100 ml';
    const cut = (x, w) => (x.length > w ? x.slice(0, w) : x + ' '.repeat(w - x.length));
    const hub = S.site() ? S.shortCode(S.site().code) : '-';
    const lines = [
      { b: pr.center('TES PRINTER THERMAL', W) },
      pr.center('SatSet WMS · dark store ' + hub, W),
      pr.center((s.thermal === true ? s.width : 80) + ' mm · ' + W + ' karakter per baris', W),
      pr.rule('=', W),
      tens, ones, ticks,
      pr.wrap('Baris angka harus berakhir dengan ' + (W % 10) + ' (kolom ' + W + ') di tepi kanan. Jika terpotong atau pindah baris, ukuran kertas di Windows salah.', W),
      pr.rule('-', W),
      { b: 'Nama dipotong (cara slip kemas Hiryu):' },
      cut(name, W - 4) + '  x2',
      '',
      { b: 'Nama dibungkus (cara slip WMS):' },
      pr.wrap('1. ' + name, W, '   '),
      pr.lr('   Jumlah', '2 pcs', W),
      pr.rule('-', W),
      pr.lr('Kiosk-printing', s.kiosk ? 'ya' : 'tidak', W),
      pr.lr('Dicetak', pr.when().both, W),
      pr.rule('=', W),
      pr.center('Tes selesai', W),
    ];
    return pr.thermal(pr.slip(lines), { title: 'Tes printer thermal' });
  }
  function a4Test() {
    const pr = P(), hub = S.site() ? S.shortCode(S.site().code) : '-';
    const html = '<div style="border:1px solid #000;padding:10mm;min-height:250mm;box-sizing:border-box">' +
      '<div style="font-weight:700;font-size:20pt">Tes printer A4</div>' +
      '<div style="margin-top:2mm">SatSet WMS · dark store ' + pr.esc(hub) + ' · dicetak ' + pr.esc(pr.when().both) + '</div>' +
      '<p style="margin-top:8mm;font-size:12pt;line-height:1.5">Jika halaman ini keluar utuh di kertas A4 dengan bingkai lengkap, printer A4 siap untuk label rak dan bin dan nota retur ke merek.</p>' +
      '<p style="font-size:12pt;line-height:1.5">Ukur garis di bawah ini. Panjangnya harus 100 mm. Jika lebih pendek atau lebih panjang, atur skala di dialog cetak ke 100% (bukan Sesuaikan dengan halaman).</p>' +
      '<div style="margin-top:6mm;width:100mm;border-top:2px solid #000;position:relative;height:6mm">' +
        Array.from({ length: 11 }, (_, i) => '<span style="position:absolute;top:0;left:' + (i * 10) + 'mm;width:0;height:' + (i % 5 === 0 ? 5 : 3) + 'mm;border-left:1px solid #000"></span>').join('') + '</div>' +
      '<div style="display:flex;justify-content:space-between;width:100mm;font-size:9pt"><span>0</span><span>50 mm</span><span>100 mm</span></div>' +
      '<p style="margin-top:12mm;font-size:12pt">Printer thermal (slip putaway) diuji terpisah dengan Cetak tes thermal.</p></div>';
    return pr.a4(html, { title: 'Tes printer A4' });
  }

  S.tab('printer', function (ctx) {
    S.setSub('Dua printer per dark store: thermal 80 mm untuk slip, A4 untuk label dan nota. Diatur per perangkat, sama seperti Hiryu.',
      'Two printers per dark store: thermal 80 mm for slips, A4 for labels and notes. Set per device, the same as Hiryu.');
    const host = ctx.body;
    if (!P()) {
      host.innerHTML = '<div class="k-note k-note--stop">' + icon('warn', 20) + sp('Modul cetak (js/print.js) tidak termuat. Muat ulang halaman.', 'The print module (js/print.js) did not load. Reload the page.') + '</div>';
      return;
    }
    function paint() {
      const s = P().settings();
      host.innerHTML = '<div class="k-stack k-stack--loose">' + printersCard() +
        '<div class="pp-cols"><div class="k-stack">' + deviceCard(s) + testCard(s) + '</div>' + guideCard() + '</div></div>';
      S.applyLang(host);
      const set = (patch, msg) => { P().save(patch); if (msg) S.toast(msg, 'ok', 1500); paint(); };
      host.querySelectorAll('[data-thermal]').forEach((b) => b.addEventListener('click', () =>
        set(b.dataset.thermal === '1' ? { thermal: true } : { thermal: false, autoSlip: false }, ['Tersimpan di perangkat ini.', 'Saved on this device.'])));
      host.querySelectorAll('[data-width]').forEach((b) => b.addEventListener('click', () => set({ width: +b.dataset.width }, ['Tersimpan di perangkat ini.', 'Saved on this device.'])));
      const k = host.querySelector('[data-kiosk]');
      if (k) k.addEventListener('change', () => set({ kiosk: k.checked }, ['Tersimpan di perangkat ini.', 'Saved on this device.']));
      const a = host.querySelector('[data-auto]');
      if (a) S.toggle(a, (on) => {
        set({ autoSlip: on }, on ? ['Cetak otomatis menyala di profil ini. Pastikan mati di profil lain.', 'Auto-print is on in this profile. Make sure it is off in the others.']
          : ['Cetak otomatis mati.', 'Auto-print is off.']);
      });
      host.querySelector('[data-test-thermal]').addEventListener('click', () => thermalTest());
      host.querySelector('[data-test-a4]').addEventListener('click', () => a4Test());
    }
    paint();
  });
})();
