# Ninja Kilat WMS: kebutuhan sistem dan instruksi kerja

| | |
|---|---|
| **Produk** | Ninja Kilat WMS |
| **Versi** | v3.1: satu halaman untuk semua orang. Bagian A berisi instruksi kerja dengan gambar layar, Bagian B kebutuhan sistem, Bagian C keputusan dan hal terbuka. v3.1 menambahkan pendaftaran pengguna dan dark store, gambar rak, kode SKU Hiryu, nama sederhana untuk angka stok, pengiriman tanpa AWB yang tercatat, bin sementara barang masuk, tombol batal, langkah karantina, dan layar Hiryu yang digambar ulang dari Hiryu Malaysia |
| **Tanggal** | 25 September 2026 |
| **Pemilik** | Baskoro Nugroho |
| **Status** | Spesifikasi untuk ditinjau. Layar WMS di Bagian A masih draf, bukan aplikasi live. Alur barang tidak ada (A5.1, §10.2) masih menunggu jawaban Grab |
| **Acuan** | *QC Systems: Hiryu, WMS, TMS* (ChangWen, 11 Sep 2026), `docs/canonical/qc-oms-wms.html`, untuk desain jangka panjang. Jika build pertama butuh solusi sementara (belum ada koneksi ke Hiryu), halaman ini menyebutkannya |
| **Menggantikan** | v2.7 tanggal 21 September (disimpan di `docs/archive/PRD-v2.7.md`) dan semua versi sebelumnya |
| **Platform** | Substrait · FastAPI · OceanBase · static frontend |
| **Live** | wms-test.ninjavan.apps.substrait.build |
| **Go-live** | **Kahf dan Labore** di **MA5 Cawang** dulu, lalu **KJ5 Kemanggisan** |
| **Skala** | 10 sampai 30 dark store dalam 6 bulan |

---

# Bagian A. Instruksi kerja

Siapa membaca apa: **Ops HQ** membaca A2, **staf** membaca A3 sampai A5, **SPV** (supervisor hub) membaca A6 dan A7. Semua orang membaca A1 satu kali. Titik bernomor di setiap layar sesuai dengan langkah bernomor di bawahnya. Layar dengan sidebar hijau Hiryu adalah **Hiryu, digambar ulang dari Hiryu Malaysia**. Layar lainnya adalah **draf WMS**, belum aplikasi live.

## A1. Cara kerja pilot

**Ada tiga sistem, dan Hiryu belum terhubung ke WMS.**

| Sistem | Siapa yang memakai | Fungsinya |
|---|---|---|
| **Grab** | Pelanggan | Menerima pesanan, menerima pembayaran, mengirim rider Grab |
| **Hiryu** | Staf dan SPV di hub | POS milik Ninja. Menerima semua pesanan Grab, mencetak slip kemas, menyimpan menu, harga, dan angka stok yang tampil di Grab. Staf menekan *Mark ready* di sini |
| **WMS** | Staf, SPV, Ops HQ | Tahu letak setiap unit: di rak mana, di bin mana. Memberi tahu picker harus ke mana, memeriksa setiap unit lewat scan, menghitung isi rak, menerima kiriman, membuat permintaan restock ke merek |

Hiryu dan WMS belum saling terhubung. Sampai terhubung, **orang yang memindahkan informasinya**:

- **Pesanan pindah dari Hiryu ke WMS dengan copy dan paste.** Staf menyalin halaman pesanan di Hiryu lalu menempelkannya ke WMS (A4).
- **Stok pindah dari WMS ke Hiryu dengan diketik.** WMS menampilkan angkanya, lalu SPV mengetiknya ke tab Stock di Hiryu (A7).
- **Data pelanggan tidak pernah masuk ke WMS.** Nama, nomor telepon, alamat, dan pembayaran tetap di Hiryu.

### A1.1 Masuk ke Hiryu

<!--screen:hiryu-login-->

1. Pilih **Indonesia**. Malaysia punya daftar toko dan pengguna sendiri.
2. Staf hub masuk dengan **email dan password** akun Hiryu milik dark store mereka. Mereka hanya melihat pesanan hub mereka sendiri.
3. Staf kantor Ninja (SPV, Ops HQ) memakai **Sign in with Google**, dengan akun Hiryu yang sudah dibuatkan oleh admin Indonesia.

**Satu hari di hub**

| Kapan | Siapa | Apa | Bagian |
|---|---|---|---|
| Buka | SPV | Ketik stok WMS ke Hiryu | A7 |
| Setiap pesanan | Staf | Paste, ambil, kemas, *Mark ready* di Hiryu, serahkan ke driver | A4 |
| Kiriman dari merek | Staf | Terima dengan AWB, simpan ke rak | A3 |
| Ada masalah | Siapa saja | *Laporkan masalah* | A5 |
| Selama hari berjalan | SPV | Pertanyaan bin kedua, barang tidak ada, keputusan masalah, tas yang menunggu driver | A6 |
| Tutup | SPV | Laporan akhir hari: cek pesanan, stok ke Hiryu, masalah | A7 |

**Di build pertama, dan nanti**

| Build pertama (go-live) | Nanti |
|---|---|
| Hanya dark store (MA5, KJ5) | Gudang pusat (Logos), crossdock, transfer antar hub |
| Merek mengirim langsung ke dark store | Supplier ke gudang pusat lalu ke dark store |
| Pesanan Grab dengan copy dan paste | Tombol sekali klik, lalu koneksi Hiryu yang sebenarnya |
| Channel Grab | Pesanan WhatsApp, dibangun di dalam WMS dulu, setelah peluncuran |

## A2. Ops HQ: siapkan hub dan produknya

Lakukan ini satu kali untuk setiap hub, sesuai urutan ini, sebelum kiriman pertama.

### A2.1 Daftarkan dark store dan orangnya

<!--screen:admin-setup-->

1. **Dark store & pengguna → Tambah dark store.** Hanya Superadmin atau Ops HQ. Isi kode hub (MA5), nama, alamat, dan nama dark store di Hiryu.
2. **Area barang masuk.** Isi berapa banyak **bin sementara barang masuk** yang dimiliki hub dan ukurannya, lalu centang **baki karantina**. WMS membuat labelnya (`MA5-IN-01` sampai `MA5-IN-10`, dan `MA5-KARANTINA`) untuk dicetak bersama label bin. Taruh bin sementara di rak atau palet di sebelah meja penerimaan, dan taruh baki karantina jauh dari rak picking. Jumlahnya bisa diubah nanti. Kiriman yang jumlah SKU-nya lebih banyak dari bin sementara diterima bertahap per batch (A3).
3. **Tambah pengguna.** Isi email Google orang tersebut (@ninjavan.co), nama, peran, dan hub-nya. Superadmin dan Ops HQ bisa memberi peran apa saja. Hanya superadmin yang bisa membuat superadmin lain.
4. **SPV** hanya melihat *Tambah pengguna*, dan hanya bisa menambah **Staf** di hub mereka sendiri.

Staf hub juga butuh akun **Hiryu** untuk dark store mereka. Akun ini dibuat di Hiryu, di *Dark stores → hub tersebut → Staff*, oleh orang yang punya akses editor Hiryu di Indonesia.

### A2.2 Buat rak

<!--screen:rack-builder-->

Pembuat rak adalah **gambar rak dari depan, sesuai skala**, jadi siapa saja bisa melihat apa yang muat sebelum menyimpan. Gambar di atas bisa dipakai: silakan coba.

1. **Pilih jenis rak**: rak katalog 1 m atau rak long-span 206 cm dari inventaris.
2. **Pilih berapa bay** (bagian di antara tiang) **dan berapa level.**
3. **Klik satu level** di gambar, lalu pilih bin-nya: **kecil**, **besar**, atau **kosong**. Satu ukuran bin per level. Gambar langsung diperbarui dan menunjukkan berapa bin berjajar ke samping, berapa yang bertumpuk, dan alasannya: *7 bin berjajar karena 1.000 mm ÷ 135 mm; 3 tumpuk karena tinggi level 450 mm*.
4. **Arahkan kursor ke bin mana saja** untuk membaca kodenya. `MA5-A1-3-05T` artinya rak A, bay 1, level 3, posisi 5, bin atas. Bin yang bertumpuk diberi kode B (bawah), M (tengah), dan T (atas).
5. **Simpan**, lalu cetak label bin di kertas stiker A4.

### A2.3 Daftarkan SKU

<!--screen:sku-form-->

1. **Merek dan kode SKU merek.** Pakai kode milik merek itu sendiri.
2. **Barcode.** Scan atau ketik barcode di kemasan jika ada. Satu SKU bisa punya lebih dari satu barcode (kemasan lama dan baru). Jika merek tidak memberi barcode, biarkan kosong: staf akan mengikat barcode saat produk pertama kali datang.
3. **Di Hiryu.** Hiryu punya kode SKU sendiri, dan SPV butuh kode ini untuk menemukan baris yang benar di tab Stock di Hiryu. Isi **Kode SKU di Hiryu** dari halaman *SKUs* di Hiryu. Kolom ini otomatis terisi dengan kode merek. Ubah hanya jika Hiryu memakai kode lain. Di bawahnya, WMS menampilkan item menu Hiryu yang menjual SKU ini dan berapa unit yang dipakai per item (dari upload menu, A2.4).
4. **Ukuran kemasan dan berat** jika diketahui. Tidak wajib, tapi data ini membantu WMS memilih ukuran bin dan tas kertas atau karton. Lembar data yang perlu diminta dari merek ada di Lampiran B.
5. **Ukuran bin.** WMS menyarankan kecil (JX-2) atau besar (JX-4): bin terkecil yang muat 15 unit dengan satu sekat.
6. **Angka-angkanya.** Masing-masing punya nama sederhana dan contoh di layar:

| Di layar | Artinya | Contoh |
|---|---|---|
| **Isi maks. per bin** | Berapa unit yang muat di satu bin sebelum bin berikutnya dipakai. Boleh kosong: WMS mempelajarinya dari SPV (A6.1) | 12 |
| **Pesan ulang saat sisa** | Jika stok SKU ini di hub turun sampai angka ini, WMS membuat draf permintaan restock ke merek | 4 |
| **Isi sampai** | Restock mengisi stok hub sampai angka ini | 15 |
| **Batas kritis** | Pada angka ini atau di bawahnya, SKU ditandai merah: hampir habis | 1 |
| **Cadangan Grab** | Unit yang ditahan dari jumlah yang boleh dijual Grab, untuk jaga-jaga jika ada salah hitung (§13.6) | 0 |

*Isi sampai* wajib diisi. *Pesan ulang saat sisa* otomatis terisi seperempat dari angka itu. Yang lain boleh kosong.

Setelah itu SKU muncul di daftar *Perlu rak* di setiap hub, lengkap dengan ukuran bin-nya. SPV di tiap hub memilih bin kosong dengan ukuran itu.

### A2.4 Hubungkan menu dan toko Hiryu

<!--screen:hiryu-map-->

1. **Ekspor menu dari Hiryu** (*Menus → menu tersebut → Export CSV*) lalu upload di sini, satu file per merek. Upload lagi setiap kali menu di Hiryu berubah.
2. Item yang barcode-nya sama dengan barcode di WMS akan terhubung sendiri dengan 1 unit per penjualan. Sisanya menunggu di **Perlu dihubungkan**.
3. Untuk setiap item, pilih SKU WMS dan berapa unit yang dipakai untuk satu penjualan. Paket isi 2 berarti 2 unit dari satu SKU. Kit pabrik yang punya barcode sendiri adalah SKU tersendiri. Kit yang berisi produk berbeda belum bisa dihubungkan di build pertama. Untuk sementara, jangan masukkan kit seperti itu ke menu Hiryu.
4. **Toko Hiryu.** Isi setiap nomor toko Hiryu satu kali, beserta hub dan mereknya. Pilot ini punya empat toko.

Pesanan Grab yang berisi item belum terhubung tidak bisa di-paste, jadi pastikan *Perlu dihubungkan* selalu kosong.

## A3. Staf: kiriman datang

### A3.1 Terima kiriman

Merek mengirim langsung ke hub dengan Surat Jalan.

1. **Barang masuk → scan atau ketik AWB** yang ada di Surat Jalan. WMS menampilkan barang yang menurut merek sudah dikirim.
2. Scan setiap unit. WMS menunjuk satu **bin sementara barang masuk** untuk setiap SKU (`MA5-IN-01`, `MA5-IN-02`, dan seterusnya) dan menampilkan *cocok*, *kurang N*, atau *lebih N* per SKU selama kamu scan.
3. Jika bin sementara sudah penuh, selesaikan batch ini dan simpan ke rak dulu sebelum menghitung sisanya (*Selesai batch ini*).
4. **Simpan ke rak**: bawa setiap SKU dari bin sementaranya ke bin rak yang tampil di layar.

<!--screen:putaway-full-->

5. **Jika bin rak penuh, tekan Bin penuh.** WMS memberimu bin kosong dengan ukuran sama, sedekat mungkin. Taruh sisanya di sana.
6. Setelah itu SPV akan ditanya apakah bin pertama benar-benar penuh (A6.1). Kamu tidak perlu menunggu jawabannya.
7. **Selesai.** Tekan *Semua barang AWB sudah diterima* jika semua barang sudah masuk. Selisih diteruskan ke SPV.

Barcode tidak dikenal: cari nama produk di daftar produk lalu pilih yang sama dengan barang di tanganmu. Jika tidak ada di daftar: foto barangnya, hitung, kirim ke Ops HQ, dan biarkan di bin sementaranya.

### A3.2 Jika AWB tidak ada di WMS

<!--screen:inbound-noawb-->

1. WMS menampilkan *AWB ini belum dicatat Ops HQ*. Jangan suruh driver pergi.
2. Foto Surat Jalan, pilih mereknya, isi jumlah karton, lalu tekan **Kirim ke Ops HQ, lalu hitung**. Ops HQ langsung mendapat tanda.
3. **Hitung selagi driver masih ada**: scan setiap unit ke bin sementara yang ditunjuk WMS. Tanda tangani Surat Jalan untuk jumlah karton yang diterima. Unit yang sudah dihitung **belum menjadi stok**.
4. Setelah Ops HQ menghubungkan AWB-nya, tombol **Taruh di rak** muncul dan kamu simpan ke rak seperti di A3.1. Jika Ops HQ menolak kiriman itu, barang tetap di bin sementara sampai dikembalikan ke merek.

## A4. Staf: pesanan Grab

Sekitar 20 detik untuk menyalin, lalu ambil barang. Grab memberi hub waktu **15 menit** sejak pesanan masuk ke Hiryu.

### A4.1 Salin pesanan dari Hiryu

<!--screen:hiryu-copy-->

1. Hiryu membunyikan suara pesanan baru dan mencetak slip kemas. Buka pesanannya. **Biarkan Raw payload tertutup**: tombolnya harus bertuliskan *Show*.
2. Klik satu kali pada judul **Order GM-…**. Judul ini hanya teks biasa, jadi mengkliknya tidak mengubah apa pun di Hiryu. Jangan klik di dekat tombol.
3. Tekan **Ctrl + A**, lalu **Ctrl + C**.

### A4.2 Tempel ke WMS

<!--screen:paste-->

1. Di WMS buka **Tempel pesanan Grab**, klik kotak abu-abu, lalu tekan **Ctrl + V**.
2. Pastikan nomor GM sama dengan slip dan centang hijau muncul. Centang itu berarti jumlah baris dan unit sama dengan hitungan Hiryu.
3. Tekan **Mulai ambil**.

| Kata WMS | Lakukan ini |
|---|---|
| *Salinan tidak lengkap* | Kembali ke Hiryu, klik judulnya, Ctrl + A, Ctrl + C lagi |
| *Tutup "Raw payload" dulu* | Di Hiryu tekan *Hide* pada Raw payload, lalu salin lagi |
| *Barang belum dihubungkan* | Beri tahu SPV. Ops HQ menghubungkan itemnya, lalu paste lagi |
| *Pesanan sudah ada* | Pesanan ini sudah pernah di-paste. WMS membuka daftar ambilnya |
| *Toko ini milik hub lain* | Salah hub. Beri tahu SPV |

### A4.3 Ambil barang

<!--screen:pick-->

1. Pergi ke bin yang tampil di layar. Rak dan level-nya ditandai.
2. Ambil sejumlah angka yang tampil, dari **sekat paling lama** dulu.
3. **Scan setiap unit.** Produk yang salah menghentikan pengambilan. Kembalikan barang itu dan ambil yang benar. Jika produk yang salah itu memang ada di bin ini, tekan *Barang ini salah tempat*.
4. Barang tidak ada, atau kurang: tekan **Barang tidak ada** (A5.1).

### A4.4 Kemas

<!--screen:pack-->

1. Setelah semua unit di-scan, ambil kemasan yang disebut WMS: **tas kertas** atau **karton**. Jika benar-benar tidak muat, tekan *Ganti kemasan* dan pilih alasannya.
2. Masukkan slip Hiryu ke dalam kemasan atau tempel di luar, dengan nomor GM terlihat. Slip ini desain dari Grab dan tidak punya kode untuk di-scan, jadi tekan **Selesai dikemas**.
3. **Tekan Mark ready di Hiryu** untuk nomor GM yang sama, lalu tekan *Sudah tekan Mark ready*. Taruh tasnya di rak siap ambil.

### A4.5 Serahkan ke driver Grab

<!--screen:handover-->

1. **Serah ke driver** menampilkan daftar tas yang menunggu. Warna kuning berarti sudah menunggu lebih dari 20 menit.
2. Tanyakan nomor pesanan ke driver. Jika sama dengan nomor GM di slip, tekan **Ya, sudah diambil driver**. Hiryu diperbarui sendiri saat Grab mencatat pengambilan.

Jika Hiryu menampilkan pesanan itu sebagai dibatalkan, jangan serahkan: tekan **Dibatalkan di Hiryu** pada pesanan itu (A5.3) lalu bongkar kemasannya.

## A5. Staf: ada masalah

### A5.1 Barang tidak ada atau kurang

<div class="flagbar">Ditandai, perlu dikonfirmasi ke Grab: jika ada barang yang tidak ada, apakah Grab ingin kita membatalkan seluruh pesanan, atau mengirim barang yang ada? Sampai Grab menjawab, SPV memutuskan untuk setiap pesanan.</div>

<!--screen:short-->

1. Tekan **Barang tidak ada**, lalu isi apa yang kamu temukan: *Tidak ada sama sekali*, atau atur jumlahnya dengan − dan +.
2. WMS menghentikan pesanan dan memintamu **memanggil SPV**. WMS menampilkan permintaan pelanggan dari Grab (ganti, hapus, batalkan, hubungi) untuk dibaca SPV.
3. SPV memilih di layarmu: **Kirim yang ada** atau **Batalkan pesanan**. SPV melakukan langkah yang sama di Hiryu.

### A5.2 Laporkan masalah

<!--screen:report-->

1. Tekan **Laporkan masalah** dari layar mana saja, lalu pilih apa yang terjadi:

| Pilih | Kapan |
|---|---|
| Rusak atau bocor | Pecah, penyok, bocor, segel terbuka |
| Kedaluwarsa | Sudah lewat tanggalnya, atau terlalu dekat untuk dijual (SPV yang memutuskan) |
| Salah tempat | Produk ada di bin yang bukan bin-nya |
| Barang ditemukan | Ada unit di tempat yang tidak diketahui WMS: lantai, bin yang salah, bagian belakang rak |
| Kembalian dari driver | Driver membawa kembali pesanan yang tidak terkirim |
| Lainnya | Hal lain |

2. Scan atau pilih produknya, atur jumlahnya, tambahkan foto jika bisa. Jangan foto slip kemas: slip itu bisa menampilkan nama pelanggan.
3. **Taruh di MA5-KARANTINA.** Masukkan unitnya ke baki karantina. Unit itu langsung keluar dari stok yang bisa dijual dan menunggu SPV (A6.2). *Salah tempat* dan *Barang ditemukan* tidak masuk baki: WMS menunjuk bin yang benar.

### A5.3 Pesanan dibatalkan

<!--screen:cancel-->

1. Jika Hiryu menampilkan pesanan sebagai **CANCELLED**, buka pesanan itu di WMS (dari antrean, daftar ambil, kemas, atau daftar serah ke driver) lalu tekan **Dibatalkan di Hiryu**.
2. Periksa nomor GM lalu konfirmasi.
3. Barang yang sudah diambil masuk ke **Kembalikan ke rak**: scan setiap unit kembali ke bin-nya. Bongkar dulu tas yang sudah dikemas.

Jika tombol batal tertekan tanpa sengaja: SPV bisa membuka lagi pesanan itu.

## A6. SPV: selama hari berjalan

### A6.1 Pertanyaan bin kedua

<!--screen:second-bin-->

Setiap kali satu SKU mendapat bin kedua di hub, baik karena staf menekan *Bin penuh* atau karena kamu menambahkannya di *Rak & bin*, WMS menanyakan alasannya.

1. Pilih alasannya. **Bin pertama penuh** adalah alasan yang penting.
2. Jika penuh: WMS mengusulkan jumlah yang sekarang ada di bin pertama sebagai **isi maks. per bin** untuk SKU itu di ukuran bin itu. Angka ini berlaku untuk hub ini, dan untuk semua hub lain yang belum punya angka. Ops HQ bisa mengubahnya.
3. Alasan lain (kiriman promo, bin dipindah, batalkan) tidak mengubah apa pun.

Sejak itu WMS mengarahkan stok baru ke bin pertama sampai isinya mencapai angka itu, lalu ke bin kedua.

### A6.2 Masalah dan karantina

<!--screen:exceptions-->

**Siapa melakukan apa**: siapa saja boleh melapor dan menaruh unit di baki. **SPV yang memutuskan**. **Staf** yang memindahkan barangnya. **Ops HQ** menandatangani penghapusan stok dalam jumlah besar.

1. **Tanggungan** menunjukkan siapa yang menanggung biaya sesuai alasan yang dipilih (§12.3). Ubah alasannya jika laporannya salah.
2. Putuskan setiap laporan dalam 24 jam:

| Keputusan | Apa yang terjadi selanjutnya | Bisa dijual lagi |
|---|---|---|
| **Kembali ke rak** | Tugas *Kembalikan dari karantina* muncul untuk staf: ambil unit dari baki, scan, taruh di bin yang ditunjuk WMS, scan bin-nya | Setelah bin di-scan |
| **Retur ke merek** | Unit tetap di baki dengan tanda *Menunggu retur* dan dikembalikan bersama kiriman merek berikutnya. Staf scan keluar unit itu sesuai nota retur yang ditandatangani driver merek | Tidak, unit keluar dari hub |
| **Hapus stok** | Di atas 3 unit atau Rp300.000, keputusan ini menunggu tanda tangan Ops HQ. Setelah itu staf scan keluar unit sebagai barang dibuang | Tidak |

3. Barang yang ada di baki lebih dari 24 jam tanpa keputusan akan ditandai ke kamu. Lebih dari 7 hari, ditandai ke Ops HQ.

<!--screen:karantina-task-->

### A6.3 Perhatikan juga

- **Barang tidak ada** (A5.1): datangi picker, baca permintaan pelanggan, pilih *Kirim yang ada* atau *Batalkan pesanan*, lalu lakukan hal yang sama di Hiryu. Jika SKU itu sekarang habis, langsung ketik stok barunya ke Hiryu.
- **Pengingat**: draf restock yang perlu dikirim, kiriman yang lewat tanggalnya, selisih yang perlu dikonfirmasi, kiriman yang menunggu Ops HQ.
- **Serah ke driver**: tas yang berwarna kuning selama 20 menit atau lebih. Cek pesanannya di Hiryu. Jika Grab membatalkannya, tekan *Dibatalkan di Hiryu* dan minta staf membongkar kemasannya.

## A7. SPV: akhir hari (dan saat buka)

<!--screen:eod-->

1. **Cek pesanan.** Di Hiryu buka **Orders**, atur *Dark store* ke hub ini, lalu *From* dan *To* ke hari ini. Klik judul *Orders*, tekan Ctrl + A, Ctrl + C, lalu paste ke tab WMS *Cek pesanan*. Perbaiki setiap baris yang ditampilkan WMS: pesanan yang belum pernah di-paste, pembatalan yang belum ditekan siapa pun, atau pesanan yang ada di WMS tapi tidak ada di Hiryu.

<!--screen:hiryu-orders-->

2. **Tunggu saat sepi.** **Live Orders** di Hiryu harus menunjukkan 0 di *Pending accept*, *Pending packing*, dan *Packed, awaiting pickup*.

<!--screen:hiryu-live-->

3. **Ketik stoknya.** Untuk setiap toko (dua per hub di pilot ini): di Hiryu buka *Stores → toko tersebut → Stock*. Untuk setiap baris berwarna di tab WMS *Stok untuk Hiryu*, cari **Kode SKU di Hiryu** yang sama (kode ini tercetak di bawah nama SKU di Hiryu) lalu ketik angka WMS dari **Ketik di Hiryu** ke **Units on hand**. Tekan **Save stock** di Hiryu.

<!--screen:hiryu-stock-->

4. Tekan **Sudah disimpan di Hiryu** di WMS.
5. Putuskan masalah yang masih terbuka, atau tinggalkan catatan untuk SPV besok.

Jangan pernah memakai kolom **Arrived** di Hiryu: kolom itu menambah hitungan, padahal angka WMS sudah termasuk kiriman itu.

Lakukan langkah 2 sampai 4 juga saat buka, setelah setiap kiriman disimpan ke rak, dan setelah setiap hitungan stok ditandatangani.

---

# Bagian B. Kebutuhan sistem

## 1. Ringkasan dan cakupan

Ninja Van memenuhi pesanan quick-commerce untuk brand dari dark store kecil. Untuk **GrabMart Kilat**, Grab menerima pesanan dan mengirim driver; Ninja menyimpan stok, mengambil barang, dan mengemasnya. POS Ninja, **Hiryu**, sudah menerima pesanan Grab dan menyimpan menu. **WMS** adalah lapisan di bawahnya: ke mana satu unit disimpan, di mana picker menemukannya, apakah unit itu benar-benar ada, dan apa yang tiba dibanding apa yang menurut brand sudah dikirim.

**Versi pertama** *(diputuskan 25 Sep)*: hanya dark store; brand mengirim langsung; pesanan Grab masuk lewat salin-tempel dari Hiryu; angka stok kembali ke Hiryu lewat SPV yang mengetiknya; Kahf dan Labore di MA5, lalu KJ5.

**Desain target** (dokumen acuan): setiap pesanan masuk lewat Hiryu, hanya Hiryu yang berkomunikasi dengan WMS, hanya WMS yang menghitung stok di rak, dalam lima pesan (§13.1). Versi pertama mempertahankan bentuk itu agar solusi sementara bisa dimatikan satu per satu.

## 2. Prinsip

- **2.1** **WMS tidak pernah berkomunikasi dengan Grab.** Kanal penjualan terhubung ke Hiryu. Di versi pertama, orang yang memindahkan pesanan dari Hiryu ke WMS (§13.2).
- **2.2** **Satu hitungan rak.** Ledger WMS adalah satu-satunya hitungan stok di rak. Angka di Hiryu dikoreksi dari ledger ini (§13.4) sampai Hiryu berhenti menyimpan hitungannya sendiri.
- **2.3** **Setiap pergerakan stok di-scan.** Picking punya cek scan yang tidak bisa dilewati staf.
- **2.4** **Ledger hanya bisa ditambah.** Saldo dihitung dari pergerakan; stok negatif ditolak; setiap scan bisa diulang tanpa terhitung dua kali.
- **2.5** **Merah hanya berarti gagal.** Setiap status punya warna, ikon, dan kata-kata.
- **2.6** **Tidak ada teks bebas di lantai gudang.** Jumlah diisi lewat stepper dan keypad.
- **2.7** **Bahasa Indonesia sebagai default**, bahasa Inggris cukup satu ketukan, untuk setiap teks.
- **2.8** **Hanya online, dan sistem memberi tahu.** Jika koneksi putus, pekerjaan terhenti dan hal itu terlihat jelas.
- **2.9** **Mode latihan tidak pernah menyentuh stok asli.**
- **2.10** **Semua stok milik brand** (§6.5).
- **2.11** **Data pelanggan tetap di Hiryu.** WMS tidak pernah menerima, menyimpan, mencatat di log, atau menampilkan nama, nomor telepon, alamat, catatan, atau pembayaran pelanggan, dan tidak ada tabel yang punya kolom untuk data itu (§13.2.1).

## 3. Pengguna dan peran

| Peran | Di mana | Tugas |
|---|---|---|
| **Staf** | Lantai dark store | Terima barang per AWB, simpan ke rak, tempel pesanan Grab, ambil, kemas, serahkan, hitung stok, laporkan masalah |
| **SPV** | Hub miliknya sendiri | Rak dan bin, SKU ke bin, pertanyaan bin kedua, keputusan barang tidak ada, keputusan masalah, permintaan restock untuk hub-nya, konfirmasi selisih, pengesahan hitung stok, laporan akhir hari, **mendaftarkan staf** |
| **Ops HQ** | Semua hub | Brand, SKU, foto, angka stok dan cadangan Grab, menu Hiryu dan pemetaan toko, pengesahan write-off dan selisih, menautkan kiriman tanpa AWB tercatat, **mendaftarkan dark store dan pengguna serta memberi peran** |
| **Superadmin** | Semua | Semua yang dilakukan Ops HQ, memberi peran superadmin, melihat aplikasi sebagai peran lain (hanya baca) |

**Siapa mendaftarkan siapa** *(diputuskan 25 Sep)*:

| | Daftarkan dark store | Daftarkan pengguna | Peran yang bisa diberikan |
|---|---|---|---|
| **Superadmin** | Ya | Ya | Semua, termasuk superadmin |
| **Ops HQ** | Ya | Ya | Staf, SPV, Ops HQ |
| **SPV** | Tidak | Ya, di hub miliknya | Hanya staf |
| **Staf** | Tidak | Tidak | Tidak ada |

- **3.1** Server menegakkan setiap izin; console menyembunyikan layar yang tidak bisa dipakai suatu peran.
- **3.2** Peran *hub operator* untuk gudang pusat disembunyikan di versi pertama dan kembali bersama gudang pusat (§20).
- **3.3** **Dua tampilan.** *Station* untuk lantai gudang: huruf besar, satu keputusan per layar, area scan yang selalu aktif; bisa dipakai di laptop dengan scanner, tablet, atau ponsel (bisa diinstal, scan dengan kamera, atau ketik kodenya). *Console* untuk SPV dan Ops HQ: tabel, filter, antrean.

## 4. Hub, rak dan bin

### 4.1 Lokasi

- **4.1.1** Versi pertama **hanya untuk dark store**. Tipe lokasi gudang pusat, transfer, dan pengiriman tote tetap ada di kode tapi disembunyikan (§20).
- **4.1.2** **Bin inbound sementara dan baki karantina** *(diputuskan 25 Sep)* diatur saat dark store didaftarkan (A2.1): jumlah bin sementara dan ukurannya, serta satu baki karantina. WMS membuatnya sebagai lokasi yang **tidak pernah menyimpan stok yang bisa dijual**: `HUB-IN-01` dan seterusnya (satu SKU per bin, dipakai saat kiriman dihitung; WMS menentukan bin mana yang dipakai untuk tiap SKU) dan `HUB-KARANTINA`. Labelnya dicetak bersama label bin. Jumlah bin sementara bisa diubah kapan saja; kiriman dengan SKU lebih banyak dari jumlah bin sementara diterima bertahap (§7.2).

### 4.2 Tata letak bisa diatur **[DIPUTUSKAN 25 Sep]**

Tata letak hub adalah **rak → bay → level → posisi → tumpukan**.

| Bagian | Diatur oleh | Aturan |
|---|---|---|
| **Rak** | Ops HQ atau SPV | Satu huruf per hub, dan tipe rak (ukuran luar, jumlah level, lebar bersih per bay) |
| **Bay** | Tipe rak, bisa diubah | Bagian di antara tiang. Rak katalog 1 m punya 1; rak long-span 206 cm bisa diatur 1 atau 2 |
| **Level** | Per bay | Tinggi bersih, dan **satu ukuran bin** per level |
| **Posisi** | Dihitung sistem | ⌊lebar bersih bay ÷ lebar bin⌋, boleh dikurangi |
| **Tumpukan** | Dihitung sistem | min(⌊tinggi bersih level ÷ tinggi bin⌋, batas tumpuk tipe bin), boleh dikurangi |

- **4.2.1** **Kode lokasi** `HUB-RACK BAY-LEVEL-POSITION[STACK]`, contoh `MA5-A1-3-05T`. Huruf tumpukan: tanpa huruf untuk satu bin; B dan T untuk dua; B, M dan T untuk tiga. Rak lama dengan satu bay menjadi bay 1 saat dimigrasi; belum ada label bin yang dicetak, jadi tidak ada yang perlu dicetak ulang.
- **4.2.2** **Tipe bin** adalah daftar yang dikelola Ops HQ: kode, nama, ukuran luar dan dalam (W × D × H mm), batas tumpuk. Nilai awal:

| Bin | Ukuran luar W × D × H mm | Batas tumpuk | Kegunaan |
|---|---|---|---|
| Kecil, Lion Star Jolly Box No.200 (JX-2) | 135 × 225 × 120 | 3 | Tube, botol kecil, bedak padat |
| Besar, Lion Star Jolly Box No.400 (JX-4) | 198 × 356 × 170 | 2 | Botol 150 ml ke atas, kit |

- **4.2.3** Ukuran dalam bin tidak dipublikasikan: ukur sampel pertama lalu koreksi daftarnya.
- **4.2.4** **Bin yang ditumpuk diambil dari depan** (kedua tipe terbuka di bagian depan). WMS menggambar tumpukan sebagai satu kolom, bin atas di posisi atas.
- **4.2.5** Rak bisa diperluas: tambah rak, bay, level, atau posisi. Bin, level, atau bay hanya bisa dihapus jika **belum pernah menyimpan stok**.
- **4.2.6** **Satu bin untuk satu SKU.** Sekat di dalam bin memisahkan kiriman (§7.8), tidak pernah memisahkan SKU.
- **4.2.7** **Pembuat rak berupa gambar lebih dulu** *(diputuskan 25 Sep)*: tampak depan sesuai skala, level dipilih dengan mengkliknya, ukuran bin dipilih dengan satu ketukan, dan angka ditampilkan beserta alasannya dalam kata-kata sederhana (A2.2). Tabel dengan angka yang sama tersedia untuk Ops HQ, di bawah gambar.

## 5. Restock dari brand

### 5.1 Satu rute di versi pertama **[DIPUTUSKAN 25 Sep]**

**Brand → dark store**, langsung. Rute supplier ke gudang pusat ke dark store, dan crossdock, masuk versi berikutnya (§20).

### 5.2 Permintaan restock ke brand **[dibangun 17 Sep]**

Stok ini konsinyasi: brand memilikinya sampai terjual. Ninja membuat permintaan restock dan memberikan formulir konsinyasi ke brand. Ops HQ menjalankannya untuk semua hub; SPV untuk hub miliknya.

| Langkah | Siapa | Yang terjadi |
|---|---|---|
| **Peringatan** | WMS | Stok SKU di suatu hub turun ke angka *pesan ulang saat sisa* (semua bin-nya digabung). SKU muncul di *Needs restock* dengan jumlah saran sampai *isi sampai* |
| **Draf** | WMS, lalu Ops HQ atau SPV | WMS otomatis membuat satu draf permintaan per hub dan brand; seseorang memeriksa dan menyesuaikannya |
| **Terkirim** | Ops HQ atau SPV | Teks permintaan disalin dan dikirim ke brand di luar WMS (WhatsApp atau email) lalu ditandai terkirim. Jumlahnya dikunci |
| **Dikonfirmasi** | Ops HQ atau SPV | Mencatat AWB dari brand, nomor Surat Jalan, tanggal tiba, dan jumlah yang benar-benar akan dikirim brand |
| **Diterima** | Staf | Diterima per AWB (A3). Jika semua cocok, permintaan ditutup dan angka itu yang ditagih |
| **Selisih** | SPV, lalu Ops HQ | Ada perbedaan: SPV memasukkan hitungan akhir dan alasannya; Ops HQ mengesahkan. Angka yang disahkan yang ditagih |

- **5.2.1** Referensi `RPL-<hub>-<yymm>-<n>`. Satu AWB hanya milik satu permintaan yang masih terbuka.
- **5.2.2** **Kiriman yang AWB-nya tidak tercatat** *(diputuskan 25 Sep)* tidak ditolak. Staf memasukkan AWB dari Surat Jalan, foto Surat Jalan, brand, dan jumlah karton; Ops HQ langsung mendapat tanda. Staf menghitung unit ke bin sementara selama driver masih ada; unit ini belum menjadi stok. Ops HQ lalu menautkan AWB ke permintaan restock yang terbuka, mencatatnya sebagai kiriman tidak terencana dari Surat Jalan, atau menolaknya (barang kembali ke brand). Baru setelah itu unit bisa disimpan ke rak (A3.2).
- **5.2.3** Langkah SPV dan langkah Ops HQ pada selisih harus dilakukan dua orang berbeda.
- **5.2.4** Masih perlu disepakati dengan brand (melalui Grab): safety stock, seberapa sering restock, retur barang kedaluwarsa dan barang lambat laku, serta biaya restock yang terpisah dari biaya fulfilment 5%. Semua ini akan menjadi pengaturan (§8.6), tanpa perlu membangun ulang.

### 5.3 Laporan sell-out bulanan ke brand

Ninja mengirim laporan bulanan ke setiap brand: unit terjual dan unit tersisa per SKU, per hub, beserta nilai penjualan. Jumlah unit berasal dari WMS; nilai = unit × harga daftar SKU (WMS tidak mengambil harga dari pesanan, §2.11). Tab *Penjualan* di laporan akhir hari (§13.5) menyusunnya hari demi hari; Ops HQ mengunduh data satu bulan sebagai CSV.

## 6. Produk

### 6.1 Mendaftarkan SKU **[diperbarui 25 Sep]**

Ops HQ mendaftarkan setiap SKU **sekali untuk semua hub** (A2.3):

| Kolom | Wajib | Catatan |
|---|---|---|
| Brand, kode SKU brand, nama, ukuran, kategori | Ya | Kode milik brand sendiri |
| **Kode SKU di Hiryu** | Ya | Kode SKU yang sesuai di Hiryu (Hiryu *SKUs*). Otomatis terisi dengan kode brand; ubah hanya jika Hiryu memakai kode lain. Lembar stok mengurutkan baris berdasarkan kode ini agar sejajar dengan tab Stock di Hiryu *(diputuskan 25 Sep)* |
| Item menu Hiryu | Ditampilkan, tidak diketik | Dari unggahan menu (§13.3): setiap ID item yang menjual SKU ini, dan jumlah unit per penjualan |
| **Barcode** | Jika kemasan punya | Satu barcode hanya untuk satu SKU, selamanya. Satu SKU boleh punya beberapa |
| Kemasan L × W × H mm, berat g | Opsional | Menentukan ukuran bin dan kemasan pengiriman. Lampiran B |
| Cairan dalam botol; botol besar (150 ml atau lebih) | Opsional | Menentukan aturan karton (§14) |
| **Ukuran bin** | Ya | Disarankan dari ukuran kemasan; jika tidak ada, dari kategori |
| **Isi maks. per bin** | Opsional | Hanya jika diketahui dari SKU serupa dengan ukuran bin yang sama (§8.2) |
| *Isi sampai*, *Pesan ulang saat sisa*, *Batas kritis* | *Isi sampai* ya | *Pesan ulang* otomatis terisi seperempat dari *Isi sampai*; *Batas kritis* opsional (§8.1) |
| *Cadangan Grab* (buffer Grab) | Opsional | Default 0 (§13.6) |
| Foto | Opsional | 1:1, minimal 800 × 800, latar putih |

- **6.1.1** **Impor massal**: lembar master SKU (Lampiran B) diimpor sebagai CSV dengan kolom yang sama, dengan pratinjau sebelum ada yang disimpan.
- **6.1.2** SKU yang didaftarkan di HQ muncul di daftar *Perlu rak* setiap hub **beserta ukuran bin-nya**. SPV memilih bin kosong dengan ukuran itu; WMS menyarankan ketinggian paling nyaman lebih dulu (level 3, lalu 2, 4, 1, 5).
- **6.1.3** SKU yang belum punya bin di suatu hub bisa diterima di sana (staf diberi bin saat inbound), tapi belum bisa diambil untuk pesanan.

### 6.2 Barcode

- **6.2.1** Barcode bisa dimasukkan saat pendaftaran, atau diikat saat unit pertama kali tiba: staf mencari di daftar produk, memilih produk yang sedang dipegang, dan barcode terikat permanen.
- **6.2.2** Produk tak dikenal saat inbound dikirim ke Ops HQ dengan foto dan jumlahnya (A3); produk itu belum menjadi stok sampai HQ menjawab.
- **6.2.3** Label unit milik Ninja (untuk brand tanpa barcode) tetap ada tapi disembunyikan. Kahf dan Labore sudah punya barcode.

### 6.3 Data kemasan

WMS meminta ukuran dan berat kemasan ke brand, tapi harus tetap berjalan tanpa data itu. Data yang kurang tidak pernah menghalangi kiriman atau pengambilan: nilai default kategori dipakai dan layar menampilkan *perkiraan* (estimasi).

### 6.4 Foto

Ops HQ mengunggah foto produk; untuk produk yang hampir sama, foto inilah yang dicek picker.

### 6.5 Pemilik stok dan model listing **[DIPUTUSKAN 25 Sep]**

- **6.5.1** **Semua stok milik brand.** Dalam operasi ini, Ninja tidak memiliki stok dan Grab juga tidak. Setiap pergerakan dan saldo mencatat brand sebagai pemilik.
- **6.5.2** Yang berbeda antar brand adalah **siapa yang mendaftarkan toko di Grab**, sebuah pengaturan per brand:

| Model listing | Siapa merchant di Grab | Contoh |
|---|---|---|
| `grab_3pl` | Grab membawa brand dan meminta Ninja menjadi 3PL-nya | **Kahf, Labore** (pilot) |
| `ninja_merchant` | Ninja mencari brand dan mendaftarkan merchant miliknya sendiri di Grab | Malaysia saat ini |

- **6.5.3** Model listing tidak mengubah cara kerja di lantai gudang. Model ini menentukan siapa yang menerima laporan dan lewat siapa permintaan restock dikirim.
- **6.5.4** Nilai pemilik lama *grab* dan *ninja* dihapus lewat migrasi.

## 7. Inbound

- **7.1** **Inbound dimulai dari AWB** atau referensi RPL (§5.2). Penerimaan dibuka dengan jumlah yang sudah dikonfirmasi brand, lalu dibandingkan per SKU selama scan.
- **7.2** **Bertahap.** Satu bin sementara menampung satu SKU; jumlah bin sementara di hub diatur di *Rak & bin*. Satu AWB bisa diterima dalam beberapa tahap.
- **7.3** **Ke mana setiap unit disimpan.** Stok baru masuk ke bin pertama SKU sampai mencapai **isi maks. per bin**, lalu ke bin berikutnya. Jika **belum ada angkanya**, semua masuk ke bin pertama sampai staf menekan **Bin penuh** (A3).
- **7.4** **Bin penuh** saat putaway: WMS menawarkan bin kosong terdekat dengan ukuran bin SKU itu di hub tersebut, mendaftarkannya sebagai bin berikutnya untuk SKU itu, dan mengajukan pertanyaan bin kedua ke SPV (§8.2). Staf tidak perlu menunggu.
- **7.5** **Bisa dijual sejak scan putaway.** Tidak ada yang menunggu tanda tangan. SKU muncul di lembar stok untuk Hiryu (§13.4).
- **7.6** **Daftar putaway.** Catatan tetap tentang apa disimpan di mana, warna hari, dan batas klaim 24 jam; SPV menandatanganinya untuk kepatuhan.
- **7.7** **24 jam.** Selisih dengan brand harus diajukan dalam 24 jam sejak penerimaan; setelah itu kerugian ditanggung hub.

### 7.8 Warna hari dan FIFO

Setiap kiriman diletakkan di belakang sekat berwarnanya sendiri di dalam bin; warnanya menunjukkan minggu kiriman, dan tanggalnya ditulis di sekat putih. WMS tidak melacak sekat. WMS mengarahkan picker ke bin yang berisi stok paling lama, dan layar menampilkan *ambil dari sekat paling lama*. Tanggal kedaluwarsa tidak dicatat di versi pertama.

## 8. Penyimpanan dan ambang batas

### 8.1 Angka per SKU per hub **[diganti nama 25 Sep]**

Layar memakai nama bahasa Indonesia yang sederhana, dengan contoh satu baris di bawah setiap kolom (A2.3). Huruf R, P dan S hanya dipakai di kode dan database.

| Di layar | Bahasa Inggris | Kode | Diukur pada | Fungsinya |
|---|---|---|---|---|
| **Isi maks. per bin** | Bin max | `full` | Satu bin | Stok baru pindah ke bin berikutnya |
| **Pesan ulang saat sisa** | Reorder at | `R` | Semua bin SKU itu | Membuat draf permintaan restock ke brand |
| **Isi sampai** | Fill up to | `P` | Semua bin SKU itu | Batas yang diisi oleh restock |
| **Batas kritis** | Critical level | `S` | Semua bin SKU itu | Tanda merah: hampir habis. Harus sama dengan *pesan ulang* atau lebih rendah |
| **Cadangan Grab** | Grab buffer | `buffer` | Per SKU | Unit yang ditahan dari Grab (§13.6) |

- **8.1.1** WMS menolak pengaturan yang tidak mungkin berjalan (pesan ulang di bawah nol, batas kritis di atas pesan ulang, isi maks. per bin nol).
- **8.1.2** *Pesan ulang saat sisa* otomatis terisi seperempat dari *Isi sampai* (bisa diatur).

### 8.2 Isi maks. per bin dipelajari sistem **[DIPUTUSKAN 25 Sep]**

Ukuran bin dan ukuran kemasan berbeda-beda, jadi jumlah unit yang memenuhi satu bin tidak bisa diketahui untuk setiap SKU saat peluncuran.

- **8.2.1** **Disimpan per SKU × ukuran bin**, dipakai bersama oleh semua hub, dengan nilai opsional per hub yang menggantikannya.
- **8.2.2** **Saat pendaftaran**, Ops HQ boleh menyalinnya dari SKU serupa dengan ukuran bin yang sama. Jika tidak, angkanya dibiarkan kosong.
- **8.2.3** **Dipelajari dari SPV.** Setiap kali SKU mendapat bin kedua di suatu hub, lewat *Bin penuh* (§7.4) atau oleh SPV di *Rak & bin*, WMS menanyakan alasannya ke SPV:

| Jawaban | Akibat |
|---|---|
| **Bin pertama penuh** | Isi maks. = jumlah unit yang sekarang ada di bin pertama. Disimpan untuk hub ini; juga disimpan untuk semua hub jika SKU × ukuran bin belum punya angka bersama |
| Stok yang datang jauh lebih banyak dari biasanya (promo) | Bin kedua dipertahankan, isi maks. tidak diatur |
| Pindah bin (bin rusak, tempat lebih baik) | Stok dipindahkan, isi maks. tidak diatur |
| Batalkan | Bin kedua dilepas setelah kosong |

- **8.2.4** Jika angka hasil belajar di suatu hub berbeda lebih dari 20% dari angka bersama, Ops HQ mendapat tanda untuk memilih angka mana yang berlaku.
- **8.2.5** Ops HQ bisa mengatur atau mengubah isi maks. per bin mana pun kapan saja di peta hub.

### 8.3 Ke mana picker diarahkan

Picker pergi ke bin SKU mana pun yang berisi **stok paling lama**. Tidak ada tugas memindahkan stok dari satu bin ke bin lain; picker cukup mengikuti stok paling lama.

### 8.4 Peta hub (Ops HQ)

Semua hub dalam satu tabel: bin terpakai dan kosong, SKU tanpa bin, unit yang disimpan, SKU yang menipis, habis, atau belum punya angka pesan ulang, kiriman dalam perjalanan, selisih yang masih terbuka, masalah yang masih terbuka. Klik satu hub untuk membuka peta tata letaknya, satu kotak per bin, diwarnai berdasarkan stok atau ketersediaan.

### 8.5 Pengingat dan tanda **[dibangun 21 Sep]**

| Tanda | Tingkat | Default |
|---|---|---|
| Stok habis, atau sama dengan atau di bawah *batas kritis* | Kritis | aktif |
| **Kiriman dengan AWB yang tidak tercatat** (ke Ops HQ) | Kritis | aktif, lalu setiap 2 jam *(baru)* |
| Draf restock menunggu dikirim | Info | aktif |
| Draf belum dikirim setelah N jam | Tindakan | 4 jam |
| Brand belum konfirmasi setelah N jam | Tindakan | 24 jam |
| Kiriman terlambat N hari dari tanggalnya | Tindakan | 1 hari |
| Selisih masih menunggu setelah N jam | Tindakan | 24 jam |
| Produk tak dikenal menunggu HQ setelah N jam | Tindakan | 24 jam |
| SKU tanpa bin N hari setelah pendaftaran | Tindakan | 2 hari |
| **Pertanyaan bin kedua belum dijawab setelah N jam** | Tindakan | 4 jam *(baru)* |
| **Unit di karantina tanpa keputusan** | Tindakan | 24 jam ke SPV, 7 hari ke Ops HQ *(baru)* |
| **Barang tidak ada menunggu SPV setelah N menit** | Kritis | 3 menit *(baru)* |
| **Kantong siap, belum diambil setelah N menit** | Tindakan | 20 menit *(baru)* |
| **Stok belum diketik ke Hiryu N jam setelah perubahan** | Tindakan | 2 jam *(baru)* |
| Barang lambat laku: tidak diambil selama N hari | Info | nonaktif, 30 hari |

### 8.6 Pengaturan, bukan membangun ulang

Semua angka di atas, batas write-off (§12.2), aturan cadangan Grab (§13.6), dan batas kemasan (§14) adalah pengaturan yang diubah Ops HQ di *Aturan pengingat*. Jadi syarat yang masih dibahas dengan brand cukup menjadi pengaturan, bukan kode.

## 9. Pesanan

- **9.1** **Satu kanal di versi pertama: GrabMart Kilat.** Pesanan masuk ke WMS dengan cara ditempel (§13.2). Pesanan WhatsApp masuk versi berikutnya (§20).
- **9.2** Setiap pesanan membawa ID pesanan Grab (kunci utama), nomor GM (untuk dibaca orang), toko Hiryu, hub, dan **batas siap = waktu pesanan di Hiryu + 15 menit**.
- **9.3** **Stok langsung ditahan untuk pesanan begitu pesanan ditempel**, jadi dua pesanan tidak mungkin mendapat unit terakhir yang sama. Ditahan artinya unit tetap di rak tapi tidak lagi tersedia untuk pesanan lain.
- **9.4** **Antrean pick**: tiga jalur (menunggu, sedang diambil, selesai hari ini), diurutkan berdasarkan sisa waktu sebelum batas siap, bukan berdasarkan umur pesanan. Picker yang menahan pesanan terlalu lama akan ditandai; SPV bisa melepasnya.
- **9.5** **Perilaku stok Grab sendiri** *(dikonfirmasi 25 Sep)*: Grab menurunkan stok yang ditampilkannya begitu pesanan dibuat, dan **tidak mengembalikannya saat pesanan dibatalkan**. Jadi setelah pembatalan, Grab menampilkan unit lebih sedikit dari yang ada di hub sampai SPV mengetik ulang stoknya. WMS menandai SKU tersebut sebagai berubah di lembar stok.

## 10. Picking, packing dan serah terima

### 10.1 Pick terpandu

- **10.1.1** Picker diarahkan ke **satu bin setiap kali**, sesuai urutan jalan, dengan kode bin, foto produk, dan jumlah yang harus diambil.
- **10.1.2** **Setiap unit di-scan.** Produk yang salah menghentikan pick dan menampilkan kedua produk berdampingan. Tidak bisa dilewati.
- **10.1.3** Mengambil beberapa pesanan sekaligus tidak ada di versi pertama. Cara ini baru menguntungkan di atas sekitar 15 pesanan per jam per picker; pilot merencanakan sekitar 7 pesanan per hari per hub.

### 10.2 Jika barang tidak ada **[DITANDAI: konfirmasi ke Grab]**

<div class="flagbar">Perlu dikonfirmasi ke Grab: jika ada barang yang tidak ada, apakah seluruh pesanan dibatalkan, atau barang yang ada tetap dikirim? Sampai Grab menjawab, SPV memutuskan untuk setiap pesanan.</div>

1. Picker menekan **Barang tidak ada** dan mengisi berapa yang ditemukan: tidak ada, atau angka yang diatur dengan − dan +.
2. WMS **menghentikan pesanan** dan meminta picker memanggil SPV. WMS menampilkan permintaan pelanggan dari pesanan Hiryu (ganti, hapus, batalkan, atau hubungi) untuk dibaca SPV.
3. SPV memilih di layar picker:
   - **Kirim yang ada**: pesanan lanjut dengan unit yang ditemukan. Baris yang kurang dihapus, atau diganti jika SPV mengikuti pengganti pilihan pelanggan (diambil dan di-scan seperti baris lain). SPV membuat perubahan yang sama di Hiryu.
   - **Batalkan pesanan**: SPV membatalkan di Hiryu; WMS melepas pesanan dan mengembalikan unit yang sudah diambil ke rak.
4. Setelah Grab menjawab, salah satu dari dua pilihan ini menjadi aturan untuk kasus tersebut dan langkah SPV ini dihapus.

Saat *Barang tidak ada* ditekan, WMS juga:

- **mengubah hitungan bin menjadi jumlah yang ditemukan**, agar pesanan lain tidak diarahkan ke bin yang kosong;
- **memasukkan SKU ke lembar stok** agar SPV menurunkan angkanya di Hiryu (dan dengan begitu juga di Grab);
- **memberi tahu SPV**, dengan menyebut nama picker.

Di sini picker boleh menurunkan stok tanpa SPV, karena kalau menunggu, Grab terus menjual produk yang tidak ada di hub. Untuk mencegah penyalahgunaan, SPV melihat setiap laporan beserta nama picker, dan SKU itu masuk ke daftar hitung stok berikutnya.

### 10.3 Pack

- **10.3.1** WMS menentukan kemasan sebelum pick dimulai (§14). Packer bisa mengubahnya dengan dua ketukan dan alasan dari daftar.
- **10.3.2** **Tidak ada label untuk di-scan** *(25 Sep)*. Slip packing Hiryu adalah desain Grab dan tidak memuat kode yang bisa dibaca WMS. Scan saat pick adalah pengecekannya: jika semua unit sudah di-scan, staf memasukkan slip ke dalam kemasan atau menempelkannya di luar, lalu menekan **Selesai dikemas**, yang menandai pesanan sebagai **dikemas**. Layar lalu meminta staf menekan *Mark ready* di Hiryu dan mengonfirmasi sudah melakukannya (*Sudah tekan Mark ready*). WMS mencatat konfirmasi itu.

### 10.4 Serah terima ke driver Grab **[DIPUTUSKAN 25 Sep]**

- **10.4.1** Pesanan yang sudah dikemas menunggu di **rak siap**. *Serah ke driver* menampilkan daftarnya beserta lama menunggu.
- **10.4.2** Saat driver datang, staf mencocokkan nomor pesanan yang disebut driver dengan nomor GM di slip, lalu menekan **Sudah diambil driver**. WMS mencatat siapa yang menyerahkan dan kapan. Pesanan **selesai** di WMS.
- **10.4.3** Kantong yang menunggu lebih dari 20 menit (bisa diatur) berwarna kuning dan memberi tanda ke SPV.
- **10.4.4** Tidak ada foto yang disimpan di WMS: slip packing di kantong bisa menampilkan nama pelanggan (§2.11).

### 10.5 Status pesanan di WMS

| Status | Diatur oleh |
|---|---|
| Menunggu | Tempel |
| Sedang diambil | Picker mengambil pesanan |
| Dikemas | *Selesai dikemas* |
| Mark ready dikonfirmasi | Staf menekan setelah menekan *Mark ready* di Hiryu |
| Diambil driver | Staf menekan *Sudah diambil driver* |
| Dibatalkan | Tombol *Dibatalkan di Hiryu* |

### 10.6 Pembatalan **[DIPUTUSKAN 25 Sep]**

Pembatalan cukup dengan **satu tombol**, bukan tempel. Saat Hiryu menampilkan pesanan sebagai dibatalkan, staf menekan **Dibatalkan di Hiryu** pada pesanan itu di WMS (antrean, pick, pack, atau serah terima) dan mengonfirmasi nomor GM. WMS melepas stok yang ditahan; unit yang sudah diambil masuk ke **Kembalikan ke rak**, tempat staf mana pun men-scan setiap unit kembali ke bin-nya, dan setiap scan mengembalikannya ke stok. Kantong yang sudah dikemas dibongkar dulu. Penekanan tombol dicatat dengan nama staf; SPV bisa membuka kembali pesanan yang dibatalkan karena salah. Cek pesanan akhir hari (§13.5) menangkap pembatalan yang tidak ditekan siapa pun.

## 11. Hitung stok

- **11.1** **Jadwal**: 20% SKU teratas berdasarkan unit yang diambil selama empat minggu dihitung setiap minggu; sisanya setiap bulan. SKU baru dianggap teratas sampai punya riwayat. SKU yang pernah kena *Barang tidak ada* masuk ke daftar hitung berikutnya.
- **11.2** **Caranya**: staf memilih bin, bin itu dikunci untuknya, lalu ia men-scan setiap unit. Angka sistem tetap disembunyikan. Setiap perbedaan memunculkan tanda; staf menghitung ulang sekali sebelum angka sistem ditampilkan.
- **11.3** **Pengesahan**: penghitungan tidak pernah mengubah stok dengan sendirinya. SPV meninjau selisihnya, memilih alasan, dan menyetujui; baru setelah itu stok berubah.

## 12. Pengecualian

*Dirancang 25 September.*

### 12.1 Satu alur untuk setiap masalah stok

1. **Lapor.** Siapa pun menekan *Laporkan masalah*, memilih alasan, produk, dan jumlah, lalu menambahkan foto jika bisa (A5.2).
2. **Karantina.** Unit langsung keluar dari stok yang bisa dijual dan masuk ke `KARANTINA` (satu baki per hub), kecuali *salah tempat* dan *ditemukan*, yang langsung masuk ke bin yang benar.
3. **Putuskan.** SPV memutuskan dalam 24 jam: **kembali ke stok**, **write-off**, atau **retur ke brand**.
4. **Sahkan.** Write-off di atas batas menunggu Ops HQ.
5. **Tinjau.** Setiap bulan Ops HQ melihat write-off berdasarkan alasan, SKU, hub, dan orang; retur ke brand masuk ke daftar retur brand berikutnya bersama Surat Jalan.

### 12.1a Karantina, langkah demi langkah **[DIPUTUSKAN 25 Sep]**

| Langkah | Siapa | Apa | Stok |
|---|---|---|---|
| 1. Lapor | Siapa pun | *Laporkan masalah*, alasan, produk, jumlah, foto; unit masuk ke `HUB-KARANTINA` | Langsung keluar dari stok yang bisa dijual |
| 2. Putuskan | SPV, dalam 24 jam | Kembali ke rak, retur ke brand, atau write-off | Tidak berubah |
| 3a. Kembali ke rak | Staf, lewat tugas | *Kembalikan dari karantina*: ambil dari baki, scan unit, scan bin yang ditentukan WMS | Bisa dijual lagi saat bin di-scan |
| 3b. Retur ke brand | Staf, saat driver brand datang | Unit menunggu di baki sebagai *Menunggu retur*; staf men-scan keluar sesuai nota retur yang ditandatangani driver | Keluar dari hub |
| 3c. Write-off | Ops HQ mengesahkan jika di atas batas, lalu staf | Staf men-scan keluar sebagai dibuang | Keluar dari ledger |

Tidak ada yang kembali dari karantina hanya dengan klik SPV: unit baru dihitung sebagai stok lagi setelah staf men-scan-nya ke bin. Keputusan yang belum diambil dalam 24 jam memberi tanda ke SPV; jika belum juga dalam 7 hari, tanda masuk ke Ops HQ.

### 12.2 Batas (pengaturan)

SPV boleh melakukan write-off sampai **3 unit dan Rp300.000** (harga daftar) dalam satu laporan. Di atas itu, Ops HQ yang mengesahkan. Orang yang melapor tidak boleh sekaligus menyetujui.

### 12.3 Alasan dan siapa yang menanggung biaya

| Alasan | Kapan ditemukan | Diteruskan ke | Biaya ditanggung |
|---|---|---|---|
| Tiba rusak, kurang, atau salah | Saat penerimaan, dalam 24 jam | Selisih kiriman (§5.2) | Brand |
| Rusak di hub | Kapan saja | Karantina | Ninja |
| Kemasan cacat (bocor, segel) tanpa sebab dari penanganan | Kapan saja | Karantina | Brand |
| Kedaluwarsa atau terlalu dekat untuk dijual | Pick, hitung stok, putaway | Karantina, retur ke brand | Brand (syarat perlu dikonfirmasi) |
| Salah tempat | Pick, hitung stok | Dipindah ke bin yang benar | Tidak ada |
| Ditemukan | Di mana saja | Kembali ke stok setelah dicek SPV; membatalkan kekurangan sebelumnya jika ada | Tidak ada |
| Hilang | Pengesahan hitung stok, atau kekurangan yang tidak pernah ditemukan | Di-write-off saat pengesahan hitung stok | Ninja |
| Dikembalikan driver, utuh | Meja serah terima | Kembali ke rak, unit per unit | Tidak ada |
| Dikembalikan driver, rusak | Meja serah terima | Karantina | Perlu dikonfirmasi ke Grab |

### 12.4 Masalah pesanan

| Masalah | Yang dilakukan WMS | Siapa yang bertindak |
|---|---|---|
| Tempel ditolak (item belum dipetakan) | Item masuk ke *Perlu dipetakan* milik HQ; pesanan menunggu | Ops HQ memetakannya; staf menempel lagi |
| Pesanan ada di Hiryu, tidak pernah ditempel | Muncul di cek pesanan akhir hari | SPV. Jika sudah diserahkan, SPV menempelnya dengan **Catat pesanan terlewat**: WMS mengurangi stok tanpa pick dan menandainya tidak di-scan |
| Pembatalan yang tidak ditekan siapa pun | Muncul di cek pesanan | SPV menekan *Dibatalkan di Hiryu*; unit yang sudah diambil kembali ke rak |
| Kantong tidak diambil | Kuning setelah 20 menit, tanda ke SPV | SPV mengecek Hiryu; jika dibatalkan, bongkar kemasannya |
| Driver mengembalikan pesanan yang tidak terkirim | *Kembalian dari driver*: cari pesanan dengan nomor GM, scan setiap unit sebagai baik atau rusak | Staf, lalu SPV |

## 13. Bekerja dengan Hiryu

### 13.1 Targetnya: lima pesan

Setelah sambungan Hiryu dibangun, tepat lima pesan bergerak di antara kedua sistem:

| Nama | Dari → ke | Kapan |
|---|---|---|
| **Pesanan untuk diambil** | Hiryu → WMS | Pesanan diterima |
| **Pesanan dibatalkan** | Hiryu → WMS | Pelanggan atau Grab membatalkan |
| **Pembaruan stok** | WMS → Hiryu | Setelah setiap perubahan: tersedia = stok di rak dikurangi yang ditahan untuk pesanan |
| **Pesanan siap** | WMS → Hiryu | Scan kemas |
| **Barang kurang** | WMS → Hiryu | Picker menyatakan ada barang yang tidak ada |

Aturan untuk saat itu: angka bulat, tidak pernah "tambah 2"; setiap pesan aman dikirim ulang; pesan mengantre jika sisi lain sedang mati; situs pelatihan tidak mengirim apa pun. Saat ini WMS sudah menghitung dan mengantrekan pesan-pesan ini tetapi **tidak mengirim satu pun**, karena sambungannya belum ada.

### 13.2 Sekarang: pesanan lewat salin dan tempel **[DIPUTUSKAN 21 Sep, build pertama]**

Dua jalan masuk, satu pembaca, satu endpoint:

| | Tempel halaman pesanan | Tombol satu klik |
|---|---|---|
| Yang dilakukan staf | Salin seluruh halaman pesanan Hiryu, tempel di WMS (A4.1, A4.2) | Klik **Kirim ke WMS** di bilah bookmark saat pesanan Hiryu terbuka |
| Build | **Pertama** | Setelah tempel berjalan, dan setelah memberi tahu Shaun dan tim keamanan NV |
| Menyentuh Hiryu? | Tidak | Hanya membaca halaman yang terlihat, seperti menyalin |

#### 13.2.1 Data pelanggan tetap di Hiryu

- Teks yang ditempel **dibaca di browser** dan tidak pernah dikirim. Halaman hanya mengambil kolom di 13.2.2, mengirim kolom itu, lalu mengosongkan kotak, baik tempel berhasil maupun tidak.
- Server hanya menerima kolom itu, tidak ada yang lain; kolom yang tidak dikenal ditolak dan setiap kolom teks punya pola yang ketat.
- **Raw payload ditolak**: tempelan yang berisi data mentah Hiryu (yang memuat nama dan kontak pelanggan) dibuang dengan pesan *Tutup "Raw payload" dulu, lalu salin ulang*.
- Nama dan email staf dari kartu History di Hiryu diabaikan. Harga dan total diabaikan.

#### 13.2.2 Apa yang diambil pembaca

ID pesanan Grab; nomor GM; status Hiryu; nomor toko Hiryu; waktu pesanan; *N lines · M units* milik Hiryu; per baris: jumlah, ID item Hiryu, dan pilihan saat stok habis (ganti, hapus, batalkan, hubungi) beserta item pengganti dan jumlahnya.

- **Kuncinya ID pesanan Grab, tidak pernah nomor GM.** Nomor GM bisa berulang (Malaysia sudah punya dua GM-482 yang berbeda).
- **Cek**: jumlah baris yang ditemukan dan total unit harus sama dengan *N lines · M units* di Hiryu. Jika tidak, tidak ada yang dikirim.
- **Bangun berdasarkan tempelan asli**: sebelum membangun, kumpulkan 10 tempelan dari Malaysia (beberapa status, bundel, kedua jenis stok habis, satu pembatalan) dengan data pelanggan dihapus manual. Jika halaman Hiryu berubah, pembaca menolak dengan jelas dan tidak pernah menebak.

#### 13.2.3 Apa yang terjadi saat tempel

| Status Hiryu di tempelan | WMS |
|---|---|
| RECEIVED, ACCEPTED | Pesanan baru: tahan stok, masuk antrean, mulai pengambilan terpandu. Unit per SKU = jumlah × unit per penjualan |
| Pesanan yang sama lagi, masih terbuka | Membuka pengambilan yang sudah ada |
| CANCELLED, REJECTED, FAILED | Menampilkan konfirmasi yang sama dengan tombol *Dibatalkan di Hiryu* (§10.6) |
| DRIVER_ALLOCATED atau setelahnya, belum pernah ditempel | Ditolak; SPV memakai *Catat pesanan terlewat* jika pesanan itu memang sudah diserahkan |
| Toko milik hub lain | Ditolak, dengan menyebut hub yang benar |

Endpoint `POST /api/hiryu/paste`, terbuka untuk staf ke atas di hub itu; mencatat siapa yang menempel, kapan, dan apakah lewat tempel atau tombol.

#### 13.2.4 Tombol satu klik, nanti

Bookmark bernama **Kirim ke WMS** di profil Chrome biasa pada PC pengemasan (bukan profil untuk cetak kiosk). Bookmark ini membaca teks yang terlihat di halaman pesanan Hiryu yang terbuka, menjalankan pembaca yang sama, lalu membuka layar tempel WMS yang sudah terisi dan menunggu *Mulai ambil*. Bookmark ini tidak memanggil apa pun di Hiryu dan tidak membaca login.

### 13.3 Peta yang dikelola Ops HQ

| Peta | Isi | Diisi oleh |
|---|---|---|
| Item Hiryu | ID item Hiryu → SKU dan unit per penjualan | Unggah CSV menu Hiryu (kolom yang dipakai: `item_id`, `item_name`, `barcode`, `available_status`); barcode yang cocok dipetakan ke 1 unit; sisanya manual |
| Toko Hiryu | Nomor toko → hub dan brand | Diketik sekali per toko |
| Kode SKU Hiryu | Di setiap SKU WMS (§6.1) | Diketik Ops HQ dari *SKUs* di Hiryu; terisi dengan kode brand |

### 13.4 Sekarang: stok diketik manual **[DIPUTUSKAN 25 Sep, build pertama]**

- **13.4.1** *Stok untuk Hiryu*, satu tabel per toko Hiryu: **Kode SKU di Hiryu**, nama, stok tersedia di WMS, cadangan Grab, **Ketik di Hiryu**, nilai terakhir yang diketik, dan tanda berubah. Diurutkan menurut kode SKU Hiryu, seperti tab Stock di Hiryu, supaya kedua layar sejajar.
- **13.4.2** **Ketik di Hiryu = tersedia − cadangan Grab, tidak pernah di bawah 0.** Tersedia = stok di rak dikurangi yang ditahan untuk pesanan.
- **13.4.3** Baris ditandai berubah jika angkanya berbeda dari nilai terakhir yang diketik, dan selalu ditandai setelah ada pembatalan untuk SKU itu (Grab tidak mengembalikan hitungannya, §9.5).
- **13.4.4** SPV mengetik baris yang berubah ke *Units on hand* di Hiryu, menyimpan di Hiryu, lalu mengetuk **Sudah disimpan di Hiryu**; WMS mencatat setiap nilai sebagai sudah diketik.
- **13.4.5** Hanya dilakukan saat Live Orders di Hiryu tidak menampilkan pesanan yang sedang berjalan untuk hub itu, sampai Shaun memastikan kapan Hiryu mengurangi hitungannya sendiri saat ada penjualan (Q1).
- **13.4.6** Jangan pernah memakai kolom *Arrived* di Hiryu (*Add to stock*): kolom itu menambah hitungan Hiryu.

### 13.5 Laporan akhir hari **[DIPUTUSKAN 25 Sep]**

Satu layar per hub, **Laporan akhir hari**, untuk SPV menutup hari di Hiryu:

| Tab | Isi |
|---|---|
| **Stok untuk Hiryu** | §13.4, semua SKU, baris yang berubah di atas |
| **Cek pesanan** | Tempel daftar pesanan Hiryu hari itu (daftar ini tidak memuat data pelanggan; WMS hanya menyimpan ID pesanan Grab, nomor GM, toko, dan status). Tiga daftar: ada di Hiryu tapi tidak di WMS; dibatalkan di Hiryu, masih terbuka di WMS; ada di WMS tapi tidak di Hiryu |
| **Masalah hari ini** | Laporan, keputusan, semua yang masih terbuka |
| **Penjualan** | Unit terjual per SKU hari ini; menjadi masukan laporan sell-out bulanan (§5.3) |

Bisa diunduh sebagai CSV. Tab *Stok untuk Hiryu* yang sama dipakai saat buka toko dan setelah setiap pengiriman.

### 13.6 Cadangan Grab **[DIPUTUSKAN 25 Sep]**

Ninja menetapkan cadangan Grab, sebagai perencana stok untuk dark store miliknya sendiri. Cadangan ini adalah jumlah unit per SKU yang ditahan dari stok yang bisa dijual Grab, supaya salah hitung atau unit rusak tidak berubah menjadi pesanan Grab yang dibatalkan. Ops HQ menetapkannya per SKU, atau dengan satu aturan untuk banyak SKU (misalnya 1 unit saat stok tersedia 5 atau kurang). Bawaannya 0. Di build pertama, WMS menerapkannya di lembar stok; setelah Hiryu tersambung, angka yang sama pindah ke pengaturan buffer milik Hiryu.

## 14. Aturan kemasan

*Diperbarui 25 September.*

**Hanya dua kemasan: tas kertas dan karton.** Tidak ada ziplock, tidak ada bubble wrap dalam logika ini.

| Kemasan | Ukuran dalam | Volume terpakai | Beban maks. (asumsi) |
|---|---|---|---|
| Tas kertas, kraft 70 gsm bertali (Berkah PBG15) | 18 × 10 × 33 cm | 18 × 10 × 27 cm × 80% = **3,9 L** | **3,0 kg** |
| Karton, dinding tunggal (Maxellpack CCM-36) | 25 × 20 × 10 cm | 25 × 20 × 10 cm × 80% = **4,0 L** | **5,0 kg** |

### 14.1 Aturannya

Untuk setiap pesanan, WMS menjumlahkan:

- **V** = jumlah dari unit × volume kemasan;
- **G** = jumlah dari unit × berat;
- **L** = kemasan terpanjang dalam pesanan;
- **N** = jumlah botol besar (150 ml atau lebih).

1. **Tas kertas** jika V ≤ 3,9 L, G ≤ 3,0 kg, L ≤ 27 cm, dan N < 2.
2. Jika tidak, **karton** jika V ≤ 4,0 L, G ≤ 5,0 kg, dan L ≤ 25 cm.
3. Jika tidak juga, **dua kemasan**: WMS membagi baris pesanan, barang berat dan besar masuk karton lebih dulu, lalu menandai pesanan *2 kemasan*.

### 14.2 Alasan angka-angka ini

Grab tidak punya spesifikasi tas atau karton, jadi setiap angka adalah asumsi yang perlu diuji:

- **Volume terpakai.** Tas kehilangan 6 cm di bagian atas untuk dilipat tertutup. Kedua kemasan dihitung terisi 80%, karena kotak kaku dan botol tidak pernah mengisi ruang sepenuhnya; sekitar seperlima tetap berisi udara.
- **Tas kertas 3,0 kg.** Tas kraft kecil dengan tali pilin biasanya dijual untuk membawa 3 sampai 5 kg. Kami ambil batas bawahnya karena tas juga berayun di dalam box rider.
- **Karton 5,0 kg.** Karton dinding tunggal seukuran ini sanggup membawa jauh lebih berat dari itu. Batasnya adalah beban yang masih nyaman ditahan selotip bawah dan box rider.
- **Dua botol besar berarti karton.** Dua botol berat di tas kertas menekan satu titik, merobek dasar tas, dan menghancurkan barang kecil di sebelahnya. Dalam simulasi pesanan sebelumnya, aturan ini mengirim sekitar 13% pesanan ke karton.
- **Barang terpanjang.** Tas menampung barang berdiri sampai setinggi lipatannya (27 cm); karton sampai sepanjang ukurannya (25 cm).

Jika data kemasan tidak ada: volume diambil dari perkiraan di daftar SKU; berat = isi (ml atau g) × 1,0 ditambah 20% untuk kemasan (plastik) atau 60% (kaca); bawaan kategori jika keduanya tidak diketahui. Saran kemasan lalu menampilkan *perkiraan*.

### 14.3 Uji sebelum go-live, lalu tetapkan

1. Isi tas sampai 3,0 kg dengan produk asli (misalnya 2 pembersih Labore 225 ml dan sisanya tube kecil).
2. Angkat dari talinya, goyangkan 10 kali, gantung selama satu menit, lalu jatuhkan dari ketinggian 30 cm ke lantai keras.
3. Jika tahan, coba 4,0 kg dengan cara yang sama. Batasnya menjadi berat terakhir yang lolos, dikurangi 20%.
4. Lakukan hal yang sama untuk karton, lalu tetapkan kedua batas di *Aturan pengingat*. Setiap penggantian kemasan oleh packer (beserta alasannya) dihitung tiap minggu, jadi batas yang salah akan kelihatan.

## 15. Admin, akses, pelatihan, dan keamanan

- **15.1** Login memakai Google SSO lewat proxy Substrait; aplikasi tidak menyimpan password. Superadmin dan Ops HQ melihat semua hub; yang lain melihat hub mereka sendiri. Tidak ada yang bisa mengubah perannya sendiri.
- **15.2** Saat go-live, akun staf otomatis dimatikan; akun dibuat seperti di 15.5.
- **15.5** **Pendaftaran** *(diputuskan 25 Sep)*: superadmin dan Ops HQ mendaftarkan dark store dan pengguna serta memberi peran (Ops HQ sampai tingkat Ops HQ; hanya superadmin yang bisa memberi peran superadmin). SPV hanya mendaftarkan staf, di hub mereka sendiri, dan bisa menonaktifkannya. Tidak ada yang bisa mengubah perannya sendiri. Login toko Hiryu untuk staf hub dibuat di Hiryu, di tab Staff milik dark store.
- **15.3** Situs pelatihan terpisah dengan banner, reset sekali ketuk, barcode uji, dan simulator pesanan Hiryu. Situs ini tidak pernah menyentuh stok asli.
- **15.4** **Keamanan**: tim keamanan Substrait meninjau aplikasi saat di-deploy dan menyebutkan apa yang harus diperbaiki. Ini menggantikan pertanyaan sebelumnya soal siapa yang meninjau temuan scan.

## 16. Target layanan dan skala

| Ukuran | Definisi | Target |
|---|---|---|
| Tepat waktu | Pesanan dikemas sebelum batas waktu siap (ready-by) | **95%** |
| Ambil dan kemas | Tempel → dikemas | **di bawah 5 menit** |
| Barang kurang | Baris pesanan dengan *Barang tidak ada* | **di bawah 3%** |
| Akurasi hitung | Bin yang dihitung tanpa selisih | **98%** |
| Akurasi ambil | Baris yang diambil tanpa henti karena produk salah | 99,5% atau lebih baik (dipantau) |

Sebelum hub kedua go-live: setiap daftar punya halaman dan berjalan dalam satu query; layar yang memantau kondisi langsung diperbarui lewat push; buffer scan pendek menahan scan saat Wi-Fi putus sebentar.

## 17. Status build

Per 25 September 2026. *Terverifikasi* = sudah dijalankan dari awal sampai akhir di situs pelatihan; *dibangun* = sudah ditulis dan dicek, belum dijalankan.

| Area | Status |
|---|---|
| Ledger, audit, pemilik stok | Terverifikasi |
| Terima lewat AWB, batch, daftar putaway, produk tak dikenal ke HQ | Terverifikasi / dibangun 17 sampai 21 Sep |
| Restock ke brand, persetujuan selisih, pengingat dan draf otomatis | Dibangun 17 sampai 21 Sep |
| Pengambilan terpandu, henti karena produk salah, kemas, ambil kurang, batal dan kembali ke rak | Terverifikasi |
| Hitung stok, hitung buta, hitung ulang, persetujuan | Terverifikasi |
| Rak dan bin, tumpuk T/B, peta hub | Dibangun 17 sampai 21 Sep |
| Stasiun di ponsel | Dibangun 21 Sep |
| **Bay yang bisa diatur, tumpukan dari ukuran bin, jenis bin (§4.2)** | **Dirinci 25 Sep** |
| **Bin max yang dipelajari sistem (isi maks. per bin) dan pertanyaan bin kedua (§8.2)** | **Dirinci 25 Sep** |
| **Form SKU: barcode, data kemasan, ukuran bin, cadangan Grab; impor data induk (§6.1)** | **Dirinci 25 Sep** |
| **Peta Hiryu, tempel, batal lewat tempel (§13.2, §13.3)** | **Dirinci 21 Sep**, dibangun pertama |
| **Serah terima ke driver, konfirmasi Mark ready (§10.3, §10.4)** | **Dirinci 25 Sep** |
| **Pengecualian dan karantina (§12)** | **Dirinci 25 Sep** |
| **Lembar stok, laporan akhir hari, cadangan Grab (§13.4 sampai §13.6)** | **Dirinci 25 Sep** |
| **Kemasan, dua kemasan (§14)** | **Dirinci 25 Sep** |
| **Pendaftaran dark store dan pengguna sesuai peran (§3, §15.5)** | **Dirinci 25 Sep** |
| **Pembuat rak dalam bentuk gambar (§4.2.7)** | **Dirinci 25 Sep**, draf kerja di A2.2 |
| **Kode SKU Hiryu di SKU (§6.1)** | **Dirinci 25 Sep** |
| **Pengiriman tanpa AWB tercatat (§5.2.2)** | **Dirinci 25 Sep** |
| **Bin inbound sementara dan baki karantina sebagai lokasi (§4.1.2)** | **Dirinci 25 Sep** |
| **Tombol batal (§10.6), langkah karantina (§12.1a)** | **Dirinci 25 Sep** |
| Tombol satu klik (§13.2.4) | Dirinci, setelah tempel |
| Gudang pusat, transfer, label unit, simulator WhatsApp | Dibangun, disembunyikan di build pertama |

**Urutan build yang diusulkan**: (1) pendaftaran dark store dan pengguna, bin sementara dan baki karantina; (2) peta Hiryu dan form SKU dengan kode Hiryu; (3) tempel pesanan; (4) serah terima, konfirmasi Mark ready, tombol batal; (5) lembar stok dan laporan akhir hari; (6) pengiriman tanpa AWB tercatat; (7) pengecualian dan karantina; (8) gambar rak, bay, dan isi maks. per bin yang dipelajari sistem; (9) kemasan; lalu tombol satu klik.

---

# Bagian C. Keputusan dan hal terbuka

## 18. Keputusan 25 September

| Topik | Keputusan |
|---|---|
| Gudang pusat (Logos) | Tidak masuk build pertama |
| Tata letak rak | Rak, bay, level, dan posisi bisa diatur; tumpukan dari ukuran bin (§4.2) |
| Serah terima | WMS mencatat pengambilan oleh driver Grab (§10.4) |
| Stok kembali ke Hiryu | WMS menampilkan daftarnya; SPV mengetiknya (§13.4, §13.5) |
| Brand saat go-live | Kahf dan Labore; 105 SKU setelah cek ulang (Lampiran B) |
| Pemilik stok | Selalu brand; model listing per brand (§6.5) |
| Pendaftaran SKU | Termasuk barcode, ukuran bin, data kemasan opsional, dan isi maks. per bin (§6.1) |
| Bin max (isi maks. per bin) | Dipelajari dari jawaban SPV soal bin kedua (§8.2) |
| Ambil kurang | Ditulis ulang dengan bahasa sederhana (§10.2) |
| Kemasan | Hanya tas kertas dan karton; aturan dan asumsinya dijelaskan (§14) |
| PRD Malaysia | Belum digabung untuk saat ini |
| Stok Grab | Berkurang saat ada pesanan, tidak dikembalikan saat batal (§9.5) |
| Pengiriman rider | Di luar cakupan WMS |
| Cadangan Grab | Ditetapkan oleh Ninja (§13.6) |
| WhatsApp | Build berikutnya di dalam WMS, setelah peluncuran (§20) |
| Restock | Brand langsung ke dark store; gudang pusat dan crossdock nanti |
| Pengecualian | Sudah dirancang (§12) |
| Keamanan | Tinjauan keamanan Substrait saat deploy |
| Data kemasan | Diminta dari brand, tidak wajib (Lampiran B) |

**Putaran kedua, 25 September**

| Topik | Keputusan |
|---|---|
| Pendaftaran | Superadmin dan Ops HQ mendaftarkan dark store dan pengguna serta memberi peran; SPV hanya mendaftarkan staf (§3) |
| Pembuat rak | Gambar berskala, bukan tabel, supaya SPV bisa memutuskan dengan melihat (A2.2) |
| Kode SKU Hiryu | Kolom di SKU, dipakai oleh lembar stok (§6.1) |
| Angka stok | Nama sederhana dengan contoh: isi maks. per bin, pesan ulang saat sisa, isi sampai, batas kritis, cadangan Grab (§8.1) |
| Pengiriman tanpa AWB tercatat | Staf memasukkannya dan menghitung; Ops HQ mendapat tanda lalu menautkannya (§5.2.2) |
| Bin inbound sementara | Disiapkan bersama dark store, sebagai lokasi yang tidak bisa dijual (§4.1.2) |
| Pengemasan | Tidak ada label untuk di-scan: slip Hiryu adalah desain Grab. *Selesai dikemas* setelah scan pengambilan (§10.3) |
| Barang tidak ada | Ditandai sampai Grab memutuskan: batalkan semua, atau kirim yang ada. Sementara itu SPV yang memutuskan (§10.2) |
| Pesanan dibatalkan | Satu tombol, *Dibatalkan di Hiryu* (§10.6) |
| Karantina | SPV memutuskan, staf memindahkannya lewat tugas yang di-scan, stok kembali saat scan bin (§12.1a) |

**Pesanan terpisah (split order)**, penjelasannya: satu pesanan pelanggan dipenuhi dari **dua dark store** (atau dua bagian dikirim terpisah) karena tidak ada hub yang punya semua barangnya. Ini butuh dua rider untuk satu keranjang kecil, jadi biayanya lebih besar dari pendapatannya. WMS tidak memisah pesanan. Untuk Grab hal ini tidak pernah terjadi, karena satu pesanan Grab milik satu toko, berarti juga satu hub.

## 19. Pertanyaan terbuka

| # | Pertanyaan | Siapa |
|---|---|---|
| Q1 | Kapan Hiryu mengurangi hitungannya sendiri saat ada penjualan (received, ready, atau completed), dan apakah pembatalan mengembalikannya? | Shaun |
| Q2 | Apa yang harus ditekan hub di Hiryu untuk setiap pilihan stok habis (ganti, hapus, batalkan, hubungi)? Apakah Hiryu bisa mengedit pesanan? | Shaun |
| Q3 | Apakah login staf hub bisa membuka halaman pesanan Hiryu dan menyalinnya? Prefiks apa yang dipakai ID item Indonesia? | Shaun |
| Q4 | Apakah bookmark satu klik boleh dipakai di PC pengemasan? | Shaun, keamanan NV |
| Q5 | Syarat konsinyasi dengan Kahf dan Labore: stok pengaman, frekuensi restock, pengembalian barang kedaluwarsa dan lambat laku, biaya restock | Grab, Paragon |
| Q6 | Siapa yang menanggung unit yang rusak saat pengiriman dan dikembalikan oleh driver? | Grab |
| Q7 | Apakah Paragon akan memberikan barcode, ukuran kemasan, dan berat (Lampiran B)? | Grab, Paragon |
| Q8 | Batas tas dan karton setelah uji beban (§14.3) | Ops |
| Q9 | Ukuran dalam JX-2 dan JX-4 dari sampel pertama (§4.2.3) | Ops |
| **Q10** | **Saat ada barang yang tidak ada, apakah Grab ingin kita membatalkan seluruh pesanan, atau mengirim yang ada? Tombol Hiryu mana dan kode pembatalan apa?** (§10.2) | Grab |
| Q11 | Siapa di Indonesia yang punya akses editor Hiryu untuk membuat login staf hub dan SKU? | Shaun |

## 20. Build berikutnya

| Build | Kapan | Catatan |
|---|---|---|
| **Tombol satu klik** | Setelah tempel berjalan | §13.2.4 |
| **Sambungan Hiryu (lima pesan)** | Saat tim Hiryu mengerjakannya | Menggantikan tempel dan lembar stok; peta tetap dipakai |
| **Pesanan WhatsApp** | Setelah WMS diluncurkan dan stabil | Awalnya berdiri sendiri di dalam WMS; nanti bisa pindah ke belakang Hiryu. Simulatornya sudah dibangun |
| **Gudang pusat** (Logos) | Nanti | Pemasok ke gudang ke dark store, transfer, pengiriman tote, peran operator hub |
| **Crossdock** | Bersama gudang pusat | Staging dengan batas waktu tinggal |
| **Tanggal kedaluwarsa** | Jika brand memintanya | Akan menambah tanggal saat penerimaan dan tanda kedaluwarsa |
| **Gabung dengan PRD Malaysia** | Tidak sekarang | |

## 21. Tidak dikerjakan

| Tidak dikerjakan | Alasan |
|---|---|
| Sambungan apa pun ke Grab | Hanya Hiryu yang berkomunikasi dengan Grab |
| Pengiriman rider | Grab menugaskan rider-nya; armada Ninja sendiri di luar WMS |
| Pesanan terpisah | Lihat §18 |
| Data pelanggan | Tidak dibutuhkan untuk ambil atau kemas, dan berisiko jika disimpan (§2.11) |
| Memanggil API internal Hiryu | Bukan milik kita, jadi tidak bisa diandalkan; WMS hanya membaca yang bisa dilihat staf |
| Melacak pembatas | FIFO di dalam bin dilakukan dengan mata, dipandu warna |
| Penempatan otomatis (slotting) | SPV menempatkan SKU menurut brand dan kategori |
| Substitusi yang diputuskan WMS | Itu pilihan pelanggan, diterapkan di Hiryu |
| Mengambil beberapa pesanan sekaligus | Baru menguntungkan pada volume yang jauh lebih tinggi |
| Settlement dan penagihan | Urusan Finance, di luar sistem |

## Lampiran A. Glosarium

| Istilah | Arti |
|---|---|
| **Hiryu** | POS Ninja untuk Grab: pesanan, menu, harga, stok yang ditampilkan Grab |
| **ID pesanan Grab (Grab order ID)** | Referensi pesanan dari Grab, misalnya `0012…-C8E3PBB2NJU2NT`; kunci untuk pesanan yang ditempel |
| **Nomor GM (GM number)** | Nomor pesanan pendek di Hiryu, misalnya `GM-358`; untuk dibaca orang, tidak unik |
| **ID item Hiryu (Hiryu item ID)** | ID Hiryu untuk item menu; dipetakan ke SKU dan unit per penjualan |
| **Tersedia (available)** | Unit di rak dikurangi unit yang ditahan untuk pesanan |
| **Ditahan (held)** | Unit yang disisihkan untuk pesanan yang belum diambil |
| **Cadangan Grab (Grab buffer)** | Unit per SKU yang ditahan dari stok yang boleh dijual Grab (§13.6) |
| **Bay** | Bagian rak di antara dua tiang tegak |
| **Ukuran bin (bin size)** | Kecil (JX-2) atau Besar (JX-4); satu ukuran per level |
| **Isi maks. per bin** | Berapa unit satu SKU yang memenuhi satu bin; dipelajari sistem (§8.2). Kode: `full` |
| **Pesan ulang saat sisa** | Reorder at: stok yang memicu draf restock. Kode: `R` |
| **Isi sampai** | Fill up to: jumlah yang dituju saat restock. Kode: `P` |
| **Batas kritis** | Critical level: di angka ini atau di bawahnya, SKU berwarna merah. Kode: `S` |
| **Kode SKU di Hiryu** | Kode SKU di Hiryu; menyejajarkan lembar stok dengan tab Stock di Hiryu |
| **Karantina** | Baki karantina hub, `HUB-KARANTINA`; tidak bisa dijual (§12.1a) |
| **Bin inbound sementara (temporary inbound bin)** | `HUB-IN-nn`, tempat pengiriman dihitung sebelum putaway; bukan stok (§4.1.2) |
| **Warna hari (day colour)** | Warna stiker untuk minggu saat pengiriman tiba, dengan tanggal di pembatas |
| **Model listing (listing model)** | Siapa merchant di Grab: model 3PL Grab atau merchant milik Ninja sendiri (§6.5) |
| **Pesanan terpisah (split order)** | Satu pesanan dipenuhi dari dua hub (§18) |
| **Lembar stok (stock sheet)** | *Stok untuk Hiryu*: angka yang diketik SPV ke Hiryu |

## Lampiran B. Data induk SKU Kahf dan Labore

**Daftar produk go-live setelah cek ulang 25 Sep: 105 SKU**, 68 Kahf (67 produk dan 1 kit pabrik) dan 37 Labore (33 produk dan 4 kit pabrik). Cek ulang menemukan 1 SKU Kahf baru dan 15 SKU Labore baru; 41 baris disisihkan (bundel marketplace, duplikat, kemungkinan sudah tidak diproduksi). 56 dari 105 SKU sudah punya barcode dari sumber publik; ukuran kemasan belum ditemukan. Rincian: `SKU-RECHECK-25SEP.md` di folder proyek Grab Kilat.

Daftar SKU dan lembar data untuk brand ada di `11 SKU Master Kahf Labore.xlsx` di folder yang sama. Isinya satu baris per SKU, sel kuning untuk diisi brand, dan kolom yang diimpor WMS (§6.1.1):

| Kolom | Wajib | Catatan |
|---|---|---|
| Brand, kode SKU, nama produk, varian, ukuran, kategori | Ya | Dari brand |
| Barcode (EAN-13) | Ya, jika tercetak | Boleh lebih dari satu, dipisah koma |
| Panjang, lebar, tinggi kemasan (mm) | Diminta | Kotak ritel atau botol, posisi berdiri |
| Berat (g) | Diminta | Kotor, termasuk kemasan |
| Cairan dalam botol (Y/N); botol besar 150 ml atau lebih (Y/N) | Diminta | Untuk aturan karton |
| Unit per karton, ukuran karton | Diminta | Untuk penerimaan |
| Masa simpan (bulan), nomor BPOM | Diminta | Untuk syarat kedaluwarsa |
| Kode SKU Hiryu, ukuran bin, isi maks. per bin | Diisi Ninja | Ukuran bin disarankan dari ukuran kemasan |

Jika brand tidak memberi apa pun, WMS memakai perkiraan di lembar itu dan menandainya *perkiraan*.
