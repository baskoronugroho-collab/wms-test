# Ninja Kilat WMS: kebutuhan sistem dan instruksi kerja

| | |
|---|---|
| **Produk** | Ninja Kilat WMS |
| **Versi** | v4.2: Hiryu dan WMS terhubung lewat API (sambungannya sendiri masih harus disepakati dengan Shaun, §0.6); pesanan masuk setelah Accept di Hiryu dan langsung diberikan ke picker; pengemasan yang selesai di WMS menandai pesanan siap; stok sampai ke Hiryu dengan sendirinya; SPV mengajukan kebutuhan restock ke Ops HQ, yang mengirim PO beserta barcode; Faktur yang sudah ditandatangani diunggah setelah inbound; daftar tugas untuk setiap peran; laporan merek mingguan dan bulanan dalam Excel |
| **Tanggal** | 30 September 2026 |
| **Pemilik** | Baskoro Nugroho |
| **Status** | Spesifikasi untuk ditinjau, proses demi proses. Layar WMS masih draf; build pertama sudah di dev |
| **Acuan** | *QC Systems: Hiryu, WMS, TMS* (ChangWen, 11 Sep 2026), `docs/canonical/qc-oms-wms.html`, untuk desain jangka panjang. Jika build pertama butuh solusi sementara (belum ada koneksi ke Hiryu), halaman ini menyebutkannya |
| **Menggantikan** | v4.1 tanggal 30 September (disimpan di `docs/archive/PRD-v4.1.md`), v3.3 (nomor bagiannya ada di Lampiran C) dan semua versi sebelumnya |
| **Platform** | Substrait · FastAPI · OceanBase · static frontend |
| **Live** | Dev: wms-test--dev.ninjavan.apps.substrait.build (build pertama, 28 Sep). Produksi: wms-test.ninjavan.apps.substrait.build |
| **Go-live** | **Kahf dan Labore** di **MA5 Cawang** dulu, lalu **KJ5 Kemanggisan** |
| **Skala** | 10 sampai 30 dark store dalam 6 bulan |

---

# Bagian A. Dasar

Yang perlu dibaca semua orang sekali: tiga sistem, aturan yang berlaku di mana saja, urutan membuka hub, dan targetnya. Bagian B lalu berisi satu bagian per proses, sesuai urutan yang dialami hub. Setiap proses berisi langkah di kedua sistem (**Hiryu dulu**), lalu aturan yang diikuti WMS, lalu **hal terbuka**: yang belum diputuskan atau belum ditulis. Layar dengan sidebar Hiryu hijau adalah Hiryu, digambar ulang dari Hiryu Malaysia; yang lain draf WMS. Titik bernomor di layar sama dengan nomor langkah di bawahnya.

## 0. Pilot dan aturannya

### 0.1 Cara kerja pilot

**Ada tiga sistem. Hiryu dan WMS terhubung lewat API** *(diputuskan 30 Sep; sambungannya sendiri masih harus disepakati dengan Shaun, §0.6)*.

| Sistem | Siapa yang memakai | Fungsinya |
|---|---|---|
| **Grab** | Pelanggan | Menerima pesanan, menerima pembayaran, mengirim rider Grab |
| **Hiryu** | Ops HQ, SPV, dan staf yang memantau pesanan | POS milik Ninja dan satu-satunya penghubung ke Grab. Menyimpan toko Grab, menu, harga, dan SKU. Menerima semua pesanan Grab, tempat staf menekan **Accept**, dan mencetak slip kemas |
| **WMS** | Ops HQ, SPV, dan staf | Tahu letak setiap unit: di rak mana, di bin mana. Memberikan setiap pesanan ke picker, memeriksa setiap unit lewat scan, mengemas, menghitung isi rak, menerima kiriman, membuat permintaan restock ke merek |

Yang lewat sambungan, dengan sendirinya (§0.6):

- **Pesanan**: setelah staf menekan *Accept* di Hiryu, Hiryu mengirim pesanan ke WMS, sudah dalam bentuk SKU dan unit. Pembatalan lewat jalur yang sama.
- **Pesanan siap**: saat packer mengetuk *Selesai dikemas* di WMS, Hiryu menandai pesanan siap di Grab.
- **Stok**: setelah setiap perubahan, WMS mengirim ke Hiryu angka yang boleh dijual Grab. Tidak ada yang mengetik stok.
- **Menu dan SKU**: Hiryu mengirimnya ke WMS setiap kali ada perubahan.
- **Data pelanggan tidak pernah masuk ke WMS.** Nama, nomor telepon, alamat, dan pembayaran tetap di Hiryu.

### 0.2 Ringkasan dan cakupan

Ninja Van memenuhi pesanan quick-commerce untuk merek dari dark store kecil. Untuk **GrabMart Kilat**, Grab menerima pesanan dan mengirim driver; Ninja menyimpan stok, mengambil barang, dan mengemasnya. POS Ninja, **Hiryu**, menerima pesanan Grab dan menyimpan menu. **WMS** adalah lapisan di bawahnya: ke mana satu unit disimpan, di mana picker menemukannya, apakah unit itu benar-benar ada, dan apa yang tiba dibanding apa yang menurut merek sudah dikirim.

**Versi pertama** *(diputuskan 25 Sep, diperbarui 30 Sep)*: hanya dark store; merek mengirim langsung; Hiryu dan WMS terhubung lewat API (§0.6); Kahf dan Labore di MA5, lalu KJ5.

**Desain target** (dokumen acuan): setiap pesanan masuk lewat Hiryu, hanya Hiryu yang berkomunikasi dengan WMS, hanya WMS yang menghitung stok di rak (§0.6).

### 0.3 Prinsip

- **0.3.1** **WMS tidak pernah berkomunikasi dengan Grab.** Kanal penjualan terhubung ke Hiryu, dan Hiryu terhubung ke WMS (§0.6).
- **0.3.2** **Satu hitungan rak.** Ledger WMS adalah satu-satunya hitungan stok di rak. Hiryu berhenti menyimpan hitungannya sendiri dan menampilkan angka dari WMS (§9).
- **0.3.3** **Setiap pergerakan stok di-scan.** Picking punya cek scan yang tidak bisa dilewati staf.
- **0.3.4** **Ledger hanya bisa ditambah.** Saldo dihitung dari pergerakan; stok negatif ditolak; setiap scan bisa diulang tanpa terhitung dua kali.
- **0.3.5** **Merah hanya berarti gagal.** Setiap status punya warna, ikon, dan kata-kata.
- **0.3.6** **Tidak ada teks bebas di lantai gudang.** Jumlah diisi lewat stepper dan keypad.
- **0.3.7** **Bahasa Indonesia sebagai default**, bahasa Inggris cukup satu ketukan, untuk setiap teks.
- **0.3.8** **Hanya online, dan sistem memberi tahu.** Jika koneksi putus, pekerjaan terhenti dan hal itu terlihat jelas.
- **0.3.9** **Mode latihan tidak pernah menyentuh stok asli.**
- **0.3.10** **Semua stok milik merek** (§2.11).
- **0.3.11** **Data pelanggan tetap di Hiryu.** WMS tidak pernah menerima, menyimpan, mencatat di log, atau menampilkan nama, nomor telepon, alamat, catatan, atau pembayaran pelanggan, dan tidak ada tabel yang punya kolom untuk data itu (§0.6.1).
- **0.3.12** **Hiryu dulu** *(diputuskan 28 Sep, disesuaikan 30 Sep)*. Hiryu adalah penghubung dengan Grab dan yang dilihat pelanggan. Dark store, login, SKU, menu, dan hubungan toko dibuat di Hiryu dulu, dan pesanan dimulai dengan *Accept* di Hiryu. Sejak pesanan diterima, lantai gudang bekerja di WMS: ambil, kemas, dan *pesanan siap* yang dikirim WMS ke Hiryu. Angka stok dihitung di WMS lalu dikirim ke Hiryu.
- **0.3.13** **Tidak ada jalur manual** *(diputuskan 30 Sep)*. Tidak ada copy dan paste pesanan dan tidak ada stok yang diketik. Jika sambungan atau WMS mati, hub dijeda di Grab (§14).

### 0.4 Membuka hub baru, berurutan

Sebelum pesanan Grab pertama, langkah-langkah ini dikerjakan **sesuai urutan ini**. Hurufnya menunjukkan fase di peta proses di bawah. Klik nomor bagian untuk membuka langkahnya.

| # | Fase | Siapa | Di mana | Langkah | Lihat |
|---|---|---|---|---|---|
| 1 | A | Ops HQ (ADMIN Hiryu) | Hiryu | Pengaturan Indonesia, satu kali; dark store dan jam bukanya; login MANAGER untuk SPV | §2.1.1 |
| 2 | A | Ops HQ | WMS | Daftarkan hub; tambahkan SPV | §2.1.2, §1.3 |
| 3 | A | SPV | Hiryu, lalu WMS | Login staf di Hiryu, lalu akun staf di WMS | §1.3.1 |
| 4 | A | SPV | Di hub | Siapkan perangkat dan login di masing-masing | §12.1 |
| 5 | B | SPV | WMS, lalu printer | Bin inbound sementara dan baki karantina; cetak dan tempel labelnya | §3.1 |
| 6 | B | SPV | Di rak, lalu WMS | Daftarkan setiap rak sesuai kondisi aslinya; cetak dan tempel label bin | §3.2 |
| 7 | B | Ops HQ | WMS | Tambahkan merek | §2.2.1 |
| 8 | B | Ops HQ, dengan konten dari merek | Hiryu | Buat menu toko pertama, lalu salin ke toko lain milik merek tersebut | §2.2.2, §2.2.3 |
| 9 | B | Ops HQ | Hiryu | Buat SKU dan hubungkan setiap item ke SKU-nya | §2.2.4 |
| 10 | B | Ops HQ | WMS | Cek menu dan SKU yang dikirim Hiryu, lalu lengkapi angka stoknya | §2.2.5, §2.2.6 |
| 11 | B | SPV | WMS | Beri setiap SKU satu bin | §3.3 |
| 12 | B | Ops HQ, dengan login manajer Grab milik setiap toko | Hiryu, lalu Grab | Buat keempat toko, beri masing-masing hub dan menunya, aktifkan di Grab, cek menu sudah sampai di Grab | §2.4.1 sampai §2.4.5 |
| 13 | C | SPV mengajukan, Ops HQ mengirim | WMS, lalu email | PO pertama ke setiap merek, beserta barcode | §4.1 |
| 14 | D | Staf, lalu SPV | WMS | Terima kiriman pertama dan simpan ke rak; unggah Faktur yang sudah ditandatangani | §5.1 |
| 15 | A | Ops HQ | WMS | Cek stok awal sudah sampai di setiap toko di Hiryu | §9.3 |
| 16 | A | Ops HQ | Grab, Hiryu, WMS | Satu pesanan uji per toko, dari awal sampai akhir, lalu buka | §2.4.6 |

**Hiryu dulu.** Setiap langkah yang menyentuh kedua sistem: kerjakan bagian Hiryu lebih dulu. Hiryu adalah penghubung dengan Grab: itulah yang dilihat pelanggan.

Toko yang sudah aktif tetapi belum punya stok tidak menampilkan apa pun yang bisa dijual Grab. Cek ini di toko pertama (langkah 12) sebelum mengaktifkan tiga toko lainnya.

### 0.5 Target layanan dan skala **[USULAN]**

**Usulan untuk diputuskan Ops.** Belum ada angka yang disepakati. Angka ini adalah titik awal yang ditinjau lagi setelah minggu-minggu pertama di MA5.

| Ukuran | Definisi | Target |
|---|---|---|
| Diterima | Pesanan masuk ke Hiryu → *Accept* | **dalam 1 menit** |
| Ambil dan kemas | Pesanan masuk ke WMS → *Selesai dikemas* | **di bawah 5 menit** |
| Siap | Pesanan masuk ke Hiryu → pesanan siap | **rata-rata 10 menit**; di luar jam sibuk bisa lebih lama |
| Tepat waktu | Pesanan siap sebelum batas waktu siap (ready-by) | **95%** |
| Barang kurang | Baris pesanan dengan *Barang tidak ada* | **di bawah 3%** |
| Akurasi hitung | Bin yang dihitung tanpa selisih | **98%** |
| Akurasi ambil | Baris yang diambil tanpa henti karena produk salah | 99,5% atau lebih baik (dipantau) |

Sebelum hub kedua go-live: setiap daftar punya halaman dan berjalan dalam satu query; layar yang memantau kondisi langsung diperbarui lewat push; buffer scan pendek menahan scan saat Wi-Fi putus sebentar.

### 0.6 Sambungan Hiryu **[DISEPAKATI DENGAN SHAUN]**

Mulai 30 September, rencananya **Hiryu dan WMS dihubungkan lewat API**. Shaun, pemilik Hiryu, membangun sisi Hiryu. Bagian ini berisi apa yang diharapkan sisi WMS; semua yang bertanda *terbuka* harus disepakati dengan Shaun sebelum salah satu sisi membangunnya. Bagian lain dokumen ini ditulis seolah sambungannya sudah berjalan.

#### 0.6.1 Pesan-pesannya

| # | Pesan | Dari → ke | Kapan | Isi | WMS saat ini |
|---|---|---|---|---|---|
| 1 | **Pesanan untuk diambil** (Order to pick) | Hiryu → WMS | Staf menekan **Accept** di Hiryu (keempat toko memakai penerimaan MANUAL) | ID pesanan Grab, nomor GM, ID toko Hiryu, waktu pesanan, waktu terjadwal jika ada, perkiraan waktu siap dari Grab jika Hiryu punya; per baris **kode SKU dan unit** (jumlah item × unit per penjualan, dihitung Hiryu dari Bundles), ID item Hiryu, jumlah item, dan harga item | Penerima sudah dibuat (`POST /api/orders`); kolomnya masih harus dipetakan ke kolom Hiryu |
| 2 | **Pesanan dibatalkan** (Order cancelled) | Hiryu → WMS | Pelanggan, Grab, atau Hiryu membatalkan, termasuk pembatalan setelah pesan 5 | ID pesanan Grab, alasan pembatalan | Penerima sudah dibuat (`POST /api/orders/{ref}/cancel`) |
| 3 | **Level stok** (Stock level) | WMS → Hiryu | Setelah setiap perubahan: simpan ke rak, ambil, hitung stok, karantina, kembali ke rak, pembatalan | ID toko Hiryu, kode SKU, **tersedia untuk dijual** (stok di rak − yang ditahan untuk pesanan − cadangan Grab) sebagai angka mutlak, dan waktunya | Masuk antrean setelah setiap perubahan; pengirimnya masih harus dibuat |
| 4 | **Pesanan siap** (Order ready) | WMS → Hiryu | Packer mengetuk **Selesai dikemas** | ID pesanan Grab | Masuk antrean; pengirimnya masih harus dibuat. Hiryu menandai pesanan siap di Grab |
| 5 | **Barang kurang** (Item short) | WMS → Hiryu | *Barang tidak ada*, setelah langkah cek di tempat lain tidak menemukan apa pun | ID pesanan Grab, kode SKU, unit yang diminta, unit yang ditemukan | Masuk antrean; pengirimnya masih harus dibuat. Hiryu membatalkan sendiri dengan **2001 Item out of stock** (terbuka: edit pesanan sebagai gantinya, §0.6.4) |
| 6 | **Katalog** (Catalogue) | Hiryu → WMS | Toko, menu, item, bundel, atau SKU dibuat atau diubah di Hiryu; juga daftar lengkap saat WMS memintanya | Toko (ID, nama, dark store, merek, status); SKU (kode, nama, barcode); per menu toko, setiap item (ID, nama, kode SKU, unit per penjualan, harga, tersedia) | Masih harus dibuat. Menggantikan unggahan CSV menu |

**Tidak pernah dikirim**: data pelanggan (nama, nomor telepon, alamat, catatan, pembayaran), data driver, dan status Grab setelah *ready*. Serah terima ke driver dicek staf di WMS (§7) dan tidak butuh apa pun dari Hiryu.

#### 0.6.2 Aturan untuk setiap pesan

- **Angka mutlak**, tidak pernah "+2". Setiap pesan punya ID unik dan **aman diterima dua kali**.
- **Antrean yang tersimpan permanen dan pengiriman ulang** di kedua sisi, dengan jeda yang makin panjang di antara percobaan. Pesan pesanan didahulukan dari pesan stok.
- **Urutan tertukar**: pembatalan yang datang sebelum pesanannya disimpan dulu, lalu diterapkan saat pesanannya datang.
- **Kunci**: **ID pesanan Grab** untuk pesanan (nomor GM bisa berulang); **ID toko Hiryu** ↔ hub dan merek di WMS; **kode SKU Hiryu = kode SKU WMS**, dicocokkan tanpa melihat huruf besar atau kecil.
- **Hiryu berhenti menyimpan hitungan stoknya sendiri**: tidak ada pengurangan saat *Mark ready*; *Units on hand* menjadi angka dari pesan 3.
- **Situs pelatihan tidak mengirim apa pun.**
- **Keamanan**: hanya HTTPS; shared secret di header request (saat ini `X-Hiryu-Key`), berbeda untuk dev dan produksi. WMS berjalan di belakang login Google di Substrait, jadi alamat yang dipanggil Hiryu harus dibuka sebagai **public path**, yang dilindungi secret tersebut.

#### 0.6.3 Yang sudah ada di WMS saat ini

| Bagian | Status |
|---|---|
| Menerima pesanan: menahan stok, membuat tugas ambil | Sudah dibuat (`POST /api/orders`) |
| Menerima pembatalan: melepas stok, unit yang sudah diambil masuk ke *Kembalikan ke rak* | Sudah dibuat (`POST /api/orders/{ref}/cancel`) |
| Antrean untuk pesan 3, 4, dan 5, pesan pesanan didahulukan, situs pelatihan tidak pernah mengirim | Sudah dibuat; belum ada yang dikirim |
| Pengaturan: alamat Hiryu, shared secret, sakelar yang membuat pengiriman tetap mati | Sudah dibuat (`POS_WEBHOOK_URL`, `POS_SHARED_SECRET`, `POS_PUSH_ENABLED=false`) |
| Halaman integrasi yang menampilkan antrean | Sudah dibuat (*Integrasi Hiryu*) |
| Pengirim untuk pesan 3, 4, dan 5; penerima untuk pesan 6; public path di Substrait | Masih harus dibuat |

#### 0.6.4 Hal terbuka untuk disepakati dengan Shaun

1. **Barang yang tidak ada.** Partner API Grab punya *Edit order* (menandai satu baris habis) selain *Cancel*, dan *Cancel* punya batasan (panggilan *check cancelable*). Bisakah Hiryu memakai *Edit order* untuk GrabMart Indonesia? Jika bisa, pesan 5 menghapus baris itu dan sisa pesanan tetap berjalan; jika tidak, Hiryu membatalkan dengan 2001.
2. **Sisi Hiryu untuk pesan 3, 4, dan 5**: alamatnya, formatnya, serta URL dev dan produksi.
3. **Pesan 6**: dikirim di setiap perubahan, diambil WMS saat diminta, atau keduanya; nama kolomnya.
4. **Pesan 1 saat Accept**: pastikan pesan terkirim begitu *Accept* ditekan, dan terus dikirim ulang sampai WMS mengonfirmasi.
5. **Jika WMS tidak menjawab**: apakah Hiryu menjeda hub di Grab sendiri setelah sekian menit, atau hanya memberi peringatan?
6. **Menyalakan sambungan**: uji semuanya di toko uji di dev lebih dulu; saat go-live WMS mengirim snapshot stok lengkap dan Hiryu mematikan pengurangan stoknya sendiri di saat yang sama.
7. **Pemantauan**: siapa yang diberi peringatan, di masing-masing sisi, saat pesan gagal.
8. **Waktu siap dari Grab**: bisakah pesan 1 membawa perkiraan waktu siap dan batas waktu siap paling lambat dari Grab, supaya WMS bisa mengurutkan antrean berdasarkan itu?

### 0.7 Hal terbuka

- **Sambungan Hiryu** (§0.6.4): delapan hal untuk disepakati dengan Shaun.
- **Lanjut atau tidak ke KJ5.** Angka apa yang harus dicapai MA5 sebelum KJ5 buka (§0.5), dan berapa lama? *Usulan:* dua minggu di MA5 sesuai target. *Yang memutuskan:* Ops.
- **Tingkat layanan Grab** (Q13): batas siap 10 menit adalah target rata-rata, bukan angka dari Grab.

## Peta proses

Seluruh operasi dalam satu halaman: **siapa** yang mengerjakan setiap langkah (baris) dan di **fase mana** (kolom). Klik langkah mana saja untuk membuka instruksinya; setiap bagian proses punya link **↑ Peta** untuk kembali ke sini. Warna menunjukkan sistemnya: hijau untuk Hiryu, merah untuk WMS, abu-abu untuk pekerjaan manual atau di luar kedua sistem.

<!--screen:process-map-->

# Bagian B. Proses

Lima belas proses. Masing-masing diawali siapa yang mengerjakan, di sistem mana, dan apa yang sudah ada di dev.

## 1. Login dan akses pengguna

**Siapa**: Ops HQ, SPV · **Sistem**: Hiryu dulu, lalu WMS · **Di dev**: login Google dan daftar pengguna. Peran versi 28 Sep (Ops Head, SPV hanya menambah staf): belum

### 1.1 Masuk ke Hiryu

<!--screen:hiryu-login-->

Ada **dua cara masuk**. Cara yang dipakai tergantung email yang dipakai untuk membuat akun Hiryu Anda.

1. **Siapa saja · Halaman login Hiryu**

   Pilih **Indonesia** di bagian atas. Malaysia punya daftar toko dan pengguna sendiri.

   ✓ Yang terlihat: kotak login Indonesia.

2. **Jika akun Hiryu Anda memakai email Ninja Van (@ninjavan.co)**

   Tekan **Sign in with Google** lalu pilih akun Google Ninja Van Anda.

   ✓ Yang terlihat: Hiryu terbuka di layar yang boleh dibuka sesuai peran Anda.

3. **Jika akun Hiryu Anda memakai email lain (misalnya @gmail.com)**

   Ketik email dan password, lalu tekan **Sign in**. Saat pertama kali, pakai password sementara dari SPV atau Ops HQ. Setelah itu Hiryu meminta Anda membuat password sendiri.

   ✓ Yang terlihat: Hiryu terbuka di layar yang boleh dibuka sesuai peran Anda.

Login hub (SPV dan staf) hanya melihat Live Orders, Orders, halaman pesanan, dan tab Stock toko mereka. Tidak ada yang lain. Ops HQ melihat layar kantor sesuai perannya.

**Siapa memegang peran Hiryu apa**

| Peran Hiryu | Diberikan kepada | Bisa |
|---|---|---|
| **ADMIN** | Lead Ops HQ (diberikan oleh pemilik proyek) | Semuanya, termasuk pengguna, pengaturan, dan *Activate on Grab* |
| **EDITOR** | Ops HQ | Toko, menu, SKU, stok, jam buka, staf hub |
| **VIEWER** | Siapa saja yang hanya perlu melihat | Hanya melihat |
| **MANAGER** (login hub) | SPV hub | Orders, Live Orders, mengetik stok, login staf di hub sendiri |
| **STAFF** (login hub) | Staf hub | Orders, Live Orders, halaman pesanan |

WMS berbeda: WMS **hanya** menerima akun Google Ninja Van (§1.4.1).

### 1.2 Pengguna dan peran

| Peran | Di mana | Tugas |
|---|---|---|
| **Staf** | Lantai dark store | Terima pesanan di Hiryu (staf yang memantau pesanan), terima barang per AWB, simpan ke rak, ambil, kemas, serahkan, hitung stok, laporkan masalah |
| **SPV** | Hub miliknya sendiri | Bin inbound sementara, rak dan bin, SKU ke bin, pertanyaan bin kedua, keputusan masalah, **mengajukan kebutuhan restock ke Ops HQ**, **mengunggah Faktur yang sudah ditandatangani** setelah setiap inbound, **melaporkan unit lebih atau kurang ke Ops HQ**, pengesahan hitung stok, cek akhir hari, **mendaftarkan staf** |
| **Ops HQ** | Semua hub | **Menambahkan merek**, angka stok SKU dan cadangan Grab, **PO ke merek** (satu-satunya peran yang mengirimnya), mencatat kiriman dan **tanggal kedaluwarsa dari Faktur**, **menyelesaikan selisih Faktur dengan merek lewat email**, menyetujui write-off, pengesahan selisih, menautkan kiriman tanpa AWB tercatat, **mendaftarkan dark store dan pengguna serta memberi peran** |
| **Ops Head** | Semua hub | **Semua yang dilakukan Ops HQ**, ditambah **persetujuan terakhir** untuk setiap selisih (selisih hitung, selisih kiriman) dan setiap write-off (§11.5) |
| **Superadmin** | Semua | Semua yang dilakukan Ops HQ, memberi peran Ops Head dan superadmin, melihat aplikasi sebagai peran lain (hanya baca) |

**Siapa mendaftarkan siapa** *(diputuskan 25 Sep; Ops Head 30 Sep)*:

| | Daftarkan dark store | Tambah merek | Daftarkan pengguna | Peran yang bisa diberikan |
|---|---|---|---|---|
| **Superadmin** | Ya | Ya | Ya | Semua, termasuk Ops Head dan superadmin |
| **Ops Head** | Ya | Ya | Ya | Staf, SPV, Ops HQ |
| **Ops HQ** | Ya | Ya | Ya | Staf, SPV, Ops HQ |
| **SPV** | Tidak | Tidak | Ya, di hub miliknya | Hanya staf |
| **Staf** | Tidak | Tidak | Tidak | Tidak ada |

Peran Ops Head dibuat sekarang; siapa yang memegangnya diputuskan nanti. Hiryu punya perannya sendiri (ADMIN, EDITOR, VIEWER untuk staf kantor; MANAGER dan STAFF untuk login hub). Siapa memegang peran apa ada di §1.1. Apa yang harus diselesaikan setiap peran setiap hari ada di daftar **Perlu tindakan** miliknya (§13.5).

- **1.2.1** Server menegakkan setiap izin; console menyembunyikan layar yang tidak bisa dipakai suatu peran.
- **1.2.2** Peran *hub operator* untuk gudang pusat disembunyikan di build pertama dan kembali bersama gudang pusat (§19).
- **1.2.3** **Dua tampilan.** *Station* untuk lantai gudang: huruf besar, satu keputusan per layar, area scan yang selalu aktif; bisa dipakai di laptop dengan scanner, tablet, atau ponsel (bisa diinstal, scan dengan kamera, atau ketik kodenya). *Console* untuk SPV dan Ops HQ: tabel, filter, antrean.

### 1.3 Akun untuk orang baru

> **Istilah · Akun Google Ninja Van**
> Email kerja orang tersebut, berakhiran **@ninjavan.co**, dengan login Google. **Setiap orang yang bekerja di operasi ini wajib punya**, termasuk staf: WMS tidak menerima akun lain (§1.4.1). Minta ke NV IT sebelum shift pertama orang tersebut.

1. **Ops HQ (atau SPV, untuk staf di hub-nya sendiri) · WMS → Dark store & pengguna → Tambah pengguna**

   Ketik **email @ninjavan.co** orang tersebut dan namanya, pilih **peran**, lalu centang **hub**-nya. Tekan **Simpan**.

   ✓ Yang terlihat: orang tersebut ada di daftar pengguna dengan peran dan hub yang Anda pilih.

2. **Orang baru · perangkat apa saja · link WMS**

   Buka WMS lalu pilih akun Google Ninja Van miliknya.

   ✓ Yang terlihat: WMS terbuka di hub-nya. Untuk staf, menu station; untuk SPV dan Ops HQ, console.

Ops HQ bisa memberi peran Staf, SPV, dan Ops HQ. Hanya superadmin yang bisa memberi peran Ops Head atau superadmin. SPV hanya melihat *Tambah pengguna*, dan hanya bisa menambah **Staf** di hub mereka sendiri.

#### 1.3.1 Akun staf di kedua sistem

Staf juga butuh login hub di Hiryu, karena mereka membuka pesanan di Hiryu. **Hiryu dulu.**

1. **SPV · Hiryu → Dark stores → hub Anda → Staff → Add staff**

   Ketik email orang tersebut (email @ninjavan.co jika punya, agar bisa login dengan Google), namanya, dan peran **STAFF**. Pakai MANAGER hanya untuk wakil SPV. Tekan **Add**.

   ✓ Yang terlihat: **password sementara**, ditampilkan satu kali. Catat sekarang untuk orang tersebut; Hiryu tidak akan menampilkannya lagi.

2. **SPV · WMS → Dark store & pengguna → Tambah pengguna**

   Tambahkan orang yang sama seperti di §1.3 langkah 1, peran **Staf**, hub Anda.

   ✓ Yang terlihat: orang tersebut ada di daftar pengguna WMS.

3. **Orang baru · laptop packing**

   Login ke Hiryu (§1.1) dengan password sementara, lalu buat password sendiri. Setelah itu login ke WMS dengan akun Google.

   ✓ Yang terlihat: Live Orders di Hiryu dan menu station WMS.

#### 1.3.2 Saat ada yang berhenti

Akun seseorang **tidak pernah diwariskan** ke orang lain. Orang yang berhenti kehilangan kedua loginnya, dan penggantinya mendapat login baru.

1. **SPV (atau Ops HQ) · Hiryu → Dark stores → hub tersebut → Staff**

   Cari orang tersebut lalu hapus. Lakukan di hari terakhirnya.

   ✓ Yang terlihat: orang tersebut sudah tidak ada di daftar staf hub.

2. **SPV (atau Ops HQ) · WMS → Dark store & pengguna → orang tersebut → Nonaktifkan**

   ✓ Yang terlihat: orang tersebut ditandai nonaktif. Scan dan persetujuan yang pernah dilakukannya tetap memakai namanya.

3. **SPV · laptop packing**

   Pastikan orang tersebut sudah logout dari Hiryu dan WMS di laptop dan di ponsel hub.

4. **SPV atau Ops HQ · untuk pengganti**

   Daftarkan orang baru dari awal: §1.3, lalu §1.3.1.

### 1.4 Admin, akses, pelatihan, dan keamanan

- **1.4.1** Login memakai Google SSO lewat proxy Substrait; aplikasi tidak menyimpan password. **Hanya akun Google Ninja Van (@ninjavan.co) yang bisa login** *(diputuskan 30 Sep)*: setiap orang di operasi ini, termasuk staf, wajib punya. Superadmin, Ops Head, dan Ops HQ melihat semua hub; yang lain melihat hub mereka sendiri. Tidak ada yang bisa mengubah perannya sendiri.
- **1.4.2** Saat go-live, akun staf otomatis dimatikan; akun dibuat seperti di §1.4.5.
- **1.4.5** **Pendaftaran** *(diputuskan 25, 28, dan 30 Sep)*: superadmin, Ops Head, dan Ops HQ mendaftarkan dark store, menambah merek, mendaftarkan pengguna, dan memberi peran (sampai tingkat Ops HQ; hanya superadmin yang bisa memberi peran Ops Head atau superadmin). SPV hanya mendaftarkan staf, di hub mereka sendiri, dan bisa menonaktifkannya. Saat ada yang berhenti, akunnya ditutup dan penggantinya didaftarkan dari awal (§1.3.2). Tidak ada yang bisa mengubah perannya sendiri.
- **1.4.6** **Akses Hiryu** *(28 dan 30 Sep)*: pemilik proyek memegang ADMIN Hiryu untuk Indonesia dan memberikannya (atau EDITOR, VIEWER) ke Ops HQ. Login hub (MANAGER untuk SPV, STAFF untuk staf) dibuat di tab Staff milik dark store di Hiryu, oleh ADMIN, EDITOR, atau MANAGER hub itu. Hiryu menampilkan password sementara satu kali; orang itu membuat password sendiri saat login pertama. Login yang dibuat dengan email @ninjavan.co juga bisa memakai *Sign in with Google* (§1.1).
- **1.4.7** **Merek tidak login** ke WMS atau Hiryu *(diputuskan 30 Sep)*. Merek menerima permintaan dan laporan (§4.1, §15).
- **1.4.3** Situs pelatihan terpisah dengan banner, reset sekali ketuk, barcode uji, dan simulator pesanan Hiryu. Situs ini tidak pernah menyentuh stok asli.
- **1.4.4** **Keamanan**: tim keamanan Substrait meninjau aplikasi saat di-deploy dan menyebutkan apa yang harus diperbaiki. Ini menggantikan pertanyaan sebelumnya soal siapa yang meninjau temuan scan.

### 1.5 Hal terbuka

- **Siapa Ops Head** untuk pilot, dan siapa penggantinya saat berhalangan. Peran ini dibuat sekarang (§1.2); setiap selisih dan write-off menunggu persetujuannya.
- **Lupa password Hiryu.** Bisakah SPV mereset login staf di Hiryu, atau login itu dihapus lalu dibuat ulang? *Perlu dicek di Hiryu.*

## 2. Pendaftaran dan pengaturan toko: hub, merek, SKU, toko Grab

**Siapa**: Ops HQ (ADMIN atau EDITOR di Hiryu) · **Sistem**: Hiryu dulu, lalu Grab; WMS menerima hasilnya · **Di dev**: *Menu & toko Hiryu* (unggah CSV menu, akan diganti katalog dari Hiryu, §0.6), 28 Sep. *Lengkapi data SKU* dan form merek: belum

### 2.1 Ops HQ: daftarkan hub baru

Satu hub adalah satu dark store fisik (MA5 Cawang, KJ5 Kemanggisan). Hub didaftarkan satu kali di Hiryu dan satu kali di WMS, **Hiryu dulu**, dengan nama yang sama di keduanya.

#### 2.1.1 Di Hiryu: instance, dark store, jam buka, login SPV

<!--screen:hiryu-darkstore-->

1. **Ops HQ (ADMIN Hiryu) · Hiryu → Settings** · *sekali untuk Indonesia*

   Cek bahwa instance melayani **Indonesia**, mata uangnya **IDR**, dan hari kerja memakai waktu Jakarta (WIB). Mata uang hanya bisa diubah selama belum ada menu, jadi kerjakan ini sebelum membuat menu apa pun.

   ✓ Yang terlihat: Indonesia, IDR, Asia/Jakarta.

2. **Ops HQ (ADMIN) · Hiryu → Users → Invite user** · *sekali per orang kantor*

   Untuk setiap orang Ops HQ yang butuh Hiryu: email @ninjavan.co, nama, dan peran **EDITOR** (atau VIEWER jika hanya untuk melihat). Mereka masuk dengan Google (§1.1).

   ✓ Yang terlihat: orang itu ada di daftar pengguna.

3. **Ops HQ (ADMIN atau EDITOR) · Hiryu → Dark stores → New dark store**

   Beri nama yang sama dengan di WMS (*Cawang*). Satu dark store untuk setiap hub fisik.

   ✓ Yang terlihat: dark store baru, belum ada toko dan belum ada staf.

4. **Ops HQ · Hiryu → Dark stores → hub tersebut → Hours**

   Atur jam buka dan jam tutup untuk setiap hari dalam seminggu, lalu tekan **Save hours**. Semua toko Grab yang dilayani dari hub ini mengikuti jam ini.

   ✓ Yang terlihat: *Hours saved*.

5. **Ops HQ · Hiryu → Dark stores → hub tersebut → Staff → Add staff**

   Email SPV, nama, peran **MANAGER**. Hiryu menampilkan **password sementara satu kali**: langsung berikan ke SPV. SPV memilih password sendiri saat pertama kali masuk.

   ✓ Yang terlihat: SPV ada di daftar staf hub.

#### 2.1.2 Di WMS: dark store

<!--screen:admin-setup-->

1. **Ops HQ (atau superadmin) · WMS → Dark store & pengguna → Tambah dark store**

   Isi kode hub (MA5), nama, alamat, nama dark store di Hiryu (*Cawang*), dan SPV hub. Tekan **Simpan**.

   ✓ Yang terlihat: hub ada di daftar, dan **baki karantina** `MA5-KARANTINA` sudah dibuat untuknya.

2. **Ops HQ · WMS → Dark store & pengguna → Tambah pengguna**

   Tambahkan SPV seperti di §1.3.

   ✓ Yang terlihat: SPV dengan peran SPV di hub ini.

> **Istilah · Baki karantina (quarantine tray)**
> **Apa itu:** satu kotak di setiap hub untuk unit yang tidak boleh dijual: rusak, bocor, kedaluwarsa, atau meragukan. Unit di dalamnya tidak dihitung sebagai stok yang bisa dijual sampai SPV memutuskan apa yang dilakukan dengannya (§11.2).
>
> **Berapa banyak:** satu per hub. WMS membuatnya sendiri dan baki ini tidak bisa dimatikan.
>
> **Yang kamu kerjakan secara fisik:** ambil satu bin besar (JX-4) atau krat bertutup, cetak labelnya di kertas A4 (§3.1), tempel label di bagian depan, lalu taruh **jauh dari rak picking**, di dekat meja SPV, supaya tidak ada yang mengambil barang dari situ karena salah.

Setelah itu SPV menyiapkan bin inbound sementara dan mencetak kedua label (§3.1).

### 2.2 Ops HQ: tambahkan merek dan produknya

**Hiryu dulu**, lalu WMS. Setiap merek punya satu toko Grab per hub, dan **setiap toko punya menunya sendiri** *(diputuskan 30 Sep)*: menu toko pertama dibuat, lalu disalin ke toko lain milik merek itu. Setelah itu WMS mengambil SKU merek dari menu tersebut, jadi tidak ada yang diketik dua kali.

Merek menyediakan isinya: nama produk, ukuran, deskripsi, foto, dan harga. Ops HQ yang memasukkannya.

> **Istilah · SKU dan item menu**
> **SKU** adalah **barang yang ada di rak**: satu produk dalam satu ukuran, dengan satu barcode (*Labore GentleBiome Mild Cleanser 100 ml*). **Item menu** adalah **apa yang dibeli pelanggan di Grab**. Satu SKU bisa dijual satuan dan juga sebagai paket isi 2: dua item menu, satu SKU. **Units per sale** menunjukkan berapa unit SKU yang dipakai satu penjualan: 1 untuk satuan, 2 untuk paket isi 2.

> **Istilah · Kode SKU di Hiryu**
> Kode yang dimiliki sebuah SKU di Hiryu. Hiryu mencetaknya di bawah nama SKU di tab Stock, dan WMS memakai kode yang sama untuk setiap SKU, jadi kedua sistem selalu merujuk produk yang sama (§0.6.2). Untuk produk satuan, kode ini sama dengan kode item menunya (§2.2.4).

#### 2.2.1 Tambahkan merek di WMS

<!--screen:brand-form-->

1. **Ops HQ (atau superadmin) · WMS → Merek → Tambah merek**

   Nama, kode singkat (*LBR*), dan perusahaan pemilik merek.

2. **Form yang sama · Model listing di Grab**

   *Grab minta Ninja jadi 3PL* (Grab yang membawa mereknya, seperti Kahf dan Labore) atau *Ninja daftar merchant sendiri* (Ninja sendiri yang mendaftarkan merek itu di Grab). Stok selalu milik merek.

3. **Form yang sama · Kontak restock**

   Siapa di pihak merek yang menerima permintaan restock: nama, nomor WhatsApp atau email.

4. **Form yang sama · Dijual di hub**

   Centang hub yang menjual merek ini. Tekan **Simpan**.

   ✓ Yang terlihat: merek ada di daftar, belum punya SKU.

#### 2.2.2 Di Hiryu: buat menu toko pertama

<!--screen:hiryu-menu-->

1. **Ops HQ · Hiryu → Menus → New menu**

   Beri nama menu sesuai toko, merek dan hub-nya: *Labore - Cawang*. Lalu **Add category** (*Cleanser*, *Moisturiser*).

   ✓ Yang terlihat: menu kosong dengan kategorinya.

2. **Ops HQ · menu tersebut → satu kategori → Add item**

   - **Item ID**: untuk produk satuan, pakai **kode SKU milik merek** (*LAB-GB-MC-100*). Kode ini menjadi kode SKU di §2.2.4, jadi pilih dengan teliti.
   - **Nama** dengan ukuran, **harga** dalam IDR, urutan, **deskripsi** (dilihat pembeli), paling banyak **4 foto**, persegi (1:1).
   - Tekan **Add to draft**.

   ✓ Yang terlihat: item ada di kategori, ditandai sebagai draf.

3. **Ops HQ · menu tersebut → Save menu**

   Tidak ada yang sampai ke Grab sebelum kamu menyimpan.

   ✓ Yang terlihat: menu tersimpan, belum ada toko yang memakainya.

Untuk banyak item sekaligus: **Export CSV**, isi filenya, lalu **Import CSV**. Import **mengganti seluruh menu**, jadi ekspor dulu untuk menyimpan salinan. CSV punya kolom **barcode**: isi kolom ini, maka WMS menghubungkan setiap produk satuan ke SKU-nya sendiri (§2.2.5).

#### 2.2.3 Di Hiryu: salin menu ke toko lain milik merek

Hiryu tidak punya tombol salin: menyalin berarti ekspor lalu impor.

1. **Ops HQ · Hiryu → Menus → menu pertama (*Labore - Cawang*) → Export CSV**

   ✓ Yang terlihat: file CSV tersimpan di laptop.

2. **Ops HQ · Hiryu → Menus → New menu**

   Beri nama sesuai toko yang lain (*Labore - Kemanggisan*), lalu **Import CSV** dengan file dari langkah 1. **Jangan ubah kolom ID**: ID item yang sama membuat kedua menu tetap sejajar dengan WMS.

   ✓ Yang terlihat: kategori dan item yang sama dengan menu pertama.

3. **Ops HQ · menu baru tersebut**

   Ubah hanya yang berbeda di hub ini (misalnya harga), lalu **Save menu**.

   ✓ Yang terlihat: menu tersimpan.

Setelah ini kedua menu **terpisah**: perubahan berikutnya dibuat di masing-masing menu (§2.3).

#### 2.2.4 Di Hiryu: buat SKU dan hubungkan setiap item

<!--screen:hiryu-skus-->

<!--screen:hiryu-bundles-->

1. **Ops HQ · Hiryu → Menus → menu pertama → Bundles → One SKU per item**

   Hiryu membuat satu SKU untuk setiap item satuan, dengan **kode item** itu.

   ✓ Yang terlihat: setiap item satuan punya SKU dan *Units per sale* 1.

2. **Layar yang sama · setiap paket dari produk yang sama (paket isi 2)**

   Pilih **SKU produk satuannya** dan atur *Units per sale* menjadi **2**. Kit dari pabrik yang punya barcode sendiri adalah SKU tersendiri.

3. **Ops HQ · Hiryu → Menus → menu salinan → Bundles**

   Untuk setiap item, pilih SKU dengan kode yang sama, dan *Units per sale* yang sama. **Jangan** tekan *One SKU per item* di sini: SKU-nya sudah ada.

   ✓ Yang terlihat: setiap item terhubung, sama seperti di menu pertama.

4. **Ops HQ · Hiryu → SKUs → filter *Not counted only***

   ✓ Yang terlihat: daftar kosong. Item yang dibiarkan *Not counted* tetap bisa dijual walaupun raknya kosong, jadi setiap produk kemasan harus dihubungkan.

#### 2.2.5 Di WMS: cek menu dan SKU yang dikirim Hiryu

<!--screen:hiryu-map-->

Tidak ada yang diunggah. Saat menu disimpan di Hiryu, **Hiryu mengirimnya sendiri ke WMS**, dengan SKU dan unit per penjualan setiap item dari *Bundles* (§0.6.1, pesan 6). WMS membuat **SKU WMS baru** untuk setiap SKU Hiryu yang belum pernah dilihatnya, beserta kode, nama, dan barcode-nya.

1. **Ops HQ · WMS → Menu Hiryu → pilih toko**

   ✓ Yang terlihat: item menu toko itu, masing-masing dengan SKU dan unit per penjualan, sama seperti di Hiryu. SKU baru bertanda *baru*.

2. **Ops HQ · layar yang sama · Belum terhubung di Hiryu**

   Item yang belum punya SKU di Hiryu (*Not counted*) tercantum di sini. Perbaiki **di Hiryu** (*Bundles*, §2.2.4); WMS ikut diperbarui saat Hiryu mengirim menunya lagi.

   ✓ Yang terlihat: daftar kosong. Pesanan dengan item yang belum terhubung ke SKU tidak bisa diambil.

3. **Ops HQ · Menu Hiryu → Toko Hiryu** · *setelah toko dibuat (§2.4.1)*

   Toko datang dari Hiryu beserta dark store dan mereknya. Cek satu per satu.

   ✓ Yang terlihat: keempat toko, masing-masing dengan hub dan mereknya.

#### 2.2.6 Di WMS: lengkapi angka stok setiap SKU

<!--screen:sku-complete-->

1. **Ops HQ · WMS → Produk → Lengkapi data SKU**

   Filter per merek. Setiap SKU yang dibuat oleh unggahan punya baris bertanda *belum lengkap*.

2. **Tabel yang sama · setiap baris**

   Isi kode SKU milik merek (jika ada), **ukuran bin** (WMS menyarankan satu), dan angka stok di bawah ini. Untuk banyak baris sekaligus: **Unduh CSV**, isi filenya, **Unggah CSV**, cek pratinjaunya, **Simpan**.

   ✓ Yang terlihat: baris bertanda *lengkap*. SKU yang lengkap muncul di daftar *Perlu rak* setiap hub, siap diberi bin (§3.3).

| Di layar | Artinya | Diisi dengan | Contoh |
|---|---|---|---|
| **Isi sampai** | Restock mengisi stok hub sampai angka ini | Unit | 15 |
| **Pesan ulang saat sisa** | Jika stok hub turun sampai angka ini, WMS membuat draf permintaan restock ke merek | Unit atau % dari *isi sampai* | 25% = 4 unit |
| **Batas kritis** | Pada angka ini atau di bawahnya, SKU ditandai merah: hampir habis | Unit atau % dari *isi sampai* | 1 unit |
| **Cadangan Grab** | Unit yang ditahan dari jumlah yang boleh dijual Grab, untuk jaga-jaga jika ada salah hitung (§9.5) | Unit atau % dari stok yang tersedia (dibulatkan ke atas) | 1 unit (bawaan) |
| **Isi maks. per bin** | Berapa unit yang muat di satu bin sebelum bin berikutnya dipakai. Boleh kosong: WMS mempelajarinya dari SPV (§4.2) | Unit | 12 |

*Isi sampai* dan ukuran bin wajib diisi. *Pesan ulang saat sisa* otomatis terisi 25% dan *Cadangan Grab* 1 unit, kecuali kamu mengubahnya.

### 2.3 Perubahan setelah go-live

Setiap perubahan dibuat **di Hiryu dulu, lalu di WMS, pada hari yang sama**, dan di **menu setiap toko** (dua per merek).

#### 2.3.1 Produk baru

1. **Ops HQ · Hiryu** · tambahkan item ke menu toko pertama lalu simpan (§2.2.2); tekan *One SKU per item* di Bundles menu itu (hanya menambah yang belum ada); tambahkan item ke menu toko lain milik merek itu dan pilih SKU yang sama di sana (§2.2.4).
2. **Ops HQ · WMS** · SKU baru datang dari Hiryu (§2.2.5). Lengkapi angka stoknya (§2.2.6).
3. **SPV · WMS** · beri SKU itu bin (§3.3).

#### 2.3.2 Perubahan harga

1. **Merek → Ops HQ** · merek meminta secara tertulis, dengan tanggal mulai berlakunya harga.
2. **Ops HQ · Hiryu → Menus → menu setiap toko → item tersebut** · ubah harganya, **Save menu**. Cek statusnya *Synced* (§2.4.5).
3. **WMS** · tidak ada yang perlu dikerjakan: Hiryu mengirim harga baru, dan setiap baris pesanan membawa harga hari itu untuk laporan merek (§15.1).

#### 2.3.3 Berhenti menjual produk

1. **Ops HQ · Hiryu → menu setiap toko → item tersebut** · ubah ke **UNAVAILABLE** (untuk seterusnya) atau **SOLD OUT** (untuk sementara), **Save menu**.
2. **Ops HQ · WMS → Produk → SKU tersebut** · ubah *Isi sampai* ke **0**, supaya tidak ada lagi permintaan restock.
3. **SPV** · stok yang masih ada di rak dikembalikan ke merek (§8).

#### 2.3.4 Kemasan berubah (misalnya produk satuan menjadi paket isi 2)

1. **Ops HQ · Hiryu → menu setiap toko → Bundles** · ubah *Units per sale* item itu.
2. **WMS** · tidak ada yang perlu dikerjakan: Hiryu mengirim perubahannya (§2.2.5).

#### 2.3.5 Jam toko dan hari libur nasional

1. **Ops HQ · Hiryu → Dark stores → hub tersebut → Hours** · ubah jam hari itu dan tekan **Save hours**. Semua toko di hub itu ikut berubah.
2. **Untuk satu toko saja** · *Stores → toko tersebut → Hours* mengatur jam toko itu sendiri (hanya setelah toko diaktifkan di Grab); **Follow hub hours** mengembalikannya.
3. **Libur nasional** · ubah jam hub pada hari kerja sebelumnya, lalu kembalikan setelah libur selesai. SPV memberi tahu Ops HQ paling lambat 3 hari sebelumnya.

#### 2.3.6 Menutup toko

1. **Ops HQ · Hiryu → Stores → toko tersebut → Overview → Deactivate** · Hiryu tidak lagi menganggap toko itu aktif. Pakai **Delete store** hanya jika toko tidak akan pernah kembali; riwayat pesanannya tetap ada di laporan.
2. **Ops HQ · Grab** · minta Grab (atau merek, untuk merchant miliknya) menutup toko Grab atau memutus hubungannya.
3. **Ops HQ · WMS → Menu Hiryu → Toko Hiryu** · hapus centang *Aktif* untuk toko itu.
4. **SPV** · stok merek di hub itu dikembalikan ke merek atau dipindah ke hub lain (§8).

#### 2.3.7 Menutup hub

1. **Tutup setiap toko** yang dilayani hub itu (§2.3.6), lalu kosongkan stok hub (§8).
2. **Ops HQ · Hiryu → Dark stores → hub tersebut → Delete dark store** · hub dihapus beserta jam bukanya. Hiryu menolak selama masih ada toko yang terhubung ke hub itu.
3. **Ops HQ · WMS → Dark store & pengguna → hub tersebut → Nonaktifkan** · hanya jika stoknya nol. Tutup akun stafnya (§1.3.2).

**Hubungan item disimpan di Hiryu.** SKU mana yang dijual setiap item menu, dan berapa unitnya, disimpan di *Bundles* Hiryu dan dikirim ke WMS di setiap perubahan (§0.6). WMS tidak pernah mengubahnya, jadi keduanya tidak mungkin berbeda.

### 2.4 Ops HQ: hubungkan setiap toko Grab ke Hiryu

**Satu toko Grab per merek per hub**: pilot ini punya **empat**, Kahf × MA5, Kahf × KJ5, Labore × MA5 dan Labore × KJ5. Setiap toko dihubungkan sendiri-sendiri, dan setiap toko punya **menunya sendiri** (§2.2). Kerjakan §2.4.1 sampai §2.4.5 **empat kali**, sekali per toko. Penghubungan dikerjakan oleh **Ops HQ atau superadmin** (§2.7).

**Sebelum mulai**, untuk setiap toko:
- toko Grab yang sudah dibuat oleh Grab, dengan alamat hub;
- **login manajer Grab milik outlet** untuk toko itu (dari Grab atau dari merek);
- menu toko sudah dibuat, dengan setiap item terhubung ke SKU (§2.2).

Stok sampai ke toko dari WMS setelah kiriman pertama (§9).

#### 2.4.1 Buat toko

1. **Ops HQ · Hiryu → Stores → New store**

   Beri nama persis seperti yang akan dibaca pelanggan, yaitu merek dan hub: *Labore - Cawang*. Atur penerimaannya ke **MANUAL** *(diputuskan 30 Sep)*: setiap pesanan menunggu staf menekan *Accept*.

   ✓ Yang terlihat: toko dengan status **INACTIVE**, tanpa koneksi ke Grab, tanpa hub dan tanpa menu.

#### 2.4.2 Beri hub

<!--screen:hiryu-store-hub-->

1. **Ops HQ · Hiryu → Stores → toko tersebut → Overview → Dark store → Assign a dark store**

   Pilih hub (*Cawang*) dan tekan **Assign**. Satu toko hanya milik satu hub: untuk memindahkannya, lepaskan dulu dari hub lama.

   ✓ Yang terlihat: nama hub di Overview. Sekarang toko mengikuti jam buka hub.

   Kerjakan ini **sebelum** aktivasi: pesanan untuk toko tanpa hub tidak akan muncul di papan Live Orders mana pun.

#### 2.4.3 Beri menu

<!--screen:hiryu-store-menu-->

1. **Ops HQ · Hiryu → Stores → toko tersebut → Overview → Menu**

   Pilih **menu milik toko itu sendiri** (*Labore - Cawang*) dan tekan **Assign**.

   ✓ Yang terlihat: *Menu assigned to this store*, dan nama menu di Overview. Hiryu mengirim toko dan menunya ke WMS (§2.2.5).

#### 2.4.4 Aktifkan di Grab

<!--screen:hiryu-store-activate-->

1. **Ops HQ (ADMIN Hiryu) · toko tersebut → Overview → Activate on Grab**

   Cek menu sudah dipilih. *Start activation* tetap abu-abu sampai menu punya paling sedikit satu item yang tersimpan, karena Grab menolak menu kosong. Tekan **Start activation**.

   ✓ Yang terlihat: sebuah link ke Grab.

2. **Layar yang sama · Open link**

   Halaman milik Grab akan terbuka:

<!--screen:grab-activate-->

3. **Ops HQ · halaman Grab · masuk dengan login manajer Grab milik outlet** (misalnya `labore.cawang.manager`).

4. **Halaman Grab · pilih toko yang akan dihubungkan**

   Cek alamatnya sama dengan alamat hub, lalu hubungkan.

5. **Halaman Grab · aktifkan integrasi**

   Grab memberi peringatan bahwa menu POS menjadi menu utama dan perubahan yang dibuat di aplikasi GrabMerchant akan dibatalkan. Itu memang seharusnya: mulai sekarang menu, harga, dan stok datang dari Hiryu.

6. **Ops HQ · Hiryu → toko tersebut** · muat ulang halaman.

   ✓ Yang terlihat: **ACTIVE**, dan **Grab merchant ID** sudah terisi.

#### 2.4.5 Cek menu sudah sampai di Grab

1. **Ops HQ · Hiryu → Menus → menu toko tersebut → Stores using this menu**

   ✓ Yang terlihat: toko bertanda **Synced**. *Syncing…* berarti tunggu. *Not sent* menunjukkan alasan dari Grab: perbaiki lalu tekan **Retry**. Jika muncul pesan bahwa sinkronisasi terlalu sering, tunggu sesuai jumlah menit yang disebutkan.

#### 2.4.6 Pesanan uji, lalu buka

Kerjakan ini setelah kiriman pertama sudah di rak dan stoknya sudah sampai di Hiryu (§9.3).

1. **Ops HQ · aplikasi Grab** · buat satu pesanan uji di setiap toko.
2. **Staf · Hiryu, lalu WMS** · jalankan dari awal sampai akhir: *Accept* di Hiryu, ambil, kemas, serah terima (§6, §7).
3. **Ops HQ** · batalkan atau selesaikan pesanan itu sesuai kesepakatan dengan Grab, lalu beri tahu SPV bahwa toko sudah buka.

**Ada error di Hiryu** (aktivasi, sinkronisasi menu, pesanan tidak masuk): hubungi **Shaun Cong**, pemilik Hiryu, dengan screenshot, nama toko, dan jam kejadiannya.

### 2.5 Lokasi

- **2.5.1** Versi pertama **hanya untuk dark store**. Tipe lokasi gudang pusat, transfer, dan pengiriman tote tetap ada di kode tapi disembunyikan (§19).
- **2.5.2** **Bin inbound sementara dan baki karantina** *(direvisi 28 Sep)*. **Baki karantina** (`HUB-KARANTINA`) dibuat otomatis saat Ops HQ mendaftarkan dark store dan tidak bisa dimatikan: baki ini satu-satunya tempat untuk unit yang tidak boleh dijual (rusak, bocor, kedaluwarsa, meragukan), jadi unit itu tidak pernah berada di bin yang bisa dijangkau picker. **SPV** mengatur **bin inbound sementara** (§3.1): berapa banyak dan ukurannya. WMS memberi setiap bin lokasi dan labelnya sendiri, mulai dari `HUB-IN-01`, satu SKU per bin, dipakai saat kiriman dihitung; WMS menentukan bin mana yang dipakai untuk tiap SKU. Keduanya tidak pernah menyimpan stok yang bisa dijual. Jumlah bin sementara bisa diubah kapan saja; kiriman dengan SKU lebih banyak dari jumlah bin sementara diterima bertahap (§5.3.2).

### 2.6 Mendaftarkan SKU **[diperbarui 30 Sep]**

Setiap SKU WMS dibuat **sekali untuk semua hub**, **dari Hiryu** *(diputuskan 30 Sep)*: Hiryu mengirim SKU-nya dan menu setiap toko ke WMS (§2.2.5), lalu WMS membuat SKU untuk setiap SKU Hiryu yang belum pernah dilihatnya. Setelah itu Ops HQ melengkapi sisanya di *Lengkapi data SKU* (§2.2.6). Data SKU yang sudah ada di Hiryu tidak pernah diketik lagi di WMS.

| Kolom | Berasal dari | Wajib | Catatan |
|---|---|---|---|
| Nama dan ukuran | SKU Hiryu | Ya | Diperbarui setiap kali Hiryu mengubahnya |
| **Kode SKU di Hiryu** | Kode SKU Hiryu | Ya | Tidak pernah berubah. Kunci antara kedua sistem (§0.6.2). Dicocokkan tanpa melihat huruf besar atau kecil |
| **Barcode** | Hiryu, atau di-scan saat unit pertama kali tiba | Jika kemasan punya | Satu barcode hanya untuk satu SKU, selamanya. Satu SKU boleh punya beberapa. Dicetak di PO supaya merek bisa mengeceknya (§4.1) |
| Item menu Hiryu, unit per penjualan, harga | Hiryu, per toko | Ditampilkan | Setiap item yang menjual SKU ini, di menu setiap toko |
| Merek, kode SKU merek, kategori | Merek, atau master SKU (Lampiran B) | Merek ya, sisanya opsional | |
| Kemasan L × W × H mm, berat g | Merek | Opsional | Menentukan ukuran bin dan kemasan pengiriman (§6.10) |
| Cairan dalam botol; botol besar (150 ml atau lebih) | Merek | Opsional | Menentukan aturan karton (§6.10) |
| **Ukuran bin** | Ops HQ, disarankan dari ukuran kemasan atau kategori | Ya | |
| **Isi maks. per bin** | Ops HQ, atau dipelajari (§4.6) | Opsional | |
| *Isi sampai* | Ops HQ | Ya | Unit (§4.5) |
| *Pesan ulang saat sisa*, *Batas kritis* | Ops HQ | Terisi otomatis | Unit atau persentase dari *Isi sampai* (§4.5) |
| *Cadangan Grab* (buffer Grab) | Ops HQ | Terisi otomatis | Unit atau persentase dari stok yang tersedia. **Default 1 unit** (§9.5) |
| Foto | Ops HQ | Opsional | 1:1, minimal 800 × 800, latar putih |

- **2.6.1** **Massal**: *Lengkapi data SKU* bisa diunduh dan diunggah sebagai CSV, dengan pratinjau sebelum ada yang disimpan. Lembar master SKU (Lampiran B) dimuat ke sana dengan cara yang sama.
- **2.6.2** SKU **lengkap** jika ukuran bin dan *isi sampai*-nya sudah diisi. Hanya SKU lengkap yang muncul di daftar *Perlu rak* setiap hub, **beserta ukuran bin-nya**. SPV memilih bin kosong dengan ukuran itu; WMS menyarankan ketinggian paling nyaman lebih dulu (level 3, lalu 2, 4, 1, 5).
- **2.6.3** SKU yang belum punya bin di suatu hub bisa diterima di sana (staf diberi bin saat inbound), tapi belum bisa diambil untuk pesanan.
- **2.6.4** Item paket (unit per penjualan lebih dari 1) tidak pernah membuat SKU: Hiryu mengirimnya sudah terhubung ke SKU produk satuannya.

### 2.7 Merek **[DIPUTUSKAN 28 dan 30 Sep]**

Merek baru ditambahkan oleh **Ops HQ, Ops Head atau superadmin** (§2.2.1), sebelum SKU-nya ada: nama, kode singkat, perusahaan, model listing (§2.11), kontak restock merek, hub mana saja yang menjualnya, dan apakah kemasannya punya barcode. SPV tidak bisa menambahkan merek. **Menghubungkan toko Grab milik merek ke Hiryu** (§2.4) juga dikerjakan oleh Ops HQ atau superadmin *(30 Sep)*.

### 2.8 Barcode

- **2.8.1** Barcode datang dari CSV menu (§2.2.5), dimasukkan di *Lengkapi data SKU*, atau diikat saat unit pertama kali tiba: staf mencari di daftar produk, memilih produk yang sedang dipegang, **scan barcode sekali lagi untuk konfirmasi**, dan barcode terikat permanen. Scan kedua mencegah nomor yang salah terbaca ikut terikat.
- **2.8.2** Produk tak dikenal saat inbound dikirim ke Ops HQ dengan foto dan jumlahnya (§5); produk itu belum menjadi stok sampai HQ menjawab.
- **2.8.3** Label unit milik Ninja (untuk merek tanpa barcode) tetap ada tapi disembunyikan. Kahf dan Labore sudah punya barcode.
- **2.8.4** **Barcode tak dikenal sering kali hanya salah scan** *(30 Sep)*. Sebelum ada yang dikirim ke Ops HQ, station meminta staf untuk: (1) scan lagi, pegang kemasan tetap datar dan tidak bergerak; (2) jika masih gagal, ketik angka yang tercetak di bawah barcode. Jika nomornya milik **SKU lain**, berarti barangnya memang produk itu: jika bukan yang diharapkan, layar barang salah menampilkan keduanya. Hanya nomor yang **tidak ada di SKU mana pun** yang dianggap tak dikenal dan dikirim ke Ops HQ.

### 2.9 Data kemasan

WMS meminta ukuran dan berat kemasan ke merek, tapi harus tetap berjalan tanpa data itu. Data yang kurang tidak pernah menghalangi kiriman atau pengambilan: nilai default kategori dipakai dan layar menampilkan *perkiraan* (estimasi).

### 2.10 Foto

Ops HQ mengunggah foto produk; untuk produk yang hampir sama, foto inilah yang dicek picker.

### 2.11 Pemilik stok dan model listing **[DIPUTUSKAN 25 Sep]**

- **2.11.1** **Semua stok milik merek.** Dalam operasi ini, Ninja tidak memiliki stok dan Grab juga tidak. Setiap pergerakan dan saldo mencatat merek sebagai pemilik.
- **2.11.2** Yang berbeda antar merek adalah **siapa yang mendaftarkan toko di Grab**, sebuah pengaturan per merek:

| Model listing | Siapa merchant di Grab | Contoh |
|---|---|---|
| `grab_3pl` | Grab membawa merek dan meminta Ninja menjadi 3PL-nya | **Kahf, Labore** (pilot) |
| `ninja_merchant` | Ninja mencari merek dan mendaftarkan merchant miliknya sendiri di Grab | Malaysia saat ini |

- **2.11.3** Model listing tidak mengubah cara kerja di lantai gudang. Model ini menentukan siapa yang menerima laporan dan lewat siapa permintaan restock dikirim.
- **2.11.4** Nilai pemilik lama *grab* dan *ninja* dihapus lewat migrasi.

### 2.12 Peta yang disimpan di Hiryu dan dikirim ke WMS

| Peta | Isi | Diisi oleh |
|---|---|---|
| Item Hiryu | ID item Hiryu → SKU dan unit per penjualan, **untuk menu setiap toko** | *Bundles* Hiryu, dikirim bersama katalog (§0.6.1, pesan 6) |
| Toko Hiryu | ID toko → hub, merek dan menunya | Hiryu, dikirim bersama katalog; dicek oleh Ops HQ (§2.2.5) |
| Kode SKU Hiryu | Di setiap SKU WMS (§2.6) | Hiryu. Dicocokkan tanpa melihat huruf besar atau kecil, karena Hiryu mengubah kode menjadi huruf besar |
| Harga item | ID item dan toko → harga | Hiryu, dan di setiap baris pesanan (§0.6.1, pesan 1); hanya dipakai untuk laporan merek (§15.1) |

### 2.13 Hal terbuka

- **Bundel.** 41 bundel marketplace disisihkan saat cek ulang. Apakah ada yang dijual di Grab sebagai paket **ditanyakan nanti**, per merek.
- **Menyalin menu** (§2.2.3). Cek pada salinan pertama apakah *Import CSV* ke menu baru tetap menyimpan ID item, dan apakah item salinan tetap terhubung ke SKU-nya atau harus dipilih lagi di *Bundles*.
- **Toko diaktifkan sebelum punya stok** (§0.4 langkah 12). Cek pada toko pertama apa yang dilihat pelanggan di Grab: semua item habis, atau toko tutup.
- **Pesan katalog** (§0.6.4 hal 3): bagaimana dan kapan Hiryu mengirim menu dan SKU.

## 3. Pengaturan rak

**Siapa**: SPV, Ops HQ · **Sistem**: WMS · **Di dev**: rak dan bin dengan satu bay. Gambar rak, bay dan bin inbound sementara: belum

### 3.1 Bin inbound sementara dan baki karantina

<!--screen:inbound-area-->

> **Istilah · Bin inbound sementara (temporary inbound bin)**
> **Apa itu:** bin tempat kiriman dihitung sebelum masuk ke rak, satu SKU per bin. Unit di dalamnya **belum menjadi stok**: tidak ada yang mengambil dari bin ini.
>
> **Berapa banyak:** SPV yang menentukan, biasanya 10 (satu per SKU dalam kiriman biasa). Kiriman dengan SKU lebih banyak cukup dihitung bertahap per batch (§5.1).
>
> **Yang dikerjakan secara fisik:** pakai bin biasa, taruh di rak atau palet **di sebelah meja penerimaan**, masing-masing dengan label cetaknya (`MA5-IN-01`, `MA5-IN-02` …).

> **Istilah · Label**
> Stiker yang dicetak WMS di **kertas stiker A4** dengan printer stasiun. Setiap label menampilkan kode lokasi dengan huruf besar dan barcode untuk di-scan. Lembarnya punya **garis potong**: gunting mengikuti garis itu, lalu tempel setiap label di **sisi depan bin-nya**, sepanjang tepi atas, di tempat yang bisa dijangkau scanner.

1. **SPV · WMS → Rak & bin → Area barang masuk**

   Isi berapa banyak bin inbound sementara yang dimiliki hub dan ukurannya. Tekan **Simpan**.

   ✓ Yang terlihat: kode `MA5-IN-01` sampai `MA5-IN-10`, dan baki karantina `MA5-KARANTINA` (dibuat bersama hub, §2.1.2).

2. **SPV · layar yang sama → Cetak label**

   Lembar label A4 terbuka. Cetak di printer stasiun, di kertas stiker A4.

   ✓ Yang terlihat: satu label per bin sementara dan satu untuk baki karantina, dengan garis potong.

3. **SPV atau staf · di meja penerimaan**

   Gunting mengikuti garis. Tempel setiap label `MA5-IN-…` di sisi depan bin-nya, dan label `MA5-KARANTINA` di baki (bin besar atau krat bertutup). Taruh bin sementara di sebelah meja penerimaan, dan baki **jauh dari rak picking**, dekat meja SPV.

4. **SPV · HP hub → WMS → Rak & bin → Cek label**

   Scan setiap label satu kali.

   ✓ Yang terlihat: WMS menyebut nama setiap label. Label yang tidak bisa di-scan dicetak ulang.

Jumlah bin sementara bisa diubah nanti: tambah bin, lalu cetak label yang baru saja.

### 3.2 Buat rak

SPV mendaftarkan setiap rak **sesuai bentuk fisiknya**. Tidak ada tipe rak yang perlu dipilih: ukuran rak mengikuti rak yang ada di hub, jadi SPV menghitung berapa yang muat lalu mengisi angka itu.

> **Istilah · Rak, bagian (bay), tingkat (level), posisi, tumpukan**
> **Rak** adalah satu unit rak, dinamai dengan huruf (A, B, C). **Bay** (bagian) adalah bagian di antara dua tiang. **Level** (tingkat) adalah satu papan rak, dihitung **dari bawah** (level 1 paling bawah). **Posisi** adalah tempat untuk satu bin di satu level, dihitung **dari kiri**. **Tumpukan** adalah bin yang ditumpuk di satu posisi: B (bawah), M (tengah), T (atas).

> **Istilah · Kode bin**
> Setiap bin punya kode: `MA5-A1-3-05T` artinya hub MA5, rak **A**, bay **1**, level **3**, posisi **05**, bin **atas**. Kode ini ada di label bin; WMS mengarahkan picker dengan kode ini.

<!--screen:rack-builder-->

1. **SPV · di rak**

   Berdirikan rak di tempat tetapnya. Hitung bay dan level-nya. Di setiap level, jajarkan bin kosong **berdampingan dari kiri**, satu ukuran bin per level: **kecil (JX-2)** atau **besar (JX-4)**. Tumpuk hanya jika masih muat di bawah level di atasnya. Hitung berapa bin yang muat ke samping dan berapa ke atas.

   ✓ Hasilnya: untuk setiap level, satu ukuran bin, jumlah ke samping, dan jumlah ke atas.

2. **SPV · WMS → Rak & bin → Tambah rak**

   WMS memberi huruf berikutnya yang masih kosong (A, B …). Isi jumlah **bay** dan **level**.

   ✓ Yang terlihat: gambar rak dari depan, dengan level yang masih kosong.

3. **SPV · gambar → ketuk satu level**

   Pilih **ukuran bin**, lalu **jumlah bin ke samping** dan **tumpukan** sesuai hitunganmu. WMS menolak tumpukan yang lebih tinggi dari batas tipe bin (3 untuk kecil, 2 untuk besar).

   ✓ Yang terlihat: bin tergambar di level itu, masing-masing dengan kodenya.

4. **Ulangi langkah 3 untuk setiap level dan bay**, lalu tekan **Simpan**.

   ✓ Yang terlihat: rak muncul di daftar *Rak & bin* dengan jumlah bin-nya.

5. **SPV · rak → Cetak label**

<!--screen:label-sheet-->

   Lembar label A4 terbuka, sesuai urutan rak: bay demi bay, level 1 dulu, dari kiri ke kanan, bin bawah sebelum bin atas. Cetak di kertas stiker A4.

6. **Staf · di rak**

   Gunting mengikuti garis. Tempel setiap label di **sisi depan bin-nya**, cocokkan kode dengan letak bin: level 1 di bawah, posisi dari kiri, B di bawah T. Kerjakan satu level sekali jalan supaya tidak ada label yang tertempel di bin yang salah.

7. **SPV · HP hub → WMS → Rak & bin → Cek label**

   Scan tiga label secara acak.

   ✓ Yang terlihat: setiap scan menyebut rak, level, dan posisi yang sama dengan letak bin sebenarnya.

Lakukan ini untuk setiap rak. Rak bisa diperluas nanti: tambah bay, level, atau bin, lalu cetak label yang baru saja (§3.4.5).

### 3.3 Beri setiap SKU satu bin

SKU harus punya bin di suatu hub sebelum bisa diambil di sana. Ops HQ melengkapi data SKU lebih dulu (§2.2.6); setelah itu SKU muncul di **Perlu rak**.

1. **SPV · WMS → Rak & bin → Perlu rak**

   ✓ Yang terlihat: setiap SKU yang belum punya bin di hub kamu, dengan ukuran bin-nya.

2. **SPV · satu SKU → Pilih bin**

   WMS menyarankan bin kosong dengan ukuran yang tepat, ketinggian paling nyaman lebih dulu (level 3, lalu 2, 4, 1, 5). **Kumpulkan SKU satu merek berdekatan**, dan taruh **barang laris di level 2 sampai 4 paling dekat meja kemas** *(diputuskan 30 Sep)*. Terima saran itu atau ketuk bin kosong lain, lalu **Simpan**.

   ✓ Yang terlihat: bin dengan nama SKU di gambar rak, dan SKU sudah hilang dari *Perlu rak*.

Tidak ada label yang diganti: label menyebut bin-nya, dan WMS tahu SKU mana yang ada di dalamnya.

#### 3.3.1 Pindahkan SKU ke bin lain

**Kapan dilakukan** (SPV yang memutuskan):
- bin rusak atau rak sedang ditata ulang;
- SKU sekarang jauh lebih laris (pindahkan ke level 2 sampai 4 dekat meja kemas) atau jauh lebih lambat laku (pindahkan lebih tinggi atau lebih rendah). Tinjau sebulan sekali dengan data penjualan 4 minggu terakhir;
- SKU satu merek sudah tersebar dan perlu dikumpulkan lagi;
- SKU butuh ukuran bin yang lebih besar.

Bukan untuk bin yang **penuh**: itu urusan pertanyaan bin kedua (§4.2). Pindahkan stok saat **sepi**, tanpa pesanan yang menunggu.

1. **SPV · WMS → Rak & bin → SKU-nya → Pindah bin**

   Pilih bin baru yang kosong lalu tekan **Simpan**.

   ✓ Yang terlihat: tugas *Pindahkan stok* untuk staf. Picker tetap diarahkan ke bin lama sampai pemindahannya di-scan.

2. **Staf · stasiun → Tugas → Pindahkan stok**

   Scan **bin lama**, scan **setiap unit** saat kamu mengeluarkannya, lalu scan **bin baru** dan masukkan unitnya, stok yang lebih lama di depan.

   ✓ Yang terlihat: bin lama kosong dan bebas, stok ada di bin baru.

3. **SPV · di rak**

   Pastikan bin lama benar-benar kosong.

### 3.4 Tata letak bisa diatur **[DIPUTUSKAN 25 dan 30 Sep]**

Tata letak hub adalah **rak → bay → level → posisi → tumpukan**, diisi **sesuai bentuk fisik rak** *(30 Sep)*.

| Bagian | Diatur oleh | Aturan |
|---|---|---|
| **Rak** | SPV (atau Ops HQ) | Satu huruf per hub; tanpa tipe rak |
| **Bay** | SPV | Bagian di antara tiang, sebanyak yang dimiliki rak |
| **Level** | SPV, per bay | Dihitung dari bawah; **satu ukuran bin** per level |
| **Posisi** | SPV, dihitung | Berapa bin yang benar-benar muat berdampingan di level itu |
| **Tumpukan** | SPV, dihitung | Berapa bin yang ditumpuk; tidak pernah lebih dari batas tumpuk tipe bin |

- **3.4.1** **Kode lokasi** `HUB-RACK BAY-LEVEL-POSITION[STACK]`, contoh `MA5-A1-3-05T`. Huruf tumpukan: tanpa huruf untuk satu bin; B dan T untuk dua; B, M dan T untuk tiga. Rak lama dengan satu bay menjadi bay 1 saat dimigrasi; belum ada label bin yang dicetak, jadi tidak ada yang perlu dicetak ulang.
- **3.4.2** **Tipe bin** adalah daftar yang dikelola Ops HQ: kode, nama, ukuran luar dan dalam (W × D × H mm), batas tumpuk. Nilai awal:

| Bin | Ukuran luar W × D × H mm | Batas tumpuk | Kegunaan |
|---|---|---|---|
| Kecil, Lion Star Jolly Box No.200 (JX-2) | 135 × 225 × 120 | 3 | Tube, botol kecil, bedak padat |
| Besar, Lion Star Jolly Box No.400 (JX-4) | 198 × 356 × 170 | 2 | Botol 150 ml ke atas, kit |

- **3.4.3** Ukuran dalam bin tidak dipublikasikan: ukur sampel pertama lalu koreksi daftarnya.
- **3.4.4** **Bin yang ditumpuk diambil dari depan** (kedua tipe terbuka di bagian depan). WMS menggambar tumpukan sebagai satu kolom, bin atas di posisi atas.
- **3.4.5** Rak bisa diperluas: tambah rak, bay, level, atau posisi. Bin, level, atau bay hanya bisa dihapus jika **belum pernah menyimpan stok**.
- **3.4.6** **Satu bin untuk satu SKU.** Sekat di dalam bin memisahkan kiriman (§5.4), tidak pernah memisahkan SKU.
- **3.4.7** **Pembuat rak berupa gambar lebih dulu** *(diputuskan 25 Sep)*: tampak depan, level dipilih dengan mengetuknya, lalu ukuran bin, jumlah bin ke samping, dan tumpukan masing-masing dipilih dengan satu ketukan. Tabel dengan angka yang sama tersedia untuk Ops HQ, di bawah gambar.
- **3.4.8** **Label** *(30 Sep)*: setiap bin, bin sementara, dan baki karantina mendapat label yang dicetak dari WMS di kertas stiker A4, dengan garis potong, sesuai urutan letak bin. *Cek label* men-scan satu label dan menyebut lokasinya, untuk memastikan label tertempel di bin yang benar.

### 3.5 Peta hub (Ops HQ)

Semua hub dalam satu tabel: bin terpakai dan kosong, SKU tanpa bin, unit yang disimpan, SKU yang menipis, habis, atau belum punya angka pesan ulang, kiriman dalam perjalanan, selisih yang masih terbuka, masalah yang masih terbuka. Klik satu hub untuk membuka peta tata letaknya, satu kotak per bin, diwarnai berdasarkan stok atau ketersediaan.

### 3.6 Hal terbuka

- **Kertas label.** Kertas stiker A4 mana yang dibeli, dan berapa label per lembar. *Usulan:* kertas stiker A4 polos, 3 × 8 label per lembar, digunting manual mengikuti garis yang tercetak.

## 4. Restock dan batas stok

**Siapa**: SPV dan Ops HQ memantau; hanya Ops HQ yang mengirim PO · **Sistem**: WMS, lalu email ke merek · **Di dev**: permintaan restock, persetujuan selisih, pengingat. *Ajukan ke Ops HQ*, *Buat PO* dengan Excel, ED dari Faktur: belum

### 4.1 Restock dari merek: PO

**Siapa:** Ops HQ dan SPV sama-sama memantau kebutuhan restock. **Hanya Ops HQ yang mengirim PO ke merek** *(diputuskan 30 Sep)*; SPV mengajukan kebutuhan ke Ops HQ.

> **Istilah · PO (purchase order)**
> Permintaan Ninja agar merek mengirim barang ke satu hub, dengan referensi `RPL-MA5-2610-02`. WMS membuatnya sebagai **file Excel** berisi **barcode** setiap SKU, supaya merek bisa memeriksa setiap produk sebelum mengemas. Ops HQ mengirimnya lewat email.

> **Istilah · AWB, Surat Jalan dan Faktur**
> **AWB** (air waybill) adalah nomor lacak kurir untuk satu kiriman. **Surat Jalan** adalah nota kiriman yang dibawa driver. **Faktur** adalah tagihan dari merek yang datang bersama barang: isinya daftar barang yang dikirim, dan kadang tanggal kedaluwarsa setiap SKU. Hub menandatangani Surat Jalan dan Faktur saat menerima barang.

<!--screen:restock-po-->

1. **SPV atau Ops HQ · WMS → Perlu tindakan (atau Pengingat)**

   **Draf restock** muncul saat stok SKU turun ke angka *pesan ulang saat sisa*: satu draf per merek per hub, setiap SKU diisi sampai *isi sampai*.

   ✓ Yang terlihat: draf dengan jumlah per SKU.

2. **SPV · Restock ke merek → draf → Ajukan ke Ops HQ**

   Periksa jumlahnya, ubah yang perlu, tambahkan SKU secara manual jika perlu, lalu tekan **Ajukan ke Ops HQ**. SPV tidak bisa mengirim apa pun ke merek.

   ✓ Yang terlihat: draf bertanda *Diajukan*. Draf muncul di *Perlu tindakan* milik Ops HQ.

3. **Ops HQ · Restock ke merek → permintaan → Buat PO**

   Periksa jumlahnya dan sesuaikan jika perlu. Untuk kiriman paling pertama ke suatu hub, Ops HQ mulai di sini dengan **Buat permintaan**, dan WMS mengisi setiap SKU sampai *isi sampai*.

   Lalu periksa **header PO**. WMS mengisi setiap kolom dan Ops HQ bisa mengubah yang mana pun: **PO number**, **PO date**, **To (brand)**, **Brand contact**, **Deliver to**, **Requested delivery date** dan **Created by (Ops HQ)**. Tekan **Simpan PO**.

   ✓ Yang terlihat: nomor PO (`RPL-MA5-2610-02`). Jumlahnya sekarang terkunci.

4. **Ops HQ · layar yang sama → Unduh PO (Excel)**

   ✓ Yang terlihat: file Excel berbahasa Inggris dengan header di atas dan, per SKU, kode merek, kode Hiryu, **barcode** (angka dan barcode tercetak), nama, ukuran, stok saat ini, *isi sampai* dan jumlah yang diminta. SKU yang barcode-nya tidak ada di WMS bertuliskan **MISSING**: merek mengisinya di kolom kuning.

5. **Ops HQ · email ke kontak restock merek**

   Lampirkan Excel-nya lalu kirim. Minta merek mencantumkan **tanggal kedaluwarsa setiap SKU di Faktur** dan menulis nomor PO di Faktur dan Surat Jalan. Setelah itu tekan **Tandai terkirim**.

   ✓ Yang terlihat: PO bertanda *Terkirim*.

6. **Ops HQ · saat merek membalas dengan info pengiriman · Catat pengiriman**

<!--screen:restock-awb-->

   Isi **nomor AWB**, **nomor Surat Jalan**, perkiraan tanggal tiba, dan **jumlah setiap SKU yang benar-benar dikirim merek** (bisa lebih sedikit dari yang kamu minta). Tekan **Simpan pengiriman**.

   ✓ Yang terlihat: PO bertanda *Dikonfirmasi*. Sekarang staf bisa menerima kiriman itu dengan AWB tersebut (§5.1). Kamu bisa memperbaiki data ini sampai barangnya datang.

7. **Ops HQ · setelah kiriman diterima, begitu SPV mengunggah Faktur yang sudah ditandatangani (§5.1) · PO → ED dari Faktur**

   Jika Faktur mencantumkan tanggal kedaluwarsa, ketik tanggal setiap SKU (bulan dan tahun). Jika tidak, biarkan kosong: WMS menghitung umur stok itu dari hari barangnya tiba (§5.5).

   ✓ Yang terlihat: tanggal pada batch kiriman itu, atau *umur dari tanggal masuk*.

Jika barang datang sebelum AWB dicatat, staf menjalankan §5.2 dan Ops HQ menghubungkan AWB-nya di sana.

### 4.2 Pertanyaan bin kedua

<!--screen:second-bin-->

Setiap kali satu SKU mendapat bin kedua di hub, baik karena staf menekan *Bin penuh* atau karena kamu menambahkannya di *Rak & bin*, WMS menanyakan alasannya. Jawabannya mengajari WMS berapa unit yang muat dalam satu bin (*isi maks. per bin*).

1. **SPV · WMS → Pengingat → Pertanyaan bin kedua**

   ✓ Yang terlihat: SKU-nya, bin pertamanya, dan berapa unit yang ada di dalamnya sekarang.

2. **SPV · pilih alasannya**

   **Bin pertama penuh** adalah alasan yang penting. Alasan lain (kiriman promo, bin dipindah, batalkan) tidak mengubah apa pun.

3. **SPV · jika *Bin pertama penuh*: Setuju**

   WMS mengusulkan jumlah yang sekarang ada di bin pertama sebagai **isi maks. per bin** untuk SKU itu di ukuran bin itu.

   ✓ Yang terlihat: angka tersimpan untuk hub ini, dan untuk semua hub lain yang belum punya angka. Ops HQ bisa mengubahnya.

### 4.3 Satu rute di versi pertama **[DIPUTUSKAN 25 Sep]**

**Merek → dark store**, langsung. Rute supplier ke gudang pusat ke dark store, dan crossdock, masuk versi berikutnya (§19).

### 4.4 Aturan restock **[diperbarui 30 Sep]**

Stok ini konsinyasi: merek memilikinya sampai terjual. Ninja membuat PO dan memberikan formulir konsinyasi ke merek.

| Langkah | Siapa | Yang terjadi |
|---|---|---|
| **Peringatan** | WMS | Stok SKU di suatu hub turun ke angka *pesan ulang saat sisa* (semua bin-nya digabung). SKU muncul di *Needs restock* dengan jumlah saran sampai *isi sampai* |
| **Draf** | WMS | Satu draf per hub dan merek, dibuat otomatis |
| **Diajukan** | SPV | SPV memeriksa draf dan mengajukannya ke Ops HQ. SPV tidak pernah mengirim ke merek *(diputuskan 30 Sep)* |
| **PO** | Hanya Ops HQ | Ops HQ membuat PO, mengunduhnya sebagai Excel berisi barcode, lalu mengirimnya ke merek lewat email. Jumlahnya dikunci |
| **Dikonfirmasi** | Ops HQ | Mencatat AWB dari merek, nomor Surat Jalan, tanggal tiba, dan jumlah yang benar-benar akan dikirim merek |
| **Diterima** | Staf, lalu SPV | Diterima per AWB (§5). SPV mengunggah Faktur yang sudah ditandatangani |
| **Kedaluwarsa** | Ops HQ | Mengetik tanggal kedaluwarsa dari Faktur, jika Faktur mencantumkannya |
| **Selisih** | SPV, lalu Ops HQ, lalu Ops Head | Unit kurang atau rusak: SPV memasukkan hitungan akhir dan alasannya; Ops HQ menyetujui; Ops Head menyetujui paling akhir. Angka yang disetujui yang ditagih |
| **Unit lebih** | SPV, lalu Ops HQ | Unit yang dikirim merek melebihi PO: SPV mengajukannya ke Ops HQ, lalu Ops HQ menyelesaikan Faktur dengan merek lewat email, sebagai tindak lanjut PO |

- **4.4.1** Referensi `RPL-<hub>-<yymm>-<n>`. Satu AWB hanya milik satu PO yang masih terbuka.
- **4.4.1a** **Mencatat pengiriman** *(28 dan 30 Sep)*: di PO, **Catat pengiriman** mencatat AWB, nomor Surat Jalan, perkiraan tanggal tiba, dan jumlah per SKU yang benar-benar dikirim merek (§4.1). Ops HQ bisa mengoreksinya sampai barang tiba.
- **4.4.2** **Kiriman yang AWB-nya tidak tercatat** *(diputuskan 25 Sep)* tidak ditolak. Staf memasukkan AWB dari Surat Jalan, foto Surat Jalan, merek, dan jumlah karton; Ops HQ langsung mendapat tanda. Staf menghitung unit ke bin sementara selama driver masih ada; unit ini belum menjadi stok. Ops HQ lalu menautkan AWB ke PO yang terbuka, mencatatnya sebagai kiriman tidak terencana dari Surat Jalan, atau menolaknya (barang kembali ke merek). Baru setelah itu unit bisa disimpan ke rak (§5.2).
- **4.4.3** Langkah SPV, Ops HQ, dan Ops Head pada selisih harus dilakukan tiga orang berbeda *(diputuskan 28 Sep)*.
- **4.4.4** Masih perlu disepakati dengan merek (melalui Grab): safety stock, seberapa sering restock, retur barang kedaluwarsa dan barang lambat laku, serta biaya restock yang terpisah dari biaya fulfilment 5%. Semua ini akan menjadi pengaturan (§4.8), tanpa perlu membangun ulang.
- **4.4.5** **Excel PO** *(diputuskan 30 Sep)*: dibuat oleh WMS di *Restock ke merek*, dalam bahasa Inggris. Header: PO number, PO date, to (brand), brand contact, deliver to (hub dan alamat), requested delivery date beserta jam terima barang, created by (Ops HQ); WMS mengisi setiap kolom dan **Ops HQ bisa mengubah semuanya** di *Buat PO* sebelum mengunduh. Di bawah header ada permintaan ke merek: barcode di setiap unit, ED di Faktur, nomor PO di Faktur dan Surat Jalan. Satu baris per SKU: kode SKU merek, kode SKU Hiryu, **barcode sebagai angka dan sebagai EAN-13 tercetak**, nama, ukuran, stok saat ini, *isi sampai*, jumlah yang diminta (= *isi sampai* − stok, bisa diubah sebelum *Buat PO*), kolom kuning untuk merek menulis barcode yang benar jika berbeda atau tidak ada, dan kolom catatan. Tata letak: `docs/templates/PO Restock - Kahf - MA5.xlsx`.
- **4.4.6** **Unit lebih** *(diputuskan 30 Sep)*: unit di atas PO diterima ke stok seperti unit lainnya (unit itu ada di hub dan milik merek), ditandai *lebih*, lalu diajukan SPV ke Ops HQ. Ops HQ mengirim email ke merek sebagai tindak lanjut PO untuk menyelesaikan Faktur, lalu menutup tanda itu dengan hasilnya.

### 4.5 Angka per SKU per hub **[diganti nama 25 Sep]**

Layar memakai nama bahasa Indonesia yang sederhana, dengan contoh satu baris di bawah setiap kolom (§2.2.6). Huruf R, P dan S hanya dipakai di kode dan database.

| Di layar | Bahasa Inggris | Kode | Diukur pada | Diisi dalam | Fungsinya |
|---|---|---|---|---|---|
| **Isi maks. per bin** | Bin max | `full` | Satu bin | Unit | Stok baru pindah ke bin berikutnya |
| **Pesan ulang saat sisa** | Reorder at | `R` | Semua bin SKU itu | Unit atau % dari *isi sampai* | Membuat draf permintaan restock ke merek |
| **Isi sampai** | Fill up to | `P` | Semua bin SKU itu | Unit | Batas yang diisi oleh restock |
| **Batas kritis** | Critical level | `S` | Semua bin SKU itu | Unit atau % dari *isi sampai* | Tanda merah: hampir habis. Harus sama dengan *pesan ulang* atau lebih rendah |
| **Cadangan Grab** | Grab buffer | `buffer` | Per SKU | Unit atau % dari stok tersedia | Unit yang ditahan dari Grab (§9.5) |

- **4.5.1** WMS menolak pengaturan yang tidak mungkin berjalan (pesan ulang di bawah nol, batas kritis di atas pesan ulang, isi maks. per bin nol).
- **4.5.2** *Pesan ulang saat sisa* otomatis terisi 25% dari *Isi sampai* (bisa diatur).
- **4.5.3** **Unit atau persentase** *(diputuskan 28 Sep)*. Setiap kolom bertanda *unit atau %* punya pilihan satuan di sebelahnya. Persentase disimpan sebagai persentase, jadi nilainya ikut berubah saat *isi sampai* (atau stok yang tersedia) berubah, dan layar menampilkan nilainya dalam unit tepat di sebelahnya. Persentase diubah menjadi unit dengan pembulatan ke atas; *pesan ulang saat sisa* tidak pernah kurang dari 1 unit.

### 4.6 Isi maks. per bin dipelajari sistem **[DIPUTUSKAN 25 Sep]**

Ukuran bin dan ukuran kemasan berbeda-beda, jadi jumlah unit yang memenuhi satu bin tidak bisa diketahui untuk setiap SKU saat peluncuran.

- **4.6.1** **Disimpan per SKU × ukuran bin**, dipakai bersama oleh semua hub, dengan nilai opsional per hub yang menggantikannya.
- **4.6.2** **Saat pendaftaran**, Ops HQ boleh menyalinnya dari SKU serupa dengan ukuran bin yang sama. Jika tidak, angkanya dibiarkan kosong.
- **4.6.3** **Dipelajari dari SPV.** Setiap kali SKU mendapat bin kedua di suatu hub, lewat *Bin penuh* (§5.3.4) atau oleh SPV di *Rak & bin*, WMS menanyakan alasannya ke SPV:

| Jawaban | Akibat |
|---|---|
| **Bin pertama penuh** | Isi maks. = jumlah unit yang sekarang ada di bin pertama. Disimpan untuk hub ini; juga disimpan untuk semua hub jika SKU × ukuran bin belum punya angka bersama |
| Stok yang datang jauh lebih banyak dari biasanya (promo) | Bin kedua dipertahankan, isi maks. tidak diatur |
| Pindah bin (bin rusak, tempat lebih baik) | Stok dipindahkan, isi maks. tidak diatur |
| Batalkan | Bin kedua dilepas setelah kosong |

- **4.6.4** Jika angka hasil belajar di suatu hub berbeda lebih dari 20% dari angka bersama, Ops HQ mendapat tanda untuk memilih angka mana yang berlaku.
- **4.6.5** Ops HQ bisa mengatur atau mengubah isi maks. per bin mana pun kapan saja di peta hub.

### 4.7 Pengingat dan tanda **[dibangun 21 Sep]**

| Tanda | Tingkat | Default |
|---|---|---|
| Stok habis, atau sama dengan atau di bawah *batas kritis* | Kritis | aktif |
| **Kiriman dengan AWB yang tidak tercatat** (ke Ops HQ) | Kritis | aktif, lalu setiap 2 jam *(baru)* |
| Draf restock menunggu dikirim | Info | aktif |
| Draf belum dikirim setelah N jam | Tindakan | 4 jam |
| Merek belum konfirmasi setelah N jam | Tindakan | 24 jam |
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

### 4.8 Pengaturan, bukan membangun ulang

Semua angka di atas, aturan cadangan Grab (§9.5), dan batas kemasan (§6.10) adalah pengaturan yang diubah Ops HQ di *Aturan pengingat*. Jadi syarat yang masih dibahas dengan merek cukup menjadi pengaturan, bukan kode.

### 4.9 Hal terbuka

- **Jumlah awal.** *Isi sampai* dan *pesan ulang saat sisa* belum diisi untuk ke-105 SKU, jadi permintaan pertama ke tiap merek belum punya angka. *Usulan:* 15 unit per SKU (satu bin) dan 25%, lalu disesuaikan setiap minggu dari penjualan. *Yang memutuskan:* Ops HQ bersama merek.
- **Syarat konsinyasi** (Q5): frekuensi restock, waktu kirim, minimal order, stok pengaman, biaya restock. Jadi pengaturan setelah disepakati (§4.8).
- **Menagih merek.** Sudah ada tanda untuk merek yang belum konfirmasi (24 jam) atau kiriman terlambat (1 hari), tapi siapa yang menagih merek, dan caranya, belum ditulis.
- **Ongkos kirim** restock: merek atau Ninja.

## 5. Barang masuk dan penyimpanan

**Siapa**: staf, lalu SPV · **Sistem**: WMS · **Di dev**: terima per AWB dalam batch, daftar penyimpanan. *Unggah Faktur* dan kiriman tanpa AWB tercatat: belum

### 5.1 Terima kiriman

**Siapa:** staf di meja penerimaan, dengan HP hub dan scanner; lalu SPV untuk Faktur. **Kapan:** begitu driver merek datang. Tidak ada yang mengetik tanggal saat menerima barang *(diputuskan 30 Sep)*.

> **Istilah · Warna hari dan sekat**
> Setiap kiriman masuk ke bin-nya **di belakang sekat berwarna**, yaitu kartu plastik yang berdiri melintang di dalam bin. Warnanya menunjukkan minggu kiriman (warna stiker di layar, §5.4); **tanggal kiriman tiba** ditulis di **sekat putih**. Picker selalu mengambil dari depan, yaitu stok yang paling lama.

1. **Staf · di pintu, bersama driver**

   Pastikan Surat Jalan menyebut hub kamu dan mereknya, serta mencantumkan nomor PO. Hitung **karton** dan cocokkan dengan Surat Jalan. Jangan tanda tangan dulu.

2. **Staf · HP hub → stasiun WMS → Barang masuk → scan atau ketik AWB**

   ✓ Yang terlihat: barang yang menurut merek sudah dikirim, per SKU. *AWB ini belum dicatat Ops HQ* artinya AWB tidak dikenal: lanjut ke §5.2.

3. **Staf · buka karton pertama · scan setiap unit**

   WMS menunjuk satu **bin inbound sementara** untuk setiap SKU (`MA5-IN-01`, `MA5-IN-02` …). Masukkan unit ke bin itu.

   ✓ Yang terlihat: *cocok*, *kurang N* atau *lebih N* per SKU selama kamu scan.

4. **Staf · saat semua bin sementara penuh · Selesai batch ini**

   Taruh batch ini di rak dulu (langkah 5) sebelum menghitung sisanya.

5. **Staf · taruh di rak · WMS → Taruh di rak**

<!--screen:putaway-full-->

   Untuk setiap bin sementara, WMS menyebut **bin rak** tujuannya. Bawa bin sementara ke rak. Pasang sekat berwarna baru di belakang stok yang sudah ada, lalu taruh unit baru di belakangnya, dan tulis tanggal hari ini di sekat putih. **Scan label bin rak.**

   ✓ Yang terlihat: bin sementara kosong. Unit **bisa dijual sejak scan ini**, dan WMS mengirim stok baru ke Hiryu (§9).

6. **Staf · jika bin rak penuh · Bin penuh**

   WMS memberimu bin kosong dengan ukuran sama, sedekat mungkin. Taruh sisanya di sana lalu scan labelnya. Nanti SPV akan ditanya apakah bin pertama benar-benar penuh (§4.2); kamu tidak perlu menunggu.

7. **Staf · Semua barang AWB sudah diterima**

   Lakukan saat semua barang sudah masuk. Tulis selisih di Surat Jalan dan Faktur (*kurang 2 LBR-0005*, *lebih 1 LBR-0002*), tanda tangani keduanya, berikan satu salinan Surat Jalan ke driver, lalu serahkan Faktur yang sudah ditandatangani ke SPV.

   ✓ Yang terlihat: penerimaan menunggu Faktur.

8. **SPV · WMS → Barang masuk → penerimaan → Unggah Faktur**

<!--screen:faktur-upload-->

   Foto atau scan **setiap halaman Faktur yang sudah ditandatangani** lalu unggah.

   ✓ Yang terlihat: Faktur terlampir dan penerimaan ditutup. Sekarang Ops HQ bisa mengisi tanggal kedaluwarsa dari Faktur itu (§4.1 langkah 7).

9. **SPV · hanya jika ada perbedaan · Ajukan selisih ke Ops HQ**

   Unit **kurang atau rusak** masuk ke persetujuan selisih (§4.4). Unit **lebih** (melebihi PO): tambahkan catatan lalu ajukan; Ops HQ menyelesaikan Faktur dengan merek lewat email (§4.4.6).

   ✓ Yang terlihat: selisih muncul di *Perlu tindakan* milik Ops HQ.

**Barcode tidak dikenal**: scan lagi sambil memegang kemasan rata; lalu ketik angka di bawah barcode (§2.8.4). Jika produknya memang tidak ada di daftar: foto, hitung, tekan **Kirim ke Ops HQ**, dan biarkan di bin sementaranya.

### 5.2 Jika AWB tidak ada di WMS

<!--screen:inbound-noawb-->

1. **Staf · WMS menampilkan *AWB ini belum dicatat Ops HQ***

   Jangan suruh driver pergi.

2. **Staf · layar yang sama**

   Foto Surat Jalan, pilih mereknya, isi jumlah karton, lalu tekan **Kirim ke Ops HQ, lalu hitung**.

   ✓ Yang terlihat: *Ops HQ sudah diberi tahu*. Ops HQ langsung mendapat tanda.

3. **Staf · hitung selagi driver masih ada**

   Scan setiap unit ke bin sementara yang ditunjuk WMS. Tanda tangani Surat Jalan untuk jumlah **karton** yang diterima. Unit yang sudah dihitung **belum menjadi stok**.

4. **Ops HQ (atau SPV) · WMS → Pengingat → kirimannya**

   Hubungkan ke permintaan restock yang terbuka, catat sebagai kiriman tidak terencana dari Surat Jalan, atau tolak.

5. **Staf · setelah Ops HQ menghubungkannya**

   **Taruh di rak** muncul: taruh di rak seperti di §5.1 langkah 6. Jika Ops HQ menolak kiriman itu, barang tetap di bin sementara sampai dikembalikan ke merek (§8).

### 5.3 Aturan barang masuk

- **5.3.1** **Inbound dimulai dari AWB** atau referensi PO (§4.4). Penerimaan dibuka dengan jumlah yang sudah dikonfirmasi merek, lalu dibandingkan per SKU selama scan.
- **5.3.2** **Bertahap.** Satu bin sementara menampung satu SKU; jumlah bin sementara di hub diatur di *Rak & bin*. Satu AWB bisa diterima dalam beberapa tahap.
- **5.3.3** **Ke mana setiap unit disimpan.** Stok baru masuk ke bin pertama SKU sampai mencapai **isi maks. per bin**, lalu ke bin berikutnya. Jika **belum ada angkanya**, semua masuk ke bin pertama sampai staf menekan **Bin penuh** (§5).
- **5.3.4** **Bin penuh** saat putaway: WMS menawarkan bin kosong terdekat dengan ukuran bin SKU itu di hub tersebut, mendaftarkannya sebagai bin berikutnya untuk SKU itu, dan mengajukan pertanyaan bin kedua ke SPV (§4.6). Staf tidak perlu menunggu.
- **5.3.5** **Bisa dijual sejak scan putaway.** Tidak ada yang menunggu tanda tangan. WMS mengirim stok baru ke Hiryu secara otomatis (§9).
- **5.3.6** **Daftar putaway.** Catatan tetap tentang apa disimpan di mana, warna hari, dan batas klaim 24 jam; SPV menandatanganinya untuk kepatuhan.
- **5.3.7** **24 jam.** Selisih dengan merek harus diajukan dalam 24 jam sejak penerimaan; setelah itu kerugian ditanggung hub.
- **5.3.8** **Faktur yang sudah ditandatangani** *(diputuskan 30 Sep)*: SPV mengunggah foto atau scan setiap halamannya setelah inbound selesai. Penerimaan tetap terbuka sampai Faktur diunggah; penerimaan yang belum ada Fakturnya setelah 24 jam ditandai ke SPV, dan setelah 48 jam ke Ops HQ.
- **5.3.9** **Tidak ada ketikan saat inbound** *(diputuskan 30 Sep)*: staf penerimaan tidak pernah mengetik tanggal kedaluwarsa. Tanggal berasal dari Faktur dan diisi oleh Ops HQ (§5.5).

### 5.4 Warna hari dan FIFO

Setiap kiriman diletakkan di belakang sekat berwarnanya sendiri di dalam bin; warnanya menunjukkan minggu kiriman, dan tanggalnya ditulis di sekat putih. WMS tidak melacak sekat. WMS mengarahkan picker ke bin yang berisi stok yang **paling cepat kedaluwarsa** (atau, jika tidak ada tanggal kedaluwarsa, stok paling lama), dan layar menampilkan *ambil dari sekat paling lama*.

### 5.5 Tanggal kedaluwarsa dan umur stok **[DIPUTUSKAN 30 Sep]**

- **5.5.1** **Asal tanggalnya: Faktur.** PO meminta merek mencantumkan tanggal kedaluwarsa (ED) setiap SKU di Faktur. Jika merek melakukannya, **Ops HQ mengetik tanggalnya** di PO pada *Restock ke merek* setelah SPV mengunggah Faktur yang sudah ditandatangani (§4.1 langkah 7). WMS menempelkan setiap tanggal ke batch kiriman itu.
- **5.5.1a** **Tidak ada ketikan saat inbound.** Staf penerimaan tidak pernah membaca atau mengetik tanggal.
- **5.5.1b** **Tidak ada ED di Faktur**: umur batch **dihitung dari tanggal inbound-nya**. Tanda **Stok lama** muncul untuk batch yang lebih tua dari jumlah hari tertentu (default 180, berupa pengaturan sampai syarat konsinyasi menentukan lain).
- **5.5.2** **Disimpan per batch**: satu batch adalah satu SKU dalam satu kiriman. Saldo menyimpan batch-nya, jadi WMS tahu bin mana berisi kiriman yang mana dan, jika diketahui, tanggal yang mana.
- **5.5.3** **Dipakai untuk**: mengarahkan picker ke ED paling awal lebih dulu, atau jika tidak ada ED, ke tanggal inbound paling lama; menampilkan ED atau umur stok di layar ambil dan hitung stok; dan tanda **ED dekat** beberapa hari sebelum kedaluwarsa (default 90 hari), agar SPV bisa meminta Ops HQ mengatur retur dengan merek.
- **5.5.4** Sekat putih di dalam bin memuat tanggal inbound, ditulis oleh staf yang menaruh kiriman itu di rak.

### 5.6 Hal terbuka

- **Merek mencantumkan ED di Faktur** (Q15): PO sudah memintanya; sampai merek melakukannya, umur stoknya dihitung dari tanggal inbound.
- **Jam terima barang.** Kapan merek boleh mengirim, dan siapa yang menerima saat SPV libur.
- **Sisa umur minimal.** Belum ada aturan menolak unit yang segera kedaluwarsa (misalnya sisa kurang dari 6 bulan). Karena tanggal baru diketahui dari Faktur setelah inbound, ini menjadi pemeriksaan oleh Ops HQ, dan unit dikembalikan ke merek jika tidak lolos.
- **Kerusakan saat diterima.** Aturan klaim 24 jam sudah ada (§5.3.7), tapi langkah staf belum: foto, hitung sebagai kurang, dan unitnya ditaruh di mana.
- **Kiriman pertama yang besar** diterima sebagai risiko yang disadari (§17). Perkiraan waktu per 100 unit akan membantu merencanakan staf di hari pertama.

## 6. Ambil dan kemas

**Siapa**: staf yang memantau Hiryu, picker, packer · **Sistem**: Hiryu (*Accept*), lalu WMS · **Di dev**: ambil terpandu, batas siap 10 menit, 28 Sep. Pesanan dari Hiryu, penugasan dan *Selesai dikemas*: belum

### 6.1 Terima pesanan di Hiryu

**Siapa:** staf yang memantau Hiryu di laptop kemas. Keempat toko memakai **penerimaan MANUAL** *(diputuskan 30 Sep)*: pesanan baru masuk ke WMS setelah seseorang menekan **Accept**.

> **Istilah · Nomor GM dan ID pesanan Grab**
> **Nomor GM** (`GM-358`) adalah nomor pesanan pendek dari Hiryu, dicetak besar di slip kemas: nomor inilah yang dipakai orang. **ID pesanan Grab** adalah referensi panjang dari Grab: kedua sistem memakainya sebagai kunci, karena nomor GM bisa berulang.

> **Istilah · Live Orders dan slip kemas**
> **Live Orders** adalah papan pesanan Hiryu yang sedang berjalan, dibuka sepanjang hari di laptop kemas. Saat pesanan diterima, printer struk mencetak **slip kemas**, kertas dari Grab berisi nomor GM dan barang-barangnya. Slip ini bisa menampilkan nama pelanggan, jadi jangan pernah difoto.

<!--screen:hiryu-live-->

1. **Staf · laptop → Hiryu Live Orders**

   Suara pesanan baru berbunyi dan pesanan muncul di bawah *Pending accept*.

2. **Staf · pesanannya → Accept**

   Tekan **Accept** saat itu juga, dalam satu menit sejak suara berbunyi. Hiryu menganggap pesanan terlambat setelah 10 menit; 10 menit adalah target rata-rata untuk seluruh pesanan (§6.5.2).

   ✓ Yang terlihat: pesanan berpindah status di Live Orders, slip kemas tercetak, dan **Hiryu mengirim pesanan ke WMS** (§0.6.1, pesan 1).

3. **Staf · lihat sekilas antrean WMS**

   ✓ Yang terlihat: pesanan muncul di *Papan antrean* dalam hitungan detik, sudah diberikan ke picker (§6.2). Belum muncul setelah satu menit: beri tahu SPV (§8.5).

Tidak ada yang disalin atau ditempel, dan data pelanggan tidak pernah sampai ke WMS.

### 6.2 WMS memberikan pesanan ke picker

WMS **membagikan setiap pesanan sendiri** *(diputuskan 30 Sep)*: tidak ada yang memilih pesanan, dan tidak ada yang menunggu SPV membagikannya.

> **Istilah · Siap ambil (ready to pick)**
> Picker **siap** jika sudah menekan *Siap ambil* di HP hub dan tidak sedang memegang pesanan. Hanya picker yang siap yang diberi pesanan.

1. **Picker · HP hub → WMS station → Ambil pesanan → Siap ambil** · *di awal shift dan setelah setiap istirahat*

   ✓ Yang terlihat: *Menunggu pesanan*. HP menunggu.

2. **WMS · pesanan baru masuk**

   Pesanan diberikan ke picker siap yang sudah menunggu paling lama. HP berbunyi dan membuka pesanan itu.

   ✓ Yang terlihat: bin pertama, ditandai di rak dan level-nya (§6.3).

3. **WMS · tidak ada picker yang siap**

   Pesanan menunggu di antrean, **mulai dari yang sisa waktunya paling sedikit**. Picker berikutnya yang menyelesaikan pesanan langsung mendapatkannya, tanpa menekan apa pun.

4. **Picker · mau istirahat → Istirahat**

   Pesanan baru diberikan ke picker lain, atau menunggu. Tekan *Siap ambil* lagi setelah kembali.

5. **WMS · pesanan yang belum dimulai dalam 2 menit** (belum ada scan pertama)

   Pesanan kembali ke antrean dan diberikan ke picker siap berikutnya. SPV melihatnya di *Perlu tindakan*.

6. **SPV · WMS → Papan antrean** · *saat perlu*

   Lihat siapa memegang pesanan yang mana. **Pindahkan** memindahkan pesanan ke picker lain, dengan alasan.

**Satu orang bertugas** menjadi satu-satunya picker: setiap pesanan masuk ke HP-nya, satu per satu.

### 6.3 Ambil barang

**Siapa:** picker, dengan HP hub dan scanner.

<!--screen:pick-->

1. **Picker · HP hub · pesanan yang diberikan WMS** (§6.2)

   ✓ Yang terlihat: bin pertama, ditandai di rak dan level-nya, foto produk, dan jumlah yang harus diambil.

2. **Picker · di bin**

   Ambil sejumlah angka yang tampil **dari depan**, dari sekat paling lama dulu (§5.4).

3. **Picker · scan setiap unit**

   ✓ Yang terlihat: setiap scan mencentang satu unit, lalu bin berikutnya muncul. **Produk yang salah** menghentikan pengambilan dan menampilkan kedua produk berdampingan: kembalikan barang itu dan ambil yang benar. Jika produk yang salah itu memang ada di bin ini, tekan **Barang ini salah tempat**.

4. **Picker · barang tidak ada, atau kurang**

   Tekan **Barang tidak ada** (§8.1).

5. **Picker · setelah unit terakhir**

   ✓ Yang terlihat: *Pesanan selesai diambil*. Bawa keranjang ke meja kemas, lalu tekan **Serahkan ke meja packing**. WMS memberimu pesanan berikutnya, atau menunggu.

### 6.4 Kemas

**Siapa:** packer di meja kemas.

> **Istilah · Rak siap ambil (ready shelf)**
> Rak di **lantai bawah, di sebelah meja serah terima**, tempat tas yang sudah dikemas menunggu driver Grab. Tas diletakkan berdiri dengan nomor GM menghadap ke luar.

<!--screen:pack-->

1. **Packer · laptop → WMS → Kemas → Siap dikemas**

   Ambil pesanan yang paling lama. WMS menyebut kemasannya: **tas kertas** atau **kardus** (§6.10). Jika benar-benar tidak muat, tekan **Ganti kemasan** dan pilih alasannya.

2. **Packer · di meja kemas**

   Kemas barangnya. Masukkan slip kemas Hiryu (tercetak saat *Accept*) ke dalam kemasan atau tempel di luar, dengan nomor GM terlihat. Dua kemasan: nomor GM di keduanya.

3. **Packer · WMS → Selesai dikemas**

   Konfirmasi nomor GM.

   ✓ Yang terlihat: pesanan keluar dari *Siap dikemas*. **WMS memberi tahu Hiryu bahwa pesanan sudah siap** (§0.6.1, pesan 4) dan Hiryu menandainya siap di Grab. Tidak ada yang menekan *Mark ready* di Hiryu. Pesanan sekarang menunggu di layar serah terima (§7).

4. **Packer · bawa tasnya ke rak siap ambil di lantai bawah**

### 6.5 Pesanan

- **6.5.1** **Satu kanal di versi pertama: GrabMart Kilat.** Pesanan masuk ke WMS dari Hiryu setelah *Accept* (§0.6.1, pesan 1). Pesanan WhatsApp masuk versi berikutnya (§19).
- **6.5.2** Setiap pesanan membawa ID pesanan Grab (kunci utama), nomor GM (untuk dibaca orang), toko Hiryu, hub, dan **batas siap**: waktu pesanan + 10 menit, atau perkiraan Grab sendiri jika Hiryu mengirimnya (§0.6.4). **10 menit adalah target rata-rata** *(diputuskan 30 Sep)*: di luar jam sibuk, saat staf yang siaga lebih sedikit, pesanan bisa makan waktu lebih lama. Antrean memakai batas siap untuk menaruh pesanan yang paling mendesak di urutan pertama.
- **6.5.2a** **Pesanan terjadwal.** Untuk pesanan terjadwal, batas siap = waktu terjadwal dikurangi waktu persiapan yang diatur Ops HQ (default 20 menit). Pesanan menunggu di jalur *Terjadwal* dan dibagikan saat waktunya tiba.
- **6.5.2b** **Penerimaan pesanan** *(diputuskan 30 Sep)*: semua toko memakai MANUAL. WMS hanya menerima pesanan yang sudah diterima.
- **6.5.3** **Stok langsung ditahan untuk pesanan begitu pesanan masuk**, jadi dua pesanan tidak mungkin mendapat unit terakhir yang sama. Ditahan artinya unit tetap di rak tapi tidak lagi tersedia untuk pesanan lain, dan Hiryu langsung diberi tahu angka yang lebih rendah (§9).
- **6.5.4** **Pembagian pesanan** *(diputuskan 30 Sep)*: WMS memberikan setiap pesanan ke picker siap yang sudah menunggu paling lama; jika tidak ada yang siap, pesanan menunggu, mulai dari yang sisa waktunya paling sedikit; satu pesanan per picker dalam satu waktu; pesanan yang belum dimulai dalam 2 menit kembali ke antrean; SPV bisa memindahkan pesanan ke picker lain. Papan antrean punya jalur untuk menunggu, sedang diambil, menunggu dikemas, menunggu driver, dan selesai hari ini.
- **6.5.5** **Perilaku stok Grab sendiri** *(dikonfirmasi 25 Sep)*: Grab menurunkan stok yang ditampilkannya begitu pesanan dibuat, dan tidak mengembalikannya saat pesanan dibatalkan. WMS mengirim angka mutlak yang benar setelah setiap pembatalan, jadi angka Grab terkoreksi sendiri.

### 6.6 Pesanan dari Hiryu **[DIPUTUSKAN 30 Sep]**

Pesanan masuk dari Hiryu lewat pesan 1 (§0.6.1). Ini menggantikan salin dan tempel.

#### 6.6.1 Data pelanggan tetap di Hiryu

- Pesan 1 **tidak membawa data pelanggan**: tidak ada nama, nomor HP, alamat, catatan, atau pembayaran.
- WMS hanya menerima kolom yang tercantum, tidak ada yang lain; kolom yang tidak dikenal ditolak dan setiap kolom teks punya pola yang ketat.

#### 6.6.2 Apa yang dibawa pesanan

ID pesanan Grab; nomor GM; ID toko Hiryu; waktu pesanan; waktu terjadwal jika ada; perkiraan waktu siap dari Grab jika Hiryu memilikinya; per baris: **kode SKU dan jumlah unit** (Hiryu menghitungnya dari *Bundles*: jumlah item × unit per penjualan), ID item Hiryu, jumlah item, dan harga item pada hari itu.

#### 6.6.3 Apa yang terjadi saat pesan masuk

| Pesan | WMS |
|---|---|
| Pesanan baru | Menahan stok, memasukkannya ke antrean, memberikannya ke picker (§6.2) |
| Pesanan yang sama lagi | Diabaikan dengan aman: dijawab sebagai sudah diterima |
| Pembatalan (pesan 2) | Melepas stok yang ditahan; unit yang sudah diambil masuk ke *Kembalikan ke rak* (§8.4) |
| Kode SKU yang tidak dikenal WMS | Ditolak, alasannya dikirim balik ke Hiryu; Ops HQ langsung diberi tanda (§8.5) |

#### 6.6.4 Layar tempel

*Tempel pesanan Grab*, yang dibuat untuk minggu-minggu pertama, **dimatikan** begitu integrasi berjalan. Tidak ada jalur manual (§0.3.13).

### 6.7 Pick terpandu

- **6.7.1** Picker diarahkan ke **satu bin setiap kali**, sesuai urutan jalan, dengan kode bin, foto produk, dan jumlah yang harus diambil.
- **6.7.2** **Setiap unit di-scan.** Produk yang salah menghentikan pick dan menampilkan kedua produk berdampingan. Tidak bisa dilewati.
- **6.7.3** Mengambil beberapa pesanan sekaligus tidak ada di versi pertama. Cara ini baru menguntungkan di atas sekitar 15 pesanan per jam per picker; pilot merencanakan sekitar 7 pesanan per hari per hub.

### 6.8 Ke mana picker diarahkan

Picker pergi ke bin SKU mana pun yang berisi **stok paling lama**. Tidak ada tugas memindahkan stok dari satu bin ke bin lain; picker cukup mengikuti stok paling lama.

### 6.9 Aturan kemas

- **6.9.1** WMS menentukan kemasan sebelum pick dimulai (§6.10). Packer bisa mengubahnya dengan dua ketukan dan alasan dari daftar.
- **6.9.2** **Tidak ada label untuk di-scan** *(25 Sep; diubah 30 Sep)*. Slip kemas Hiryu adalah desain Grab dan tidak memuat kode yang bisa dibaca WMS, jadi scan saat pick adalah pengecekannya. Setelah pesanan dikemas, packer menekan **Selesai dikemas** di WMS, yang mengirim *pesanan siap* ke Hiryu (§0.6.1, pesan 4); Hiryu menandai pesanan siap di Grab. Staf tidak lagi menekan *Mark ready* di Hiryu.

### 6.10 Aturan kemasan

*Diperbarui 25 September.* **Hanya dua kemasan: tas kertas dan karton.** Tidak ada ziplock, tidak ada bubble wrap dalam logika ini.

**Cara WMS memutuskan, singkatnya.** Sebelum pengambilan dimulai, WMS menjumlahkan isi pesanan lalu memeriksa daftar ini dari atas. Baris pertama yang cocok adalah kemasan yang disebut WMS:

1. **Tas kertas** jika barangnya muat dalam 3.9 L, beratnya 3.0 kg atau kurang, tidak ada yang lebih panjang dari 27 cm, dan ada **paling banyak satu** botol besar (150 ml atau lebih).
2. Jika tidak, **karton**, jika barangnya muat dalam 4.0 L, beratnya 5.0 kg atau kurang, dan tidak ada yang lebih panjang dari 25 cm.
3. Jika tidak juga, **dua kemasan**: barang berat dan besar masuk karton lebih dulu, sisanya ke tas kertas, dan pesanan ditandai *2 kemasan*.

| Contoh pesanan | Jumlahnya | Kemasan dari WMS |
|---|---|---|
| 2 sabun cuci muka 100 ml + 1 pelembap 50 ml | sekitar 0.7 L, 0.4 kg, tanpa botol besar | **Tas kertas** |
| 2 pembersih 225 ml (botol pump) + 1 serum | sekitar 1.3 L, 0.8 kg, **2 botol besar** | **Karton** (dua botol besar tidak pernah masuk tas) |
| 8 pembersih 225 ml + 6 sabun mandi 250 ml | sekitar 5.2 L, 4.6 kg | **Dua kemasan**: terlalu besar untuk satu karton, jadi satu karton ditambah satu tas kertas |

Packer bisa mengganti kemasan dengan dua ketukan, dengan alasan dari daftar (§6.9.1).

| Kemasan | Ukuran dalam | Volume terpakai | Beban maks. (asumsi) |
|---|---|---|---|
| Tas kertas, kraft 70 gsm bertali (Berkah PBG15) | 18 × 10 × 33 cm | 18 × 10 × 27 cm × 80% = **3.9 L** | **3.0 kg** |
| Karton, dinding tunggal (Maxellpack CCM-36) | 25 × 20 × 10 cm | 25 × 20 × 10 cm × 80% = **4.0 L** | **5.0 kg** |

#### 6.10.1 Aturannya

Untuk setiap pesanan, WMS menjumlahkan:

- **V** = jumlah dari unit × volume kemasan;
- **G** = jumlah dari unit × berat;
- **L** = kemasan terpanjang dalam pesanan;
- **N** = jumlah botol besar (150 ml atau lebih).

1. **Tas kertas** jika V ≤ 3.9 L, G ≤ 3.0 kg, L ≤ 27 cm, dan N < 2.
2. Jika tidak, **karton** jika V ≤ 4.0 L, G ≤ 5.0 kg, dan L ≤ 25 cm.
3. Jika tidak juga, **dua kemasan**: WMS membagi baris pesanan, barang berat dan besar masuk karton lebih dulu, lalu menandai pesanan *2 kemasan*.

#### 6.10.2 Alasan angka-angka ini

Grab tidak punya spesifikasi tas atau karton, jadi setiap angka adalah asumsi yang perlu diuji:

- **Volume terpakai.** Tas kehilangan 6 cm di bagian atas untuk dilipat tertutup. Kedua kemasan dihitung terisi 80%, karena kotak kaku dan botol tidak pernah mengisi ruang sepenuhnya; sekitar seperlima tetap berisi udara.
- **Tas kertas 3.0 kg.** Tas kraft kecil dengan tali pilin biasanya dijual untuk membawa 3 sampai 5 kg. Kami ambil batas bawahnya karena tas juga berayun di dalam box rider.
- **Karton 5.0 kg.** Karton dinding tunggal seukuran ini sanggup membawa jauh lebih berat dari itu. Batasnya adalah beban yang masih nyaman ditahan selotip bawah dan box rider.
- **Dua botol besar berarti karton.** Dua botol berat di tas kertas menekan satu titik, merobek dasar tas, dan menghancurkan barang kecil di sebelahnya. Dalam simulasi pesanan sebelumnya, aturan ini mengirim sekitar 13% pesanan ke karton.
- **Barang terpanjang.** Tas menampung barang berdiri sampai setinggi lipatannya (27 cm); karton sampai sepanjang ukurannya (25 cm).

Jika data kemasan tidak ada: volume diambil dari perkiraan di daftar SKU; berat = isi (ml atau g) × 1.0 ditambah 20% untuk kemasan (plastik) atau 60% (kaca); bawaan kategori jika keduanya tidak diketahui. Saran kemasan lalu menampilkan *perkiraan*.

#### 6.10.3 Uji sebelum go-live, lalu tetapkan

1. Isi tas sampai 3.0 kg dengan produk asli (misalnya 2 pembersih Labore 225 ml dan sisanya tube kecil).
2. Angkat dari talinya, goyangkan 10 kali, gantung selama satu menit, lalu jatuhkan dari ketinggian 30 cm ke lantai keras.
3. Jika tahan, coba 4.0 kg dengan cara yang sama. Batasnya menjadi berat terakhir yang lolos, dikurangi 20%.
4. Lakukan hal yang sama untuk karton, lalu tetapkan kedua batas di *Aturan pengingat*. Setiap penggantian kemasan oleh packer (beserta alasannya) dihitung tiap minggu, jadi batas yang salah akan kelihatan.

### 6.11 Status pesanan di WMS

| Status | Diatur oleh |
|---|---|
| Menunggu | Pesanan masuk dari Hiryu, setelah *Accept* |
| Sedang diambil | WMS memberikannya ke picker |
| Menunggu dikemas | Picker menekan *Serahkan ke meja packing* |
| Dikemas dan siap | Packer menekan *Selesai dikemas*; *pesanan siap* dikirim ke Hiryu |
| Diserahkan | Staf di meja serah terima menekan *Ya, sudah diambil driver* |
| Dibatalkan | Pembatalan dari Hiryu (pesan 2), di status apa pun |

### 6.12 Hal terbuka

- **Batas kemasan** setelah uji beban (Q8, §6.10.3).
- **Menutup kemasan.** Cara menutup tas atau kardus (staples, lakban, stiker segel), letak slip Hiryu, dan kedua kemasan pada pesanan dua kemasan sama-sama diberi nomor GM.
- **Pesanan terjadwal** (Q13): arti *Scheduled time*. Jalur *Terjadwal* belum dibuat.
- **Waktu siap dari Grab** di dalam pesanan (§0.6.4 butir 8).
- **Tas dan kardus yang terpakai** per pesanan diketahui dari aturan kemasan; stoknya ada di §12.

## 7. Serah ke Grab

**Siapa**: siapa pun yang ada di meja serah terima · **Sistem**: hanya WMS · **Di dev**: *Kemas & serah ke driver* (layar 21), 28 Sep

### 7.1 Serahkan ke driver Grab

**Siapa:** siapa pun yang ada di meja serah terima di lantai bawah, dengan HP hub kedua. Layar ini adalah **cek kedua** WMS bahwa driver membawa tas yang benar, karena meja kemas dan meja serah terima letaknya berjauhan *(diputuskan 30 Sep)*.

<!--screen:handover-->

1. **Staf · HP hub kedua → WMS → Serah ke driver → Menunggu driver**

   ✓ Yang terlihat: semua tas yang sudah dikemas, dengan lama menunggunya. **Kuning** berarti lebih dari 20 menit.

2. **Staf · driver datang**

   Tanyakan nomor pesanannya. Cari tas yang slipnya menunjukkan **nomor GM** yang sama.

3. **Staf · nomornya sama → Ya, sudah diambil driver**

   Konfirmasi, lalu berikan tasnya ke driver.

   ✓ Yang terlihat: tas hilang dari daftar. Grab memperbarui Hiryu sendiri saat mencatat pengambilan.

4. **Staf · nomornya tidak sama**

   Jangan serahkan. Minta driver mengecek aplikasi Grab; panggil SPV jika masih tidak sama.

Jika tas menampilkan **Dibatalkan** (pembatalan masuk dari Hiryu saat tas menunggu), jangan serahkan: bawa kembali ke lantai atas untuk dibongkar (§8.2).

### 7.2 Aturan serah terima **[DIPUTUSKAN 25 dan 30 Sep]**

- **7.2.1** Setelah *Selesai dikemas*, pesanan menunggu di **Serah ke driver** beserta lama menunggunya.
- **7.2.2** Saat driver datang, staf mencocokkan nomor pesanan yang disebut driver dengan nomor GM di slip, lalu menekan **Ya, sudah diambil driver**. WMS mencatat siapa yang menyerahkan dan kapan. **Tidak ada yang dikirim ke Hiryu**: Grab mencatat pengambilan sendiri. Pesanan **selesai** di WMS.
- **7.2.3** Tas yang menunggu lebih dari 20 menit (bisa diatur) berwarna kuning dan muncul di *Perlu tindakan* milik SPV.
- **7.2.4** Pembatalan yang masuk saat tas menunggu membuat barisnya merah, *Dibatalkan*: tas dibawa kembali untuk dibongkar.
- **7.2.5** Tidak ada foto yang disimpan di WMS: slip kemas di tas bisa menampilkan nama pelanggan (§0.3.11). Foto tas yang sudah dikemas, sebagai bukti jika ada sengketa, direncanakan **di Hiryu** *(28 Sep)*, begitu fiturnya ada.

### 7.3 Hal terbuka

- **Driver tidak datang.** Setelah tanda 20 menit, SPV mengecek Hiryu. Kalau pesanan masih aktif, lalu apa: hubungi dukungan merchant Grab, tetap menunggu, atau minta driver baru?
- **Bukti dari driver.** Apa yang diterima staf kalau driver tidak punya nomor pesanan, atau menyebut nomor yang salah.
- **Satu orang bertugas** yang membawa tas ke bawah meninggalkan laptop saat pesanan masuk. *Usulan:* diterima untuk pilot; jeda hub kalau dua pesanan *Late* (§13.2).
- **Foto bukti di Hiryu** (Q14): belum ada tanggal.

## 8. Pembatalan dan retur

**Siapa**: staf, SPV · **Sistem**: Hiryu mengirim pembatalan, WMS melaporkan barang tidak ada · **Di dev**: barang tidak ada dengan cek tempat lain, kembalikan ke rak, 28 Sep. Pembatalan dan barang kurang lewat sambungan, kembalian dari driver, retur ke merek: belum

### 8.1 Barang tidak ada atau kurang

Jika ada barang yang tidak ada, **seluruh pesanan dibatalkan**, oleh Hiryu, secara otomatis *(diputuskan 30 Sep)*. Jika Shaun mengonfirmasi bahwa *Edit order* di Grab bisa dipakai, hanya baris yang tidak ada yang dihapus (§0.6.4).

<!--screen:short-->

1. **Picker · HP hub → Barang tidak ada**

   Isi apa yang kamu temukan: **Tidak ada sama sekali**, atau atur jumlahnya dengan − dan +.

   ✓ Yang terlihat: *Cek dulu di tempat lain*, dengan tempat lain yang tercatat di WMS menyimpan SKU itu (bin lain, bin sementara barang masuk).

2. **Picker · cari di sana**

   Jika ketemu: tekan **Ketemu, lanjut ambil**. Pengambilan berlanjut dari bin itu.

3. **Picker · masih tidak ada → Catat: tidak ada**

   ✓ Yang terlihat: *Pesanan dibatalkan*. WMS memberi tahu Hiryu bahwa barangnya kurang (§0.6.1, pesan 5); Hiryu membatalkan pesanan dengan **2001 Item out of stock** lalu memberi tahu WMS kembali. Tidak perlu langkah SPV.

4. **Picker · WMS station → Kembalikan ke rak → Kerjakan**

   Scan setiap unit yang sudah diambil untuk pesanan ini kembali ke bin-nya. Lalu lanjut ke pesanan berikutnya.

SPV melihat setiap barang yang tidak ada, beserta nama picker, di *Perlu tindakan*. Stok yang sudah dikoreksi sampai ke Hiryu secara otomatis.

### 8.2 Pesanan dibatalkan

Pembatalan datang **dari Hiryu, secara otomatis** (§0.6.1, pesan 2): pelanggan, Grab, atau Hiryu yang membatalkan. Tidak ada yang perlu menekan apa pun untuk memberi tahu WMS.

<!--screen:cancel-->

1. **Siapa saja · WMS menampilkan pesanan sebagai Dibatalkan**

   Di HP picker, di *Siap dikemas*, atau di *Serah ke driver*.

2. **Picker · berhenti mengambil pesanan itu.** WMS memberimu pesanan berikutnya.

3. **Packer atau staf serah terima · tas yang sudah dikemas** · bawa kembali ke meja kemas lalu bongkar.

4. **Staf · WMS station → Kembalikan ke rak → Kerjakan**

   Scan setiap unit, lalu bin yang disebut WMS.

   ✓ Yang terlihat: setiap unit kembali menjadi stok saat bin-nya di-scan. Stok sampai ke Hiryu secara otomatis.

### 8.3 Jika barang tidak ada **[DIPUTUSKAN 28 dan 30 Sep]**

Perubahan pesanan di Grab masih perlu dikonfirmasi ke Shaun (§0.6.4); sampai saat itu **barang yang tidak ada membatalkan seluruh pesanan**, dengan alasan **2001 Item out of stock**, dilakukan oleh Hiryu saat WMS melaporkan barang kurang.

1. Picker menekan **Barang tidak ada** dan mengisi berapa yang ditemukan: tidak ada, atau angka yang diatur dengan − dan +.
2. WMS **menghentikan pesanan** dan menampilkan tempat lain di hub ini yang tercatat menyimpan SKU itu (bin lain, bin sementara barang masuk yang belum disimpan ke rak). Jika picker menemukannya di sana: **Ketemu, lanjut ambil**, dan pengambilan berlanjut.
3. Jika tidak, WMS mengirim **barang kurang** ke Hiryu (pesan 5). Hiryu membatalkan dengan 2001 lalu mengirim pembatalannya kembali (pesan 2). **Tanpa konfirmasi SPV** *(diputuskan 30 Sep)*: jika tidak ada di rak, berarti stoknya habis.

Saat *Barang tidak ada* ditekan, WMS juga:

- **mengubah hitungan bin menjadi jumlah yang ditemukan**, agar pesanan lain tidak diarahkan ke bin yang kosong, dan mengirim stok baru ke Hiryu;
- **memasukkan SKU ke hitung cek berikutnya** (§10.1);
- **menampilkannya di *Perlu tindakan* milik SPV**, dengan menyebut nama picker.

Di sini picker boleh menurunkan stok tanpa SPV, karena kalau menunggu, Grab terus menjual produk yang tidak ada di hub. Untuk mencegah penyalahgunaan, SPV melihat setiap laporan beserta nama picker.

Karena setiap barang yang tidak ada membatalkan satu pesanan utuh dan menurunkan penilaian toko (Grab juga membatasi pembatalan oleh merchant), **pencegahan paling penting**: cadangan Grab (§9.5), stok dikirim setelah setiap perubahan (§9), dan hitung stok (§10.1).

### 8.4 Pembatalan **[DIPUTUSKAN 25 dan 30 Sep]**

Pembatalan **masuk dari Hiryu** (pesan 2). WMS melepas stok yang ditahan; unit yang sudah diambil masuk ke **Kembalikan ke rak**, tempat staf mana pun men-scan setiap unit kembali ke bin-nya, dan setiap scan mengembalikannya ke stok. Tas yang sudah dikemas dibongkar dulu. Pembatalan yang masuk sebelum pesanannya disimpan dulu, lalu diterapkan saat pesanan masuk (§0.6.2). SPV bisa membuka kembali pesanan yang salah dibatalkan di WMS hanya jika Hiryu masih menampilkannya terbuka.

### 8.5 Masalah pesanan

| Masalah | Yang dilakukan WMS | Siapa yang bertindak |
|---|---|---|
| Sudah diterima di Hiryu, belum ada di WMS setelah satu menit | Tidak ada yang masuk, jadi tidak ada yang ditampilkan: staf yang memantau Hiryu yang menyadarinya (§6.1) | SPV mengecek *Integrasi Hiryu*; jika pesanan tidak mengalir, jeda hub (§14) |
| Pesanan dengan SKU yang tidak dikenal WMS | Menolaknya, memberi tahu Hiryu alasannya, langsung memberi tanda ke Ops HQ | Ops HQ memperbaiki SKU di Hiryu agar pesanan dikirim lagi; jika belum diperbaiki dalam 5 menit, SPV membatalkan pesanan di Hiryu (2003 Too busy) |
| Pesan ke Hiryu terus gagal | Terus mencoba ulang; memberi tanda ke SPV dan Ops HQ setelah 5 menit | Ops HQ, bersama Shaun |
| Tas tidak diambil | Kuning setelah 20 menit, di *Perlu tindakan* milik SPV | SPV mengecek pesanan di Hiryu |
| Driver mengembalikan pesanan yang tidak terkirim | *Kembalian dari driver*: cari pesanan dengan nomor GM, scan setiap unit sebagai baik atau rusak | Staf, lalu SPV |

### 8.6 Nota retur **[DIPUTUSKAN 28 Sep]**

Unit yang dikembalikan ke merek keluar bersama **nota retur** (*Surat Jalan retur*) yang dicetak dari WMS: referensi `RTN-<hub>-<yymm>-<n>`, merek, hub, tanggal, dan per baris SKU, jumlah, alasan, dan ED. Staf men-scan keluar setiap unit sesuai nota itu; driver merek dan SPV menandatangani dua salinan; SPV mengunggah foto salinan yang sudah ditandatangani ke data retur di WMS (foto ini tidak memuat data pelanggan). Unit yang diretur keluar dari ledger saat di-scan.

### 8.7 Hal terbuka

- **Driver mengembalikan pesanan** (§8.5): barisnya ada di tabel, tapi belum ada langkah staf dan layarnya (*Kembalian dari driver*). Siapa yang menanggung barang kembalian yang rusak adalah Q6.
- **Retur ke merek.** Surat jalan retur sudah diputuskan (§8.6), tapi belum kapan retur dilakukan (hanya bersama kiriman berikutnya, atau hari tertentu), siapa yang memesan penjemputan merek, dan bagaimana memilih barang lambat laku dan hampir kedaluwarsa (Q5).
- **Penarikan (recall).** Belum ada langkah untuk recall dari merek atau BPOM: temukan setiap unit batch itu dari ED-nya, hentikan penjualan, karantina, retur.
- **Memindahkan stok antara MA5 dan KJ5.** Transfer antar hub sudah dibuat tapi disembunyikan. Apakah pilot membutuhkannya, misalnya saat satu hub kekurangan dan yang lain penuh?
- **Biaya batal karena barang tidak ada.** Grab bisa mengenakan biaya ke merchant. Siapa yang menanggung (Ninja kalau hitungannya salah, merek kalau kirimannya kurang) belum ditulis.

## 9. Update stok harian ke Hiryu

**Siapa**: WMS dengan sendirinya; SPV mengecek · **Sistem**: WMS → Hiryu · **Di dev**: antrean pesan stok. Mengirimnya: belum

### 9.1 Bagaimana angka berubah

| Di mana | Siapa yang mengubah | Kapan berubah |
|---|---|---|
| **WMS** (hitungan sebenarnya) | Scan staf | Setiap simpan ke rak, ambil barang, hitung stok, retur, dan laporan masalah |
| **Hiryu** (Units on hand) | **WMS, lewat integrasi** | Setelah setiap perubahan di WMS, dalam hitungan detik (§9.4). Hiryu tidak lagi mengurangi unit sendiri |
| **Grab** (yang dilihat pelanggan) | Hiryu | Setiap kali angka Hiryu berubah. Grab juga menurunkan angkanya sendiri begitu pesanan dibuat; angka berikutnya dari WMS mengoreksinya |

**Tidak ada yang mengetik stok** *(diputuskan 30 Sep)*. SPV mengecek bahwa integrasi berjalan (§9.3).

### 9.2 Kapan stok sampai ke Hiryu

| Saat | SKU yang mana |
|---|---|
| **Pesanan masuk** (stok ditahan) | SKU dalam pesanan itu |
| **Kiriman disimpan ke rak** | SKU dalam kiriman itu |
| **Pesanan dibatalkan** | SKU dalam pesanan itu, saat setiap unit di-scan kembali |
| **Barang tidak ada** (§8.1) | SKU itu, langsung |
| **Hitungan stok disetujui** | SKU yang dihitung |
| **Keputusan karantina** (kembali ke rak, hapus stok) atau laporan | SKU itu |
| **Setiap malam pukul 03:00** | Semua SKU di semua toko, sebagai jaring pengaman |

### 9.3 Yang dicek SPV

**Siapa:** SPV, saat buka dan saat *Perlu tindakan* menampilkan masalah integrasi.

<!--screen:hiryu-stock-->

1. **SPV · WMS → Integrasi Hiryu**

   ✓ Yang terlihat: waktu pesan terakhir dikirim, **0 menunggu** dan **0 gagal**. Apa pun yang menunggu lebih dari 5 menit tampil merah.

2. **SPV · saat buka · Hiryu → Stores → satu toko → Stock**

   Pilih tiga SKU lalu bandingkan *Units on hand* dengan angka WMS (WMS menampilkannya di halaman SKU sebagai *terkirim ke Hiryu*).

   ✓ Yang terlihat: angkanya sama.

3. **SPV · ada yang gagal, atau angkanya berbeda**

   Beri tahu Ops HQ. Jika pesanan tidak sampai ke WMS, jeda hub di Grab (§13.2, §14).

Jangan pernah memakai kolom **Arrived** di Hiryu atau mengetik *Units on hand*: angka WMS akan menimpanya dalam hitungan detik.

### 9.4 Stok lewat integrasi **[DIPUTUSKAN 30 Sep]**

- **9.4.1** Pesan 3 (§0.6.1) membawa, per toko Hiryu dan kode SKU, **stok siap jual** sebagai angka mutlak.
- **9.4.2** **Stok siap jual = unit di rak − unit yang ditahan untuk pesanan yang belum diambil − cadangan Grab, tidak pernah di bawah 0.** Unit di karantina atau di bin inbound sementara tidak termasuk unit di rak. Unit yang sudah diambil tidak lagi termasuk unit di rak.
- **9.4.3** Angka dikirim **setelah setiap perubahan**, dikelompokkan per SKU agar rentetan scan hanya mengirim satu angka, dan selalu dalam 10 detik.
- **9.4.4** **Snapshot lengkap** semua SKU di semua toko dikirim saat integrasi dinyalakan dan setiap malam pukul 03:00.
- **9.4.5** **Hiryu berhenti menyimpan hitungannya sendiri**: tidak ada pengurangan saat *Mark ready*, tidak ada yang dikembalikan setelah pembatalan. *Units on hand* adalah angka WMS.
- **9.4.6** Lembar stok *Stok untuk Hiryu* dan pengetikan oleh SPV **dihentikan**. Halaman SKU menampilkan angka terakhir yang dikirim dan kapan.

### 9.5 Cadangan Grab (Grab buffer) **[DIPUTUSKAN 25, 28 dan 30 Sep]**

**Apa itu**: beberapa unit dari setiap SKU yang tidak kita tampilkan ke Grab. Jika WMS mencatat 5 di rak, Grab diberi tahu 4. Unit cadangan itu menutup salah hitung, atau unit rusak yang belum dilaporkan siapa pun. Tanpa cadangan, unit yang ternyata tidak ada berarti barang tidak ada, dan barang yang tidak ada membatalkan seluruh pesanan (§8.3).

**Diputuskan**: **1 unit per SKU secara bawaan** sejak go-live. Ops HQ bisa mengatur SKU mana pun ke 0, angka lain, atau persentase dari stok tersedia (§4.5.3). Ninja yang menetapkannya, sebagai perencana stok untuk dark store miliknya sendiri.

**Cara menerapkannya** *(30 Sep)*: **oleh WMS**, di angka yang dikirim ke Hiryu (§9.4.2). Hiryu tidak butuh pengaturan buffer. Karena itu *Units on hand* di Hiryu lebih rendah dari hitungan sebenarnya sebesar cadangan, jadi **laporan selalu diambil dari WMS**, tidak pernah dari Hiryu.

### 9.6 Hal terbuka

- **Hari pengaktifan** (§0.6.4 butir 6): snapshot stok penuh, dan Hiryu mematikan pengurangan stoknya sendiri pada saat yang sama.
- **Angka yang berbeda** saat cek pembukaan (§9.3): siapa yang menyelidikinya, dan apakah hub dijeda selama pemeriksaan.

## 10. Stock opname

**Siapa**: staf menghitung; SPV, Ops HQ dan Ops Head menyetujui · **Sistem**: WMS, lalu Hiryu · **Di dev**: hitung buta, hitung ulang, satu persetujuan. Persetujuan tiga langkah dan rencana hitung: belum

### 10.1 Kapan menghitung stok

| Hitungan | SKU yang mana | Seberapa sering | Siapa |
|---|---|---|---|
| **Hitung rutin** | 20% SKU teratas menurut unit terjual | Setiap minggu | Staf menghitung, SPV memeriksa |
| **Hitung rutin** | Semua SKU lainnya | Setiap bulan | Staf menghitung, SPV memeriksa |
| **Hitung khusus** | SKU yang pernah kena barang tidak ada, unit ditemukan, atau laporan karantina | Hari berikutnya | Staf menghitung, SPV memeriksa |
| **Hitung penuh** | Setiap SKU di hub | Hari terakhir setiap bulan, sebelum laporan penjualan ke merek | Staf menghitung, SPV dan Ops HQ memeriksa |

Selisih yang ditemukan saat hitung stok harus disetujui **SPV, lalu Ops HQ, lalu Ops Head** sebelum WMS mengubah stok. Unit yang ternyata **kurang** langsung dikeluarkan dari stok yang bisa dijual selama persetujuan berjalan, supaya Grab berhenti menjualnya. Unit yang ternyata **lebih** baru ditambahkan setelah Ops Head menyetujui. Dalam kedua kasus, WMS mengirim angka barunya ke Hiryu dengan sendirinya (§9).

> **Istilah · Hitung buta (blind count)**
> Orang yang menghitung tidak pernah melihat angka yang diharapkan WMS. Ia men-scan apa yang benar-benar ada di bin, jadi hitungannya tidak terpengaruh angka sistem.

#### 10.1.1 Cara menghitung

1. **SPV · WMS → Hitung stok → Rencana**

   ✓ Yang terlihat: bin yang harus dihitung hari ini (hitung rutin dan hitung khusus). Bin itu juga muncul di *Perlu tindakan* setiap staf (§13.5).

2. **Staf · HP hub → WMS station → Hitung stok → scan label bin**

   Bin itu dikunci untukmu selama kamu menghitung; angka WMS tetap tersembunyi.

3. **Staf · scan setiap unit di bin, lalu Selesai**

   ✓ Yang terlihat: *Cocok*, atau ada selisih.

4. **Staf · ada selisih → Hitung ulang**

   Hitung bin itu sekali lagi. Baru setelah itu WMS menampilkan kedua angka.

5. **SPV → Ops HQ → Ops Head · WMS → Hitung stok → Hasil**

   Masing-masing memeriksa selisihnya, lalu menyetujui atau mengembalikannya dengan catatan, sesuai urutan itu, oleh tiga orang yang berbeda (§10.2).

   ✓ Yang terlihat: stok dikoreksi setelah Ops Head menyetujui, dan angka barunya dikirim ke Hiryu.

### 10.2 Hitung stok **[DIPUTUSKAN 28 Sep]**

- **10.2.1** **Jadwal** (§10.1): 20% SKU teratas berdasarkan unit terjual selama empat minggu dihitung setiap minggu, sisanya setiap bulan; SKU baru dianggap teratas sampai punya riwayat. **Hitung cepat** keesokan harinya untuk setiap SKU yang kena barang tidak ada, unit ditemukan, atau laporan karantina. **Hitung penuh** untuk semua SKU di hari terakhir setiap bulan, sebelum laporan sell-out.
- **10.2.2** **Caranya**: staf memilih bin, bin itu dikunci untuknya, lalu ia men-scan setiap unit. Angka sistem tetap disembunyikan. Setiap perbedaan memunculkan tanda; staf menghitung ulang sekali sebelum angka sistem ditampilkan.
- **10.2.3** **Persetujuan**: selisih butuh **SPV, lalu Ops HQ, lalu Ops Head**, tiga orang berbeda, sebelum stok berubah. Unit yang ternyata **kurang** langsung dikeluarkan dari stok yang bisa dijual begitu hitungan dikirim, jadi Grab berhenti menjualnya selama persetujuan berjalan; unit yang ternyata **lebih** baru ditambahkan setelah Ops Head menandatangani.
- **10.2.4** Setelah tanda tangan terakhir, SKU itu masuk ke lembar stok agar SPV mengetiknya ke Hiryu (§9.4).

### 10.3 Hal terbuka

- **Menghitung saat buka.** Apakah hitung dilakukan saat toko buka (setiap bin dikunci selama dihitung) atau sebelum buka? Hitung penuh akhir bulan mungkin perlu jeda hub.
- **Merek di akhir bulan.** Stoknya konsinyasi: apakah merek menyaksikan atau menandatangani hitung akhir bulan yang dipakai untuk laporan penjualan?
- **Waktu dan pembagian.** Jam berapa hitung dilakukan, dan siapa yang membagikan bin untuk dihitung.
- **Hitung pertama** tepat setelah kiriman pertama, sebelum go-live. *Usulan:* ya, hitung penuh.

## 11. Klaim, karantina dan masalah stok

**Siapa**: siapa saja melapor; SPV memutuskan; Ops HQ dan Ops Head menyetujui penghapusan stok · **Sistem**: WMS · **Di dev**: belum

### 11.1 Laporkan masalah

<!--screen:report-->

1. **Siapa saja · layar WMS mana saja → Laporkan masalah**

   Pilih apa yang terjadi:

| Pilih | Kapan |
|---|---|
| Rusak atau bocor | Pecah, penyok, bocor, segel terbuka |
| Kedaluwarsa | Sudah lewat tanggalnya, atau terlalu dekat untuk dijual (SPV yang memutuskan) |
| Salah tempat | Produk ada di bin yang bukan bin-nya |
| Barang ditemukan | Ada unit di tempat yang tidak diketahui WMS: lantai, bin yang salah, bagian belakang rak |
| Kembalian dari driver | Driver membawa kembali pesanan yang tidak terkirim |
| Lainnya | Hal lain |

2. **Layar yang sama · scan atau pilih produknya**, atur jumlahnya dengan − dan +, tambahkan foto jika bisa. Jangan pernah foto slip kemas: slip itu bisa menampilkan nama pelanggan.

3. **Taruh unitnya di baki karantina, lalu scan label baki** (`MA5-KARANTINA`).

   ✓ Yang terlihat: *Tersimpan di karantina*. Unit itu langsung keluar dari stok yang bisa dijual dan menunggu SPV (§11.2). *Salah tempat* dan *Barang ditemukan* tidak masuk baki: WMS menunjuk bin yang benar, kamu taruh unitnya di sana lalu scan bin-nya.

### 11.2 Masalah dan karantina

<!--screen:exceptions-->

**Siapa melakukan apa**: siapa saja boleh melapor dan menaruh unit di baki; **SPV yang memutuskan**; **staf** yang memindahkan barangnya. **Penghapusan stok** juga harus disetujui **Ops HQ** dan **Ops Head**, setiap kali.

1. **SPV · WMS → Masalah → laporannya**

   Lihat foto dan alasannya. **Tanggungan** menunjukkan siapa yang menanggung biaya sesuai alasan itu (§11.6). Ubah alasannya jika laporannya salah.

2. **SPV · putuskan dalam 24 jam**

| Keputusan | Persetujuan | Apa yang terjadi selanjutnya | Bisa dijual lagi |
|---|---|---|---|
| **Kembali ke rak** | SPV | Tugas *Kembalikan dari karantina* muncul untuk staf | Saat bin di-scan |
| **Retur ke merek** | SPV | Unit tetap di baki dengan tanda *Menunggu retur* dan dikembalikan bersama penjemputan merek berikutnya, sesuai **nota retur** (§8.6) | Tidak, unit keluar dari hub |
| **Hapus stok** (penghapusan stok) | SPV mengusulkan, Ops HQ menyetujui, Ops Head menyetujui | Staf scan keluar unit sebagai barang dibuang | Tidak |

3. **Staf · WMS station → Tugas → Kembalikan dari karantina**

<!--screen:karantina-task-->

   Ambil unit dari baki, scan, taruh di bin yang ditunjuk WMS, lalu scan bin-nya.

   ✓ Yang terlihat: unit kembali menjadi stok yang bisa dijual saat bin di-scan.

4. **Staf · setelah Ops Head menyetujui penghapusan stok → Tugas → Musnahkan**

   Scan keluar unit sebagai barang dibuang.

Barang yang ada di baki lebih dari 24 jam tanpa keputusan akan ditandai ke SPV; lebih dari 7 hari, ditandai ke Ops HQ.

### 11.3 Satu alur untuk setiap masalah stok

1. **Lapor.** Siapa pun menekan *Laporkan masalah*, memilih alasan, produk, dan jumlah, lalu menambahkan foto jika bisa (§11.1).
2. **Karantina.** Unit langsung keluar dari stok yang bisa dijual dan masuk ke `KARANTINA` (satu baki per hub), kecuali *salah tempat* dan *ditemukan*, yang langsung masuk ke bin yang benar.
3. **Putuskan.** SPV memutuskan dalam 24 jam: **kembali ke stok**, **write-off**, atau **retur ke merek**.
4. **Sahkan.** SPV mengusulkan write-off, Ops HQ menyetujuinya, dan Ops Head menandatanganinya, setiap kali, berapa pun besarnya.
5. **Tinjau.** Setiap bulan Ops HQ melihat write-off berdasarkan alasan, SKU, hub, dan orang; retur ke merek masuk ke daftar retur merek berikutnya bersama Surat Jalan.

### 11.4 Karantina, langkah demi langkah **[DIPUTUSKAN 25 Sep]**

| Langkah | Siapa | Apa | Stok |
|---|---|---|---|
| 1. Lapor | Siapa pun | *Laporkan masalah*, alasan, produk, jumlah, foto; unit masuk ke `HUB-KARANTINA` | Langsung keluar dari stok yang bisa dijual |
| 2. Putuskan | SPV, dalam 24 jam | Kembali ke rak, retur ke merek, atau write-off | Tidak berubah |
| 3a. Kembali ke rak | Staf, lewat tugas | *Kembalikan dari karantina*: ambil dari baki, scan unit, scan bin yang ditentukan WMS | Bisa dijual lagi saat bin di-scan |
| 3b. Retur ke merek | Staf, saat driver merek datang | Unit menunggu di baki sebagai *Menunggu retur*; staf men-scan keluar sesuai nota retur (§8.6), nota retur yang ditandatangani driver | Keluar dari hub |
| 3c. Write-off | SPV mengusulkan, Ops HQ menyetujui, Ops Head menandatangani, lalu staf | Staf men-scan keluar sebagai dibuang | Keluar dari ledger |

Tidak ada yang kembali dari karantina hanya dengan klik SPV: unit baru dihitung sebagai stok lagi setelah staf men-scan-nya ke bin. Keputusan yang belum diambil dalam 24 jam memberi tanda ke SPV; jika belum juga dalam 7 hari, tanda masuk ke Ops HQ.

### 11.5 Persetujuan **[DIPUTUSKAN 28 Sep]**

**Tidak ada batas write-off.** Setiap write-off, berapa pun besarnya, butuh tiga orang dengan urutan ini: **SPV** mengusulkannya, **Ops HQ** menyetujuinya, **Ops Head** menandatanganinya. Setiap langkah dilakukan orang yang berbeda, dan masing-masing bisa mengembalikannya dengan catatan. Sampai Ops Head menandatangani, unit tetap di karantina. *Kembali ke rak* dan *retur ke merek* tetap menjadi keputusan SPV.

### 11.6 Alasan dan siapa yang menanggung biaya

| Alasan | Kapan ditemukan | Diteruskan ke | Biaya ditanggung |
|---|---|---|---|
| Tiba rusak, kurang, atau salah | Saat penerimaan, dalam 24 jam | Selisih kiriman (§4.4) | Merek |
| Rusak di hub | Kapan saja | Karantina | Ninja |
| Kemasan cacat (bocor, segel) tanpa sebab dari penanganan | Kapan saja | Karantina | Merek |
| Kedaluwarsa atau terlalu dekat untuk dijual | Pick, hitung stok, putaway | Karantina, retur ke merek | Merek (syarat perlu dikonfirmasi) |
| Salah tempat | Pick, hitung stok | Dipindah ke bin yang benar | Tidak ada |
| Ditemukan | Di mana saja | Kembali ke stok setelah dicek SPV; membatalkan kekurangan sebelumnya jika ada | Tidak ada |
| Hilang | Pengesahan hitung stok, atau kekurangan yang tidak pernah ditemukan | Di-write-off saat pengesahan hitung stok | Ninja |
| Dikembalikan driver, utuh | Meja serah terima | Kembali ke rak, unit per unit | Tidak ada |
| Dikembalikan driver, rusak | Meja serah terima | Karantina | Perlu dikonfirmasi ke Grab |

### 11.7 Hal terbuka

- **Klaim ke merek dan ke Grab.** WMS mencatat siapa yang menanggung biaya (§11.6), tapi tidak klaimnya: bagaimana klaim ke merek (datang rusak, kurang, kemasan cacat) atau ke Grab (rusak saat diantar, Q6) diajukan, dengan bukti apa, paling lambat kapan, dan bagaimana diselesaikan. Penyelesaian pembayaran di luar WMS (§20).
- **Pemusnahan.** Cara memusnahkan kosmetik yang dihapus dari stok, dan apakah merek ingin barangnya dikembalikan saja.
- **Aturan foto** untuk laporan: apa yang harus terlihat, dan jangan pernah slip pengiriman (ada nama pelanggan).
- **Hampir kedaluwarsa.** Tanda muncul 90 hari sebelum ED (§5.5.3). Tindakan SPV setelahnya tergantung Q5.

## 12. Bahan habis pakai dan infrastruktur

**Siapa**: SPV, Ops HQ, procurement · **Sistem**: sebagian besar di luar WMS · **Di dev**: belum ada

### 12.1 Perangkat dan siapa memegangnya

Hub pilot mengambil dan mengemas barang di **lantai 2**, lalu menyerahkannya di **meja di lantai bawah**. Setiap perangkat punya satu tugas dan satu tempat. **Setiap orang masuk dengan akunnya sendiri** di perangkat mana pun yang dipakai (login Hiryu miliknya sendiri dan login Google WMS miliknya sendiri), saat shift mulai, dan keluar saat shift selesai.

<!--screen:hub-devices-->

| Perangkat | Per hub | Tempatnya | Dipakai untuk | Dipegang oleh | Pengisian daya |
|---|---|---|---|---|---|
| **Laptop kemas** (dari kit) | 1 | Meja kemas, lantai atas | Live Orders Hiryu dan *Accept*; *Siap dikemas* dan *Selesai dikemas* di WMS; pemeriksaan dan unggahan SPV | Staf yang memantau Hiryu dan mengemas; SPV | Dicolok sepanjang hari |
| **Printer struk** (dari kit) | 1 | Di sebelah laptop | Slip kemas Hiryu, tercetak saat *Accept* | Tidak ada: berjalan sendiri | Dicolok |
| **Printer A4** (sudah ada di stasiun) | 1 | Stasiun | Label (§3.1, §3.2), nota retur (§8.6) | SPV | Dicolok |
| **HP hub untuk picking**, dengan WMS terpasang, dan **scanner 2D nirkabel** dari kit yang terhubung ke HP itu | 1 + 1 | Dibawa | Picking, putaway, penerimaan, hitung stok, *Laporkan masalah* | Picker yang sedang bertugas; diserahkan saat ganti shift | Di meja kemas saat malam |
| **HP hub untuk serah terima** (atau tablet) | 1 | Meja serah terima, lantai bawah | *Serah ke driver*, rak siap ambil | Siapa pun yang membawa tas ke bawah | Di meja serah terima |

- **Satu laptop, banyak orang.** Pengaturan printer di laptop tetap tersimpan, siapa pun yang masuk, karena Hiryu menyimpan printer per browser, bukan per orang. Hanya orang yang sedang memakai laptop yang masuk. Orang berikutnya mengeluarkan akun orang sebelumnya, lalu masuk dengan akunnya sendiri.
- **Dua orang bertugas** (target 5 menit): satu orang mengambil barang dengan HP picking, satu orang lagi menekan Accept di Hiryu, mengemas di laptop, lalu membawa tas ke bawah. **Satu orang bertugas**: dia mengerjakan keduanya, dengan urutan yang sama, dan membawa HP picking ke bawah.
- **Rak siap ambil ada di lantai bawah**, di sebelah meja serah terima, supaya driver tidak pernah menunggu orang yang sedang di tangga.
- **Wi-Fi harus sampai ke kedua lantai.** Data seluler HP picking menjadi internet cadangan (§14.1).
- **Saat buka**, SPV mengecek setiap perangkat sudah terisi daya, sudah keluar dari akun kemarin, dan scanner sudah terhubung (§13).
- **Perangkat yang hilang atau rusak** dilaporkan ke SPV di hari yang sama. SPV memberi tahu Ops HQ, yang kemudian menggantinya.
- **Untuk pengadaan:** kit berisi satu laptop, satu printer struk, dan satu scanner per hub. Rencana ini menambah **dua HP Android per hub** (picking dan serah terima), masing-masing dengan lanyard atau holder dan charger. Sesi pengadaan yang menindaklanjutinya.

### 12.2 Hal terbuka

- **Bahan habis pakai.** Tas kertas, kardus, lakban, gulungan kertas struk, lembar stiker A4, stiker warna hari, sekat, bin (JX-2, JX-4), baki karantina dan formulir catatan kertas. Belum ditulis: berapa banyak di tiap hub, siapa yang memesan ulang, disimpan di mana. *Usulan:* jumlah minimal per barang per hub, dicek di rutinitas mingguan SPV; WMS bisa menghitung tas dan kardus yang terpakai dari aturan kemasan.
- **Cek infrastruktur sebelum go-live.** Wi-Fi di kedua lantai, stop kontak di meja kemas dan meja serah terima, pakai UPS atau tidak, rak terpasang.
- **Procurement** berjalan di sesinya sendiri; dua HP per hub (§12.1) ditambahkan di sana.

## 13. Rutinitas shift

**Siapa**: SPV · **Sistem**: WMS, dan Hiryu untuk jeda · **Di dev**: belum (*Perlu tindakan*, laporan akhir hari)

### 13.1 Selama shift: yang dipantau SPV

- **Perlu tindakan** (§13.5): daftar milik SPV, yang paling lama dan paling mendesak di atas. Selesaikan satu per satu selama shift.
- **Barang tidak ada**: setiap kejadian ada di daftar, dengan nama picker-nya (§8.3). Cek bin-nya dan rencanakan hitung khusus.
- **Sambungan**: *Integrasi Hiryu* menunjukkan 0 menunggu dan 0 gagal (§9.3). Jika tidak, beri tahu Ops HQ.
- **Serah ke driver**: tas yang berwarna kuning selama 20 menit atau lebih. Cek pesanannya di Hiryu.

### 13.2 Jeda hub di Grab

**Pause this hub on Grab** ada di halaman dark store di Hiryu. Tombol ini menghentikan pesanan baru di **semua toko yang dilayani hub** (Kahf dan Labore sekaligus) selama 30 menit, 1 jam, atau 24 jam. Pesanan yang sudah masuk tetap berjalan, dan Grab buka lagi sendiri setelah waktunya habis.

| Jeda jika | Berapa lama |
|---|---|
| Pesanan masuk lebih cepat daripada kemampuan hub mengemas: dua pesanan atau lebih berstatus *Late* di Live Orders | 30 menit |
| WMS atau internet mati lebih dari 15 menit (§14.1) | 1 jam, lalu cek lagi |
| Orang di shift tidak cukup, atau ada keadaan darurat di hub (listrik, banjir, keselamatan) | 1 jam atau 24 jam |

1. **SPV (atau Ops HQ jika SPV tidak bisa) · Hiryu dulu → Dark stores → hub tersebut → Pause this hub on Grab**

   Pilih waktunya, lalu tekan **Pause**.

   ✓ Yang terlihat: *Every store in this shop is paused on Grab*, dengan jam jedanya berakhir.

2. **SPV · lalu WMS → Laporan akhir hari → Masalah hari ini**

   Catat jeda itu dan alasannya.

3. **Untuk membuka lebih awal** · tombol yang sama di Hiryu, **Resume**.

Jeda untuk **satu merek saja** tidak bisa dilakukan di sini. Untuk menghentikan satu merek, atur stok SKU merek itu ke 0 saat mengetik stok (§9.3).

### 13.3 Akhir hari

**Siapa:** SPV, di laptop kemas, setelah pesanan terakhir.

1. **SPV · WMS → Laporan akhir hari**

   ✓ Yang terlihat: setiap pesanan yang diterima hub hari ini menurut statusnya, dan pesanan yang sudah di-Accept tapi belum diserahkan.

2. **SPV · setiap pesanan yang masih terbuka**

   Cek di Hiryu: selesaikan, atau jika Grab membatalkannya, pastikan pembatalannya sudah sampai ke WMS (§8.2).

3. **SPV · Perlu tindakan**

   Selesaikan yang bisa diselesaikan hari ini; sisanya dibawa ke besok dengan catatan di **Masalah hari ini**.

4. **SPV · WMS → Integrasi Hiryu**

   ✓ Yang terlihat: 0 menunggu dan 0 gagal.

5. **SPV · perangkat**

   Semua orang keluar dari Hiryu dan WMS; HP dan scanner diisi dayanya (§12.1).

### 13.4 Laporan akhir hari **[DIPUTUSKAN 25 dan 30 Sep]**

Satu layar per hub, **Laporan akhir hari**:

| Tab | Isi |
|---|---|
| **Pesanan hari ini** | Setiap pesanan yang dikirim Hiryu hari ini, menurut status (§6.11), yang masih terbuka di atas |
| **Masalah hari ini** | Laporan, keputusan, barang tidak ada, semua yang masih terbuka, dan catatan SPV untuk besok |
| **Penjualan** | Unit terjual per SKU hari ini; menjadi masukan laporan merek (§15.1) |

Bisa diunduh sebagai CSV. Cek pesanan lewat copy dan paste dan tab stok dari build pertama sudah tidak dipakai: pesanan dan stok sekarang keluar masuk lewat sambungan (§0.6).

### 13.5 Perlu tindakan: yang harus diselesaikan setiap peran **[DIPUTUSKAN 30 Sep]**

Setiap peran punya daftar **Perlu tindakan** di bagian atas menu WMS, dengan angka jumlahnya. Daftar ini hanya menampilkan yang harus diselesaikan orang itu, yang paling mendesak di atas. Setiap baris membuka layar tempat hal itu diselesaikan, dan hilang setelah selesai. Hal yang lewat waktunya berubah kuning dan juga muncul di daftar peran berikutnya.

<!--screen:todo-inbox-->

| Peran | Yang perlu diselesaikan | Dari | Dalam | Lalu ke |
|---|---|---|---|---|
| **Staf** | Pesanan yang diberikan kepadaku untuk diambil | §6.2 | 2 menit untuk mulai | Kembali ke antrean |
| **Staf** | Pesanan yang menunggu dikemas | §6.4 | Segera | SPV |
| **Staf** | Bin sementara yang menunggu putaway | §5.1 | Shift yang sama | SPV |
| **Staf** | *Kembalikan ke rak* (pesanan dibatalkan) | §8.2 | 2 jam | SPV |
| **Staf** | Bin yang dihitung hari ini; *Pindahkan stok*; tugas dari karantina | §10.1.1, §3.3.1, §11.2 | Hari yang sama | SPV |
| **Staf** (serah terima) | Tas yang menunggu driver | §7.1 | Kuning di menit ke-20 | SPV |
| **SPV** | Draf restock yang perlu diajukan ke Ops HQ | §4.1 | 4 jam | Ops HQ |
| **SPV** | Faktur yang perlu diunggah setelah inbound | §5.3.8 | 24 jam | Ops HQ di jam ke-48 |
| **SPV** | Selisih saat penerimaan yang perlu diajukan: kurang, rusak, lebih | §4.4 | 24 jam (batas waktu klaim, §5.3.7) | Ops HQ |
| **SPV** | Keputusan karantina | §11.2 | 24 jam | Ops HQ di hari ke-7 |
| **SPV** | Pertanyaan bin kedua | §4.2 | 4 jam | Ops HQ |
| **SPV** | Hasil hitung yang perlu diperiksa | §10.1.1 | 24 jam | Ops HQ |
| **SPV** | Barang tidak ada yang dinyatakan hari ini, dengan nama picker-nya | §8.3 | Hari yang sama | |
| **SPV** | Pesanan yang belum dimulai atau terlambat; tas yang belum diambil | §6.2, §7.2.3 | Segera | |
| **SPV** | Masalah sambungan: pesan yang menunggu lebih dari 5 menit | §9.3 | Segera | Ops HQ |
| **Ops HQ** | Restock yang diajukan SPV: buat PO | §4.1 | Hari yang sama | Ops Head |
| **Ops HQ** | PO sudah dikirim, merek belum konfirmasi | §4.1 | 24 jam | |
| **Ops HQ** | Kiriman tanpa AWB tercatat | §5.2 | Segera (driver menunggu) | |
| **Ops HQ** | Tanggal kedaluwarsa yang perlu diisi dari Faktur yang diunggah | §4.1 langkah 7 | 24 jam | |
| **Ops HQ** | Unit lebih yang perlu diselesaikan dengan merek | §4.4.6 | 2 hari kerja | Ops Head |
| **Ops HQ** | Selisih dan penghapusan stok yang perlu disetujui | §4.4, §10.1, §11.5 | 24 jam | Ops Head |
| **Ops HQ** | Produk tak dikenal dari inbound | §2.8 | 24 jam | |
| **Ops HQ** | SKU yang perlu dilengkapi; item tanpa SKU di Hiryu | §2.2.5, §2.2.6 | Sebelum restock pertama; segera | |
| **Ops HQ** | Kegagalan sambungan | §0.6 | Segera | Shaun |
| **Ops Head** | Selisih dan penghapusan stok yang menunggu persetujuan terakhir | §4.4, §10.1, §11.5 | 48 jam | |

- **13.5.1** SPV melihat hub miliknya sendiri; Ops HQ dan Ops Head melihat semua hub, dengan filter hub.
- **13.5.2** *Perlu tindakan* adalah tempat setiap orang memulai hari. *Pengingat & flag* tetap ada untuk pengaturan di balik waktu-waktu ini (§4.7).
- **13.5.3** Waktu di atas adalah pengaturan yang bisa diubah Ops HQ (§4.8).

### 13.6 Hal terbuka

- **Daftar cek buka toko.** Belum ditulis: login, perangkat terisi daya, kertas printer, cek *Perlu tindakan* dan baki karantina, cek sambungan (§9.3), lalu buka.
- **Jam kerja dan shift** untuk pilot, serta serah terima antar shift atau antar SPV.
- **Istirahat saat hanya satu orang bertugas**: jeda hub atau tidak.
- **Tugas mingguan dan bulanan SPV.** Tugasnya tersebar di beberapa bagian (hitung rutin §10.1, bahan habis pakai §12, cetak ulang label §3). Satu kalender akan membantu.

## 14. Gangguan sistem dan rencana cadangan

**Siapa**: semua yang bertugas, SPV, Ops HQ · **Sistem**: Hiryu (jeda), WMS · **Di dev**: tidak ada yang perlu dibangun: hub dijeda

### 14.1 Jika sistem mati

**Tidak ada jalur manual** *(diputuskan 30 Sep)*: tidak ada catatan kertas dan tidak ada copy dan paste. Jika pesanan tidak bisa mengalir, hub dijeda di Grab.

| Apa yang mati | Tandanya | Lakukan ini |
|---|---|---|
| **WMS** | WMS tidak bisa dibuka atau menampilkan *Tidak terhubung* | **Jeda hub** di Grab selama 1 jam (§13.2). Selesaikan pesanan yang sudah diambil. Beri tahu Ops HQ |
| **Sambungan** | Pesanan yang sudah di-Accept tidak sampai ke WMS dalam satu menit, atau *Integrasi Hiryu* menampilkan pesan yang menunggu lebih dari 5 menit | Jeda hub selama 1 jam. Ops HQ menghubungi Shaun |
| **Internet di hub** | Hiryu dan WMS sama-sama tidak bisa dibuka | Sambungkan laptop ke **data seluler HP picking**. Jika itu juga gagal, telepon Ops HQ: mereka menjeda hub dari kantor |
| **Hiryu** | Hiryu tidak bisa dibuka; tidak ada pesanan baru | Tidak ada yang perlu diambil. Telepon Ops HQ, yang akan menghubungi Shaun Cong |
| **Listrik** | Laptop memakai baterai, printer mati | Lanjutkan kerja dengan baterai; tulis nomor GM di setiap tas dengan tangan. Jeda hub jika listrik tidak menyala lagi dalam 30 menit |
| **Printer struk** | Slip tidak keluar | Tulis nomor GM di tas; pesan gulungan kertas baru atau laporkan printernya |

**Setelah pulih:**

1. **SPV · WMS → Integrasi Hiryu**

   ✓ Yang terlihat: pesan yang menunggu sudah terkirim dan **0 gagal**. WMS mengirim snapshot stok penuh dengan sendirinya (§9.4.4).

2. **SPV · WMS → Laporan akhir hari → Pesanan hari ini**

   Cek setiap pesanan yang di-Accept selama gangguan sudah sampai ke WMS. Jika ada yang belum, beri tahu Ops HQ sebelum membuka jeda.

3. **SPV · Hiryu → hub tersebut → Resume** untuk mengakhiri jeda (§13.2).

### 14.2 Hal terbuka

- **Daftar kontak** di meja kemas: siapa yang dihubungi untuk Hiryu (Shaun Cong), dukungan merchant Grab, Ops HQ yang bertugas dan IT, dengan nomornya.
- **Jeda otomatis**: apakah Hiryu menjeda hub dengan sendirinya jika WMS tidak menjawab (§0.6.4 butir 5).
- **Masalah di sisi Grab** (Grab berhenti mengirim pesanan, menu tidak mau sinkron) belum dibahas.

## 15. Laporan ke merek

**Siapa**: Ops HQ · **Sistem**: WMS, lalu email · **Di dev**: belum. File Excel mingguan dan bulanan sudah dispesifikasikan (§15.1)

### 15.1 Laporan penjualan ke merek **[DIPUTUSKAN 30 Sep]**

Ninja mengirim laporan **mingguan** dan **bulanan** ke setiap merek dalam bentuk **file Excel berbahasa Inggris**. Laporan ini dibuat oleh WMS (*Laporan merek*) dan dikirim lewat email oleh Ops HQ ke kontak merek.

| Laporan | Mencakup | Dikirim |
|---|---|---|
| **Mingguan** | Senin sampai Minggu | Setiap Senin pukul 10:00 WIB |
| **Bulanan** | Satu bulan kalender | Pada hari kerja ke-3, setelah hitung penuh akhir bulan disetujui (§10.1) |

**Sheet**:

- **Summary**: period, hubs, reference, dan date made; per hub dan total: units sold, sales value, orders, orders cancelled because an item was out of stock, stock at the end, units per order, dan share cancelled.
- **Sales by SKU**: satu baris per SKU per hub: hub, SKU code, barcode, product, size, menu price, units sold, sales value, stock at the end, average sold per week, weeks of cover, dan kolom bebas **Notes**.
- **Stock and deliveries** (hanya laporan bulanan): per hub, opening stock, received, sold, returned to the brand, written off, expected, counted at month end, dan difference; lalu kiriman yang diterima (AWB, date, hub, requested, sent, received, difference, PO number) serta retur dan penghapusan stok (reason, units, who bears the cost).

**Asal angka-angkanya**: unit dan **nilai penjualan dari setiap baris pesanan yang dikirim Hiryu** (harga item pada hari itu, §0.6.1 pesan 1), tanpa pesanan yang dibatalkan; stok, kiriman, retur dan penghapusan stok dari ledger WMS; stok hasil hitung dari hitung penuh akhir bulan. WMS tidak mengambil uang dari pesanan (§0.3.11): harganya adalah harga menu, sebelum komisi Grab dan promosi.

Tata letak: `docs/templates/Brand Sales Report - Kahf - Weekly.xlsx` dan `… - Monthly.xlsx`.

### 15.2 Hal terbuka

- **Siapa penerimanya.** Untuk Kahf dan Labore (model 3PL Grab), hanya merek, atau merek dengan Grab di tembusan (cc) (§2.11.3)?
- **Angka bersih.** Komisi dan promosi Grab tidak ada di WMS. Apakah merek juga butuh jumlah setelah dipotong keduanya, dan siapa yang menyediakannya?
- **Pembatalan karena barang habis.** Ditunjukkan ke merek (biasanya ini masalah hitung stok atau restock), atau hanya untuk internal?
- **Penagihan.** Unit terjual menentukan tagihan. Penyelesaian pembayaran di luar WMS (§20), tapi laporannya harus sama dengan yang dipakai bagian keuangan.

# Bagian C. Status dan keputusan

## 16. Status build

Per 30 September 2026. **Dev** = sudah di wms-test--dev untuk diuji (build pertama, 28 Sep). **Sudah dibuat** = ada di aplikasi dari build sebelumnya. Belum ada yang di produksi.

| Proses | Di dev atau sudah dibuat | Belum |
|---|---|---|
| 0. Sambungan Hiryu | Menerima pesanan dan pembatalan; antrean pesan 3 sampai 5; halaman integrasi | Pengirim pesan 3 sampai 5; penerima katalog (pesan 6); jalur publik di Substrait; hal-hal yang dibahas dengan Shaun (§0.6.4) |
| 1. Login dan akses pengguna | Login Google, daftar pengguna | Peran Ops Head dengan persetujuan terakhir; SPV hanya menambah staf; hanya akun @ninjavan.co |
| 2. Pendaftaran dan pengaturan toko | Dev: *Menu & toko Hiryu* (unggah CSV menu, akan diganti katalog dari Hiryu) | *Lengkapi data SKU*; satu menu per toko; form merek; scan konfirmasi barcode |
| 3. Pengaturan rak | Rak dan bin, satu bay; peta hub | Rak dimasukkan sesuai hitungan; lembar label A4; *Cek label*; *Pindah bin*; bin inbound sementara; baki karantina sebagai lokasi |
| 4. Restock dan batas stok | Permintaan restock, persetujuan selisih, pengingat, draf otomatis | *Ajukan ke Ops HQ*; *Buat PO* dengan header yang bisa diedit dan Excel PO dengan barcode; ED dari Faktur; unit atau %; isi maks. per bin yang dipelajari; selisih tiga langkah |
| 5. Barang masuk dan penyimpanan | Terima per AWB dalam batch, daftar penyimpanan, produk tak dikenal ke HQ | *Unggah Faktur*; unit lebih diajukan ke Ops HQ; umur stok dari tanggal inbound; kiriman tanpa AWB tercatat |
| 6. Ambil dan kemas | Dev: ambil terpandu, batas siap 10 menit, nomor GM di layar ambil; tempel (akan dimatikan) | Pesanan dari Hiryu; penugasan otomatis (*Siap ambil*); *Selesai dikemas* mengirim pesanan siap; aturan kemasan; jalur *Terjadwal* |
| 7. Serah ke Grab | Dev: *Kemas & serah ke driver* (layar 21) | Tanda dibatalkan di tas yang menunggu |
| 8. Pembatalan dan retur | Dev: barang tidak ada (cek tempat lain), kembalikan ke rak | Barang kurang dan pembatalan lewat sambungan; kembalian dari driver; surat jalan retur; retur ke merek |
| 9. Stok ke Hiryu | Antrean pesan stok | Mengirimnya; snapshot setiap malam; *terkirim ke Hiryu* di halaman SKU |
| 10. Stock opname | Hitung buta, hitung ulang, persetujuan | Rencana hitung; persetujuan tiga langkah |
| 11. Klaim dan karantina | | Semua di §11 |
| 12. Bahan habis pakai dan infrastruktur | | Di luar WMS untuk saat ini |
| 13. Rutinitas shift | | *Perlu tindakan*; laporan akhir hari |
| 14. Gangguan sistem | | Tidak ada yang perlu dibangun: hub dijeda |
| 15. Laporan ke merek | | Laporan Excel mingguan dan bulanan (*Laporan merek*) |

**Berikutnya**: sepakati §0.6 dengan Shaun; lalu deploy (2) sambungan di sisi WMS, pendaftaran dan peran, *Lengkapi data SKU*, alur PO dan *Perlu tindakan*; (3) karantina dan persetujuan, umur stok dan ED, gambar rak dan label, kemasan, laporan akhir hari dan laporan merek.

## 17. Keputusan

| Topik | Keputusan |
|---|---|
| Gudang pusat (Logos) | Tidak masuk build pertama |
| Tata letak rak | Rak, bay, level, dan posisi bisa diatur; tumpukan dari ukuran bin (§3.4) |
| Serah terima | WMS mencatat pengambilan oleh driver Grab (§7.2) |
| Stok kembali ke Hiryu | WMS menampilkan daftarnya; SPV mengetiknya (§9.4, §13.4) |
| Merek saat go-live | Kahf dan Labore; 105 SKU setelah cek ulang (Lampiran B) |
| Pemilik stok | Selalu merek; model listing per merek (§2.11) |
| Pendaftaran SKU | Termasuk barcode, ukuran bin, data kemasan opsional, dan isi maks. per bin (§2.6) |
| Bin max (isi maks. per bin) | Dipelajari dari jawaban SPV soal bin kedua (§4.6) |
| Ambil kurang | Ditulis ulang dengan bahasa sederhana (§8.3) |
| Kemasan | Hanya tas kertas dan karton; aturan dan asumsinya dijelaskan (§6.10) |
| PRD Malaysia | Belum digabung untuk saat ini |
| Stok Grab | Berkurang saat ada pesanan, tidak dikembalikan saat batal (§6.5.5) |
| Pengiriman rider | Di luar cakupan WMS |
| Cadangan Grab | Ditetapkan oleh Ninja (§9.5) |
| WhatsApp | Build berikutnya di dalam WMS, setelah peluncuran (§19) |
| Restock | Merek langsung ke dark store; gudang pusat dan crossdock nanti |
| Pengecualian | Sudah dirancang (§11) |
| Keamanan | Tinjauan keamanan Substrait saat deploy |
| Data kemasan | Diminta dari merek, tidak wajib (Lampiran B) |

**Putaran kedua, 25 September**

| Topik | Keputusan |
|---|---|
| Pendaftaran | Superadmin dan Ops HQ mendaftarkan dark store dan pengguna serta memberi peran; SPV hanya mendaftarkan staf (§1.2) |
| Pembuat rak | Gambar berskala, bukan tabel, supaya SPV bisa memutuskan dengan melihat (§3.2) |
| Kode SKU Hiryu | Kolom di SKU, dipakai oleh lembar stok (§2.6) |
| Angka stok | Nama sederhana dengan contoh: isi maks. per bin, pesan ulang saat sisa, isi sampai, batas kritis, cadangan Grab (§4.5) |
| Pengiriman tanpa AWB tercatat | Staf memasukkannya dan menghitung; Ops HQ mendapat tanda lalu menautkannya (§4.4.2) |
| Bin inbound sementara | Disiapkan bersama dark store, sebagai lokasi yang tidak bisa dijual (§2.5.2) |
| Pengemasan | Tidak ada label untuk di-scan: slip Hiryu adalah desain Grab. *Mark ready* di Hiryu dulu, lalu *Sudah Mark ready di Hiryu* di WMS (§6.9) |
| Barang tidak ada | Ditandai sampai Grab memutuskan: batalkan semua, atau kirim yang ada. Sementara itu SPV yang memutuskan (§8.3). *Diganti 28 Sep: barang yang tidak ada membatalkan seluruh pesanan* |
| Pesanan dibatalkan | Satu tombol, *Dibatalkan di Hiryu* (§8.4) |
| Karantina | SPV memutuskan, staf memindahkannya lewat tugas yang di-scan, stok kembali saat scan bin (§11.4) |

**Putaran ketiga, 28 September**

| Topik | Keputusan |
|---|---|
| Satu dokumen | Bagian A sekarang juga mencakup Hiryu: persiapan, SKU, menu, menghubungkan ke Grab, mengetik stok (§0.4 sampai §2.4, §9) |
| Bin inbound sementara | Disiapkan oleh SPV; satu label per bin (§3.1) |
| Baki karantina | Dibuat otomatis untuk setiap hub; tidak bisa dimatikan (§2.5.2) |
| Siapa yang mendaftarkan | Ops HQ mendaftarkan hub dan orang-orangnya; SPV menyiapkan area inbound dan menambah staf |
| Merek | Ditambahkan oleh Ops HQ atau superadmin (§2.7) |
| Angka stok | Dalam unit atau persentase (§4.5.3) |
| Urutan kerja SKU | Hiryu dulu, lalu WMS dengan kode Hiryu (§2.2) |
| Mencatat AWB restock | SPV atau Ops HQ, di permintaan restock: *Catat pengiriman* (§4.1) |
| Penghapusan stok | Tanpa batas. SPV, lalu Ops HQ, lalu Ops Head, setiap kali (§11.5) |
| Stok Hiryu | Dikurangi saat Mark ready, tidak pernah dikembalikan setelah pembatalan; ketik stok saat tidak ada pesanan yang tertunda (§9.4.5) |
| Edit pesanan di Hiryu | Tidak bisa; barang tidak ada secara bawaan dibatalkan dengan 2001 sampai Grab menjawab (§8.3) |
| Akses Hiryu di Indonesia | Pemilik proyek memberikan ADMIN dan EDITOR (§1.4.6) |
| Hiryu dulu | Di setiap langkah yang menyentuh kedua sistem, Hiryu dulu, lalu WMS (§0.3.12) |

**Putaran keempat, 28 September**

| Topik | Keputusan |
|---|---|
| Batas waktu siap | 10 menit sejak pesanan masuk ke Hiryu (§6.5.2) |
| Barang tidak ada | Grab tidak mengizinkan perubahan pesanan: barang yang tidak ada membatalkan seluruh pesanan, alasan 2001 (§8.3) |
| Perangkat | Satu laptop di meja kemas, ponsel hub dengan scanner untuk pengambilan, satu ponsel di meja serah terima; setiap orang memakai login sendiri (§12.1) |
| Pengiriman pertama | Diterima lewat alur inbound biasa, dalam beberapa batch: diterima sebagai risiko yang sudah diketahui, karena inbound dirancang untuk hub yang sudah berjalan |
| Toko Grab yang sudah ada | Listing Kahf dan Labore Official Store akan dipindahkan oleh Grab atau merek ke toko hub |
| Sistem mati | §14 |
| Pesanan terjadwal | Batas waktu siap dihitung dari waktu terjadwal (§6.5.2a) |
| Terima manual | WMS mengikuti Hiryu: tekan Accept di Hiryu dulu (§6.5.2b) |
| Jeda hub | Ditambahkan ke langkah SPV (§13.2) |
| SOP stok | Kapan mengetik, bagaimana caranya, kapan menghitung (§9) |
| Foto bukti | Akan diambil di Hiryu (§7.2.4) |
| Tautan item | Disimpan di Hiryu dan WMS; diubah di Hiryu dulu, di hari yang sama, dicek setiap bulan (§2.3) |
| Nilai sell-out | Harga item di Hiryu (§15.1) |
| Surat Jalan retur | Dicetak dari WMS (§8.6) |
| Kedaluwarsa | Dicatat per batch saat penerimaan (§5.5) |
| Catatan pelanggan | Dibuang oleh pembaca tempel (§6.6.2) |
| Login | Setiap orang memakai akunnya sendiri di perangkat mana pun (§12.1) |
| Cadangan Grab | 1 unit per SKU secara bawaan (§9.5) |
| Siapa yang mengetik stok | Hanya SPV (§9.4.4) |
| Huruf kode SKU | Dicocokkan tanpa melihat huruf besar atau kecil (§2.12) |
| Hitung stok dan selisih pengiriman | SPV, lalu Ops HQ, lalu Ops Head (§4.4, §10.2.3) |

**Pesanan terpisah (split order)**, penjelasannya: satu pesanan pelanggan dipenuhi dari **dua dark store** (atau dua bagian dikirim terpisah) karena tidak ada hub yang punya semua barangnya. Ini butuh dua rider untuk satu keranjang kecil, jadi biayanya lebih besar dari pendapatannya. WMS tidak memisah pesanan. Untuk Grab hal ini tidak pernah terjadi, karena satu pesanan Grab milik satu toko, berarti juga satu hub.

**Putaran kelima, 29 September**

| Topik | Keputusan |
|---|---|
| Dokumen | Disusun per proses: Bagian A dasar, Bagian B lima belas proses, Bagian C status dan keputusan. Setiap proses diakhiri hal terbuka |
| Pengaturan toko | Pengaturan toko Hiryu dan Grab digabung dengan pendaftaran hub, merek dan SKU (§2) |
| Stok keluar dari hub | Retur ke merek, penarikan (recall) dan perpindahan antar hub digabung dengan pembatalan dan retur (§8) |
| Pelatihan | Bukan proses tersendiri |

**Putaran keenam, 30 September**

| Topik | Keputusan |
|---|---|
| Instruksi | Setiap langkah berupa kartu langkah: siapa, di mana, apa yang dilakukan, apa yang harus terlihat. Istilah baru dijelaskan di tempat pertama kali muncul, bersama pekerjaan fisiknya |
| Peta proses | Peta yang bisa diklik di antara Bagian A dan Bagian B, per pemilik dan fase, dengan jalan kembali dari setiap bagian |
| Urutan persiapan | Hub dan pengguna, lalu rak, lalu merek, lalu menu, lalu SKU, lalu tautkan dan aktifkan di Grab, lalu pengiriman pertama, stok awal dan pesanan uji (§0.4) |
| Menu | Satu menu Hiryu per toko, menu kedua dibuat dengan menyalin menu pertama (§2.2.3) |
| SKU | Dibuat di WMS dari unggahan menu Hiryu; angka stok dilengkapi sesudahnya sekaligus (§2.2.5, §2.2.6) |
| Rak | Tanpa tipe rak: SPV mendaftarkan setiap rak sesuai kondisinya dan mencetak label A4 dengan garis potong (§3.2) |
| Akun | Setiap orang butuh akun Google Ninja Van (@ninjavan.co); akun orang yang keluar ditutup, tidak pernah dialihkan ke orang lain (§1.3.2) |
| Ops Head | Akses sama dengan Ops HQ, ditambah persetujuan terakhir untuk selisih dan penghapusan stok; orangnya ditentukan nanti (§1.2) |
| Merek | Tidak login ke kedua sistem (§1.4.7) |
| Target layanan | Usulan untuk diputuskan Ops (§0.5) |
| Error Hiryu | Disampaikan ke Shaun Cong, pemilik Hiryu (§2.4.6) |
| Listing Grab | Memindahkan listing Official Store yang sudah ada bukan tugas Ninja |
| Tanggal kedaluwarsa | Ditandai: tujuannya mendapatkan data ini dari merek, bukan diketik saat penerimaan (§5.5.1a) |

**Putaran ketujuh, 30 September**

| Topik | Keputusan |
|---|---|
| Sambungan Hiryu | Hiryu dan WMS terhubung lewat API; Shaun membangun sisi Hiryu; hal yang masih terbuka ada di §0.6.4 |
| Menerima pesanan | Keempat toko memakai MANUAL: staf menekan *Accept* di Hiryu, lalu Hiryu mengirim pesanan ke WMS (§6.1) |
| Baris pesanan | Hiryu mengirim kode SKU dan jumlah unit, dihitung dari *Bundles* (§6.6.2) |
| Menu dan SKU | Hiryu mengirimnya ke WMS; unggah CSV tidak dipakai lagi (§2.2.5) |
| Penugasan | WMS memberikan setiap pesanan ke picker siap yang paling lama menunggu (§6.2) |
| Pesanan siap | *Selesai dikemas* di WMS menandai pesanan siap di Hiryu dan Grab (§6.4) |
| Serah terima | Tetap di WMS sebagai cek kedua bahwa driver mengambil tas yang benar (§7) |
| Barang tidak ada | Hiryu membatalkan dengan 2001 dengan sendirinya saat WMS melaporkannya; tanpa langkah SPV (§8.3) |
| Stok | WMS mengirimnya setelah setiap perubahan, sudah dikurangi cadangan Grab; tidak ada yang mengetiknya (§9) |
| Jalur manual | Tidak ada; hub dijeda jika pesanan tidak bisa mengalir (§14) |
| Batas waktu siap | 10 menit sebagai target rata-rata; di luar jam sibuk bisa lebih lama (§6.5.2) |
| PO | SPV mengajukan, Ops HQ membuat dan mengirim PO sebagai Excel dengan barcode; Ops HQ bisa mengedit header-nya (§4.1) |
| Faktur | SPV mengunggah Faktur yang sudah ditandatangani setelah inbound; unit lebih diajukan ke Ops HQ, yang menyelesaikannya dengan merek lewat email (§5.1) |
| Kedaluwarsa | Diketik Ops HQ dari Faktur; jika tidak ada, umur dihitung dari tanggal inbound; tidak pernah diketik saat inbound (§5.5) |
| Rak | Tidak ada daftar rak di dokumen ini: rak ditambahkan di WMS saat dipasang (§3.2) |
| Daftar tugas | *Perlu tindakan* untuk setiap peran (§13.5) |
| Laporan merek | Mingguan dan bulanan, sebagai Excel berbahasa Inggris (§15.1) |
| Tombol satu klik (Q4) | Tidak diperlukan lagi |

## 18. Pertanyaan terbuka

| # | Pertanyaan | Siapa |
|---|---|---|
| ~~Q1~~ | **Terjawab 28 Sep**: Hiryu mengurangi stok saat pesanan ditandai siap (sudah dikemas) dan tidak bisa mengembalikan unit dari pesanan yang dibatalkan (§9.4.5) | |
| ~~Q2~~ | **Terjawab 28 Sep**: Grab tidak mengizinkan perubahan pesanan, jadi barang yang tidak ada membatalkan seluruh pesanan (§8.3) | |
| ~~Q3~~ | **Terjawab 28 Sep**: login staf hub bisa membuka halaman pesanan (sesuai aturan halaman Hiryu sendiri). Prefiks ID item tidak masalah (§6.6.2) | |
| Q4 | **Dengan bahasa sederhana**: selain salin dan tempel, tombol bookmark di Chrome bisa membaca pesanan Hiryu yang terbuka dan mengisi layar tempel WMS dengan satu klik. Tombol ini menjalankan skrip kecil di halaman Hiryu. Apakah NV IT dan tim keamanan mengizinkannya di PC pengemasan hub? | NV IT dan keamanan |
| Q5 | Syarat konsinyasi dengan Kahf dan Labore: stok pengaman, frekuensi restock, pengembalian barang kedaluwarsa dan lambat laku, biaya restock | Grab, Paragon |
| Q6 | Siapa yang menanggung unit yang rusak saat pengiriman dan dikembalikan oleh driver? | Grab |
| Q7 | Apakah Paragon akan memberikan barcode, ukuran kemasan, dan berat (Lampiran B)? | Grab, Paragon |
| Q8 | Batas tas dan karton setelah uji beban (§6.10.3) | Ops |
| Q9 | Ukuran dalam JX-2 dan JX-4 dari sampel pertama (§3.4.3) | Ops |
| ~~Q10~~ | **Terjawab 28 Sep**: Grab tidak mengizinkan pesanan diubah, jadi barang yang tidak ada membatalkan seluruh pesanan dengan alasan 2001 (§8.3) | |
| ~~Q11~~ | **Terjawab 28 Sep**: pemilik proyek bisa memberikan ADMIN Hiryu di Indonesia (§1.4.6) | |
| ~~Q12~~ | **Terjawab 28 Sep**: ya, hitung stok dan selisih pengiriman juga lewat SPV, lalu Ops HQ, lalu Ops Head | |
| Q13 | Tingkat layanan apa yang Grab tetapkan untuk hub (menit dari pesanan sampai siap), dan apa arti *Scheduled time* pada pesanan terjadwal (§6.5.2)? | Grab |
| Q14 | Kapan foto bukti pengemasan di Hiryu siap (§7.2.4)? | Tim Hiryu |
| Q15 | Bisakah Paragon mencantumkan ED per SKU di setiap Surat Jalan (§5.5)? | Grab, Paragon |
| Q16 | Dokumen desain menyebut Hiryu punya pengaturan buffer Grab, tetapi Hiryu saat ini tidak menampilkannya. Apakah Hiryu akan menambahkannya? Sampai saat itu WMS yang menerapkan cadangan (§9.5) | Shaun |

## 19. Build berikutnya

| Build | Kapan | Catatan |
|---|---|---|
| **Tombol satu klik** | Setelah tempel berjalan | §6.6.4 |
| **Sambungan Hiryu (lima pesan)** | Saat tim Hiryu mengerjakannya | Menggantikan tempel dan lembar stok; peta tetap dipakai |
| **Pesanan WhatsApp** | Setelah WMS diluncurkan dan stabil | Awalnya berdiri sendiri di dalam WMS; nanti bisa pindah ke belakang Hiryu. Simulatornya sudah dibangun |
| **Gudang pusat** (Logos) | Nanti | Pemasok ke gudang ke dark store, transfer, pengiriman tote, peran operator hub |
| **Crossdock** | Bersama gudang pusat | Staging dengan batas waktu tinggal |
| **Tanggal kedaluwarsa** | Dipindahkan ke build pertama (§5.5) | |
| **Gabung dengan PRD Malaysia** | Tidak sekarang | |

## 20. Tidak dikerjakan

| Tidak dikerjakan | Alasan |
|---|---|
| Sambungan apa pun ke Grab | Hanya Hiryu yang berkomunikasi dengan Grab |
| Pengiriman rider | Grab menugaskan rider-nya; armada Ninja sendiri di luar WMS |
| Pesanan terpisah | Lihat §17 |
| Data pelanggan | Tidak dibutuhkan untuk ambil atau kemas, dan berisiko jika disimpan (§0.3.11) |
| Memanggil API internal Hiryu | Bukan milik kita, jadi tidak bisa diandalkan; WMS hanya membaca yang bisa dilihat staf |
| Melacak pembatas | FIFO di dalam bin dilakukan dengan mata, dipandu warna |
| Penempatan otomatis (slotting) | SPV menempatkan SKU menurut merek dan kategori |
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
| **Cadangan Grab (Grab buffer)** | *Cadangan Grab*: unit per SKU yang tidak ditampilkan ke Grab, supaya salah hitung tidak berubah menjadi pesanan yang dibatalkan. Bawaannya 1 unit (§9.5) |
| **ED** | Tanggal kedaluwarsa (expiry date) yang tercetak di kemasan; dicatat per batch saat penerimaan (§5.5) |
| **Surat Jalan retur (Return note)** | *Surat Jalan retur*, dicetak dari WMS untuk unit yang dikembalikan ke merek (§8.6) |
| **Bay** | Bagian rak di antara dua tiang tegak |
| **Ukuran bin (bin size)** | Kecil (JX-2) atau Besar (JX-4); satu ukuran per level |
| **Isi maks. per bin** | Berapa unit satu SKU yang memenuhi satu bin; dipelajari sistem (§4.6). Kode: `full` |
| **Pesan ulang saat sisa** | Reorder at: stok yang memicu draf restock. Kode: `R` |
| **Isi sampai** | Fill up to: jumlah yang dituju saat restock. Kode: `P` |
| **Batas kritis** | Critical level: di angka ini atau di bawahnya, SKU berwarna merah. Kode: `S` |
| **Kode SKU di Hiryu** | Kode SKU di Hiryu; menyejajarkan lembar stok dengan tab Stock di Hiryu |
| **Baki karantina** | Baki karantina, `HUB-KARANTINA`: satu kotak berlabel per hub, jauh dari rak, untuk unit yang tidak boleh dijual sampai SPV memutuskan. Dibuat otomatis (§2.5.2, §11.4) |
| **Ops Head** | Kepala operasional; tanda tangan terakhir untuk penghapusan stok (§11.5) |
| **Peran Hiryu (Hiryu roles)** | ADMIN, EDITOR, VIEWER untuk staf kantor; MANAGER dan STAFF untuk login hub (§1.1) |
| **Bin inbound sementara (temporary inbound bin)** | `HUB-IN-nn`, tempat pengiriman dihitung sebelum putaway; bukan stok (§2.5.2) |
| **Warna hari (day colour)** | Warna stiker untuk minggu saat pengiriman tiba, dengan tanggal di pembatas |
| **Model listing (listing model)** | Siapa merchant di Grab: model 3PL Grab atau merchant milik Ninja sendiri (§2.11) |
| **Pesanan terpisah (split order)** | Satu pesanan dipenuhi dari dua hub (§17) |
| **Lembar stok (stock sheet)** | *Stok untuk Hiryu*: angka yang diketik SPV ke Hiryu |
| **SKU / item menu** | SKU adalah barang yang ada di rak; item menu adalah yang dibeli pelanggan. Satu SKU bisa dijual satuan dan dalam paket (§2.2) |
| **Unit per jual** | Berapa unit SKU yang terpakai untuk satu penjualan item menu: 1 untuk satuan, 2 untuk paket isi 2 |
| **Kode bin** | `MA5-A1-3-05T`: hub, rak dan bay, level, posisi, tumpukan (§3.2) |
| **Label** | Dicetak dari WMS di kertas stiker A4, digunting lalu ditempel di depan bin, baki atau bin sementara (§3.1) |
| **AWB** | Nomor resi kurir untuk sebuah pengiriman; staf menerima barang berdasarkan nomor ini (§4.1) |
| **Surat Jalan** | Dokumen pengiriman kertas yang dibawa driver; staf menandatanganinya setelah menghitung |
| **Permintaan restock** | `RPL-…`: barang yang diminta Ninja untuk dikirim merek ke satu hub (§4.1) |
| **Live Orders** | Papan pesanan Hiryu yang sedang berjalan, terbuka sepanjang hari di laptop meja kemas |
| **Slip pengiriman** | Kertas Grab untuk satu pesanan, dicetak oleh Hiryu; menampilkan nomor GM, dan bisa menampilkan nama pelanggan |
| **Rak siap ambil** | *Rak siap ambil*: di lantai bawah, di sebelah meja serah terima, tempat tas yang sudah dikemas menunggu driver |
| **Hitung buta** | Hitungan di mana penghitung tidak melihat angka di WMS (§10.1) |
| **Peta proses** | Gambaran yang bisa diklik dari setiap langkah per pemilik dan fase, di antara Bagian A dan Bagian B |
| **PO** | Purchase order: barang yang diminta Ops HQ untuk dikirim merek ke satu hub, `RPL-…`, dikirim sebagai Excel dengan barcode (§4.1) |
| **Faktur** | Invoice merek yang datang bersama kiriman; ditandatangani saat penerimaan dan diunggah oleh SPV (§5.1) |
| **Perlu tindakan** | Daftar setiap peran berisi hal yang harus diselesaikannya, dengan batas waktunya (§13.5) |
| **Siap ambil** | Picker yang siap diberi pesanan (§6.2) |
| **Sambungan (link)** | API antara Hiryu dan WMS, enam pesan (§0.6) |

## Lampiran B. Data induk SKU Kahf dan Labore

**Daftar produk go-live setelah cek ulang 25 Sep: 105 SKU**, 68 Kahf (67 produk dan 1 kit pabrik) dan 37 Labore (33 produk dan 4 kit pabrik). Cek ulang menemukan 1 SKU Kahf baru dan 15 SKU Labore baru; 41 baris disisihkan (bundel marketplace, duplikat, kemungkinan sudah tidak diproduksi). 56 dari 105 SKU sudah punya barcode dari sumber publik; ukuran kemasan belum ditemukan. Rincian: `SKU-RECHECK-25SEP.md` di folder proyek Grab Kilat.

Daftar SKU dan lembar data untuk merek ada di `11 SKU Master Kahf Labore.xlsx` di folder yang sama. Isinya satu baris per SKU, sel kuning untuk diisi merek, dan kolom yang diimpor WMS (§2.6.1):

| Kolom | Wajib | Catatan |
|---|---|---|
| Merek, kode SKU, nama produk, varian, ukuran, kategori | Ya | Dari merek |
| Barcode (EAN-13) | Ya, jika tercetak | Boleh lebih dari satu, dipisah koma |
| Panjang, lebar, tinggi kemasan (mm) | Diminta | Kotak ritel atau botol, posisi berdiri |
| Berat (g) | Diminta | Kotor, termasuk kemasan |
| Cairan dalam botol (Y/N); botol besar 150 ml atau lebih (Y/N) | Diminta | Untuk aturan karton |
| Unit per karton, ukuran karton | Diminta | Untuk penerimaan |
| Masa simpan (bulan), nomor BPOM; ED di setiap Surat Jalan | Diminta | Untuk kedaluwarsa (§5.5) |
| Kode SKU Hiryu, ukuran bin, isi maks. per bin | Diisi Ninja | Ukuran bin disarankan dari ukuran kemasan |

Jika merek tidak memberi apa pun, WMS memakai perkiraan di lembar itu dan menandainya *perkiraan*.

## Lampiran C. Nomor bagian di v3.3

Komentar kode dan catatan sebelum 29 September memakai nomor v3.3. Tabel ini menunjukkan letak barunya.

| v3.3 | v4.0 |
|---|---|
| A1 | §0.1 |
| A1.1 | §1.1 |
| A1.2 | §12.1 |
| A2 | §0.4 |
| A3 | §2.1 |
| A3.1 | §2.1.1 |
| A3.2 | §2.1.2 |
| A4 | §3 |
| A4.1 | §3.1 |
| A4.2 | §3.2 |
| A4.3 | §3.3 |
| A4.4 | §1.3.1 |
| A5 | §2.2 |
| A5.1 | §2.2.1 |
| A5.2 | §2.2.2 |
| A5.3 | §2.2.3 |
| A5.4 | §2.2.4 |
| A5.5 | §2.2.5 |
| A5.6 | §2.2.6 |
| A5.7 | §2.3 |
| A6 | §2.4 |
| A6.1 | §2.4.1 |
| A6.2 | §2.4.2 |
| A6.3 | §2.4.3 |
| A6.4 | §2.4.4 |
| A6.5 | §2.4.5 |
| A6.6 | §2.4.6 |
| A7 | §5 |
| A7.1 | §5.1 |
| A7.2 | §5.2 |
| A8 | §6 |
| A8.1 | §6.1 |
| A8.2 | §6.2 |
| A8.3 | §6.3 |
| A8.4 | §6.4 |
| A8.5 | §7.1 |
| A9 | §8 |
| A9.1 | §8.1 |
| A9.2 | §11.1 |
| A9.3 | §8.2 |
| A10 | §13 |
| A10.1 | §4.2 |
| A10.2 | §4.1 |
| A10.3 | §11.2 |
| A10.4 | §13.1 |
| A10.5 | §13.2 |
| A11 | §9 |
| A11.1 | §9.1 |
| A11.2 | §9.2 |
| A11.3 | §9.3 |
| A11.4 | §10.1 |
| A11.5 | §13.3 |
| A12 | §14 |
| §1 | §0.2 |
| §2 | §0.3 |
| §3 | §1.2 |
| §4.1 | §2.5 |
| §4.2 | §3.4 |
| §5.1 | §4.3 |
| §5.2 | §4.4 |
| §5.3 | §15.1 |
| §6.1 | §2.6 |
| §6.1b | §2.7 |
| §6.2 | §2.8 |
| §6.3 | §2.9 |
| §6.4 | §2.10 |
| §6.5 | §2.11 |
| §7 | §5.3 |
| §7.8 | §5.4 |
| §7.9 | §5.5 |
| §8.1 | §4.5 |
| §8.2 | §4.6 |
| §8.3 | §6.8 |
| §8.4 | §3.5 |
| §8.5 | §4.7 |
| §8.6 | §4.8 |
| §9 | §6.5 |
| §10.1 | §6.7 |
| §10.2 | §8.3 |
| §10.3 | §6.9 |
| §10.4 | §7.2 |
| §10.5 | §6.11 |
| §10.6 | §8.4 |
| §11 | §10.2 |
| §12 | §11 |
| §12.1 | §11.3 |
| §12.1a | §11.4 |
| §12.2 | §11.5 |
| §12.3 | §11.6 |
| §12.4 | §8.5 |
| §12.5 | §8.6 |
| §13.1 | §0.6 |
| §13.2 | §6.6 |
| §13.3 | §2.12 |
| §13.4 | §9.4 |
| §13.5 | §13.4 |
| §13.6 | §9.5 |
| §14 | §6.10 |
| §15 | §1.4 |
| §16 | §0.5 |
| §17 | §16 |
| §18 | §17 |
| §19 | §18 |
| §20 | §19 |
| §21 | §20 |
