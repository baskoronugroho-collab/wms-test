/* legacy.js: where the old station (frontend/NN-*.html) and console
   (frontend/console/*.html) addresses now live in the one app.

   Two users:
   - every old page is a tiny stub that loads this file: it sends the browser
     to the new page, keeping the old query string and hash (?id=12 stays);
   - NJW.shell.route() reads the same table to turn an old link (a Perlu
     tindakan row, a bookmark) into the new page.
   Keys are paths relative to frontend/; values are relative to frontend/app/. */
(function () {
  'use strict';
  var map = {
    'index.html': 'perlu-tindakan.html',
    '01-mulai-barang-masuk.html': 'barang-masuk.html',
    '02-barang-masuk-scan.html': 'barang-masuk.html',
    '03-barcode-tidak-dikenal.html': 'barang-masuk.html',
    '04-buat-keranjang.html': 'barang-masuk.html',
    '05-label-unit.html': 'produk.html',
    '06-label-sudah-terpakai.html': 'produk.html',
    '07-ambil-pesanan.html': 'pesanan.html?tab=ambil',
    '08-salah-barang.html': 'pesanan.html?tab=ambil',
    '09-pesanan-selesai.html': 'pesanan.html?tab=ambil',
    '10-hitung-pilih-keranjang.html': 'hitung-stok.html',
    '11-hitung-menghitung.html': 'hitung-stok.html',
    '12-hasil-hitung.html': 'hitung-stok.html',
    '13-peta-rak.html': 'rak-bin.html',
    '14-terkunci.html': 'perlu-tindakan.html',
    '15-penerimaan-selesai.html': 'barang-masuk.html',
    '17-barang-tidak-ada.html': 'pesanan.html?tab=ambil',
    '18-kembalikan.html': 'pesanan.html?tab=kembalikan',
    '18-kembalikan-pindai.html': 'pesanan.html?tab=kembalikan',
    '19-gudang-kirim.html': 'stok.html',
    '20-tempel-pesanan.html': 'pesanan.html?tab=papan',
    '21-pesanan-hub.html': 'pesanan.html?tab=kemas',
    'console/index.html': 'perlu-tindakan.html',
    'console/perlu-tindakan.html': 'perlu-tindakan.html',
    'console/pengingat.html': 'pengaturan.html?tab=aturan',
    'console/barang-masuk.html': 'barang-masuk.html',
    'console/slip-putaway.html': 'barang-masuk.html',
    'console/slip-detail.html': 'barang-masuk.html',
    'console/pesanan.html': 'pesanan.html',
    'console/papan-antrean.html': 'pesanan.html?tab=papan',
    'console/transfer.html': 'stok.html',
    'console/restock-brand.html': 'restock.html',
    'console/selisih-restock.html': 'restock.html?tab=selisih',
    'console/stok.html': 'stok.html',
    'console/stok-perhatian.html': 'stok.html',
    'console/hitung-stok.html': 'hitung-stok.html',
    'console/registry.html': 'rak-bin.html',
    'console/rak.html': 'rak-bin.html',
    'console/peta-hub.html': 'rak-bin.html',
    'console/label-warna-hari.html': 'rak-bin.html',
    'console/stok-hiryu.html': 'menu-toko-hiryu.html',
    'console/permintaan-sku.html': 'produk.html',
    'console/lengkapi-sku.html': 'produk.html',
    'console/produk.html': 'produk.html',
    'console/menu-hiryu.html': 'menu-toko-hiryu.html',
    'console/laporan-merek.html': 'laporan.html',
    'console/hub.html': 'pengaturan.html?tab=hub',
    'console/staf.html': 'pengaturan.html?tab=orang',
    'console/integrasi.html': 'pengaturan.html?tab=integrasi',
    'console/simulator-grab.html': 'pengaturan.html?tab=demo',
    'console/mode-latihan.html': 'pengaturan.html?tab=demo'
  };
  /* to + the old query (merged, the old values win) + the old hash */
  function join(to, search, hash) {
    var q = (search || '').replace(/^\?/, '');
    if (!q) return to + (hash || '');
    var parts = to.split('?'), base = parts[0];
    var out = new URLSearchParams(parts[1] || '');
    new URLSearchParams(q).forEach(function (v, k) { out.set(k, v); });
    var s = out.toString();
    return base + (s ? '?' + s : '') + (hash || '');
  }
  window.NJW_LEGACY = { map: map, join: join };

  /* Loaded by an old page: go. The new pages load it too, and stay. */
  var path = location.pathname;
  if (/\/app\/[^/]*$/.test(path)) return;
  var seg = path.split('/').filter(Boolean);
  var name = seg.length ? seg[seg.length - 1] : 'index.html';
  if (!/\.html$/.test(name)) name = 'index.html';
  var inConsole = seg.length > 1 && seg[seg.length - 2] === 'console';
  var key = inConsole ? 'console/' + name : name;
  var to = map[key] || 'perlu-tindakan.html';
  var prefix = inConsole ? '../app/' : 'app/';
  location.replace(prefix + join(to, location.search, location.hash));
})();
