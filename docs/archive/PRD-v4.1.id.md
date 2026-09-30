# Ninja Kilat WMS: kebutuhan sistem dan instruksi kerja

| | |
|---|---|
| **Produk** | Ninja Kilat WMS |
| **Versi** | v4.1: setiap langkah ditulis ulang sebagai kartu langkah (siapa, di mana, apa yang dilakukan, apa yang harus terlihat), istilah baru dijelaskan di tempat pertama kali muncul, peta proses yang bisa diklik, satu menu Hiryu per toko, SKU dibuat dari menu Hiryu, rak didaftarkan sesuai kondisi fisiknya, dan urutan persiapan tanggal 30 September |
| **Tanggal** | 30 September 2026 |
| **Pemilik** | Baskoro Nugroho |
| **Status** | Spesifikasi untuk ditinjau, proses demi proses. Layar WMS masih draf; build pertama sudah di dev |
| **Acuan** | *QC Systems: Hiryu, WMS, TMS* (ChangWen, 11 Sep 2026), `docs/canonical/qc-oms-wms.html`, untuk desain jangka panjang. Jika build pertama butuh solusi sementara (belum ada koneksi ke Hiryu), halaman ini menyebutkannya |
| **Menggantikan** | v4.0 tanggal 29 September (disimpan di `docs/archive/PRD-v4.0.md`), v3.3 (nomor bagiannya ada di Lampiran C) dan semua versi sebelumnya |
| **Platform** | Substrait · FastAPI · OceanBase · static frontend |
| **Live** | Dev: wms-test--dev.ninjavan.apps.substrait.build (build pertama, 28 Sep). Produksi: wms-test.ninjavan.apps.substrait.build |
| **Go-live** | **Kahf dan Labore** di **MA5 Cawang** dulu, lalu **KJ5 Kemanggisan** |
| **Skala** | 10 sampai 30 dark store dalam 6 bulan |

---

# Bagian A. Dasar

Yang perlu dibaca semua orang sekali: tiga sistem, aturan yang berlaku di mana saja, urutan membuka hub, dan targetnya. Bagian B lalu berisi satu bagian per proses, sesuai urutan yang dialami hub. Setiap proses berisi langkah di kedua sistem (**Hiryu dulu**), lalu aturan yang diikuti WMS, lalu **hal terbuka**: yang belum diputuskan atau belum ditulis. Layar dengan sidebar Hiryu hijau adalah Hiryu, digambar ulang dari Hiryu Malaysia; yang lain draf WMS. Titik bernomor di layar sama dengan nomor langkah di bawahnya.

## 0. Pilot dan aturannya

### 0.1 Cara kerja pilot

**Ada tiga sistem, dan Hiryu belum terhubung ke WMS.**

| Sistem | Siapa yang memakai | Fungsinya |
|---|---|---|
| **Grab** | Pelanggan | Menerima pesanan, menerima pembayaran, mengirim rider Grab |
| **Hiryu** | Ops HQ, SPV, dan staf | POS milik Ninja. Menyimpan toko Grab, menu, harga, dan angka stok yang tampil di Grab. Menerima semua pesanan Grab dan mencetak slip kemas. Staf menekan *Mark ready* di sini |
| **WMS** | Ops HQ, SPV, dan staf | Tahu letak setiap unit: di rak mana, di bin mana. Memberi tahu picker harus ke mana, memeriksa setiap unit lewat scan, menghitung isi rak, menerima kiriman, membuat permintaan restock ke merek |

Hiryu dan WMS belum saling terhubung. Sampai terhubung, **orang yang memindahkan informasinya**:

- **Pesanan pindah dari Hiryu ke WMS dengan copy dan paste.** Staf menyalin halaman pesanan di Hiryu lalu menempelkannya ke WMS (§6).
- **Stok pindah dari WMS ke Hiryu dengan diketik.** WMS menampilkan angkanya, lalu SPV mengetiknya ke tab Stock di Hiryu (§9).
- **Data pelanggan tidak pernah masuk ke WMS.** Nama, nomor telepon, alamat, dan pembayaran tetap di Hiryu.

### 0.2 Ringkasan dan cakupan

Ninja Van memenuhi pesanan quick-commerce untuk merek dari dark store kecil. Untuk **GrabMart Kilat**, Grab menerima pesanan dan mengirim driver; Ninja menyimpan stok, mengambil barang, dan mengemasnya. POS Ninja, **Hiryu**, sudah menerima pesanan Grab dan menyimpan menu. **WMS** adalah lapisan di bawahnya: ke mana satu unit disimpan, di mana picker menemukannya, apakah unit itu benar-benar ada, dan apa yang tiba dibanding apa yang menurut merek sudah dikirim.

**Versi pertama** *(diputuskan 25 Sep)*: hanya dark store; merek mengirim langsung; pesanan Grab masuk lewat salin-tempel dari Hiryu; angka stok kembali ke Hiryu lewat SPV yang mengetiknya; Kahf dan Labore di MA5, lalu KJ5.

**Desain target** (dokumen acuan): setiap pesanan masuk lewat Hiryu, hanya Hiryu yang berkomunikasi dengan WMS, hanya WMS yang menghitung stok di rak, dalam lima pesan (§0.6). Versi pertama mempertahankan bentuk itu agar solusi sementara bisa dimatikan satu per satu.

### 0.3 Prinsip

- **0.3.1** **WMS tidak pernah berkomunikasi dengan Grab.** Kanal penjualan terhubung ke Hiryu. Di versi pertama, orang yang memindahkan pesanan dari Hiryu ke WMS (§6.6).
- **0.3.2** **Satu hitungan rak.** Ledger WMS adalah satu-satunya hitungan stok di rak. Angka di Hiryu dikoreksi dari ledger ini (§9.4) sampai Hiryu berhenti menyimpan hitungannya sendiri.
- **0.3.3** **Setiap pergerakan stok di-scan.** Picking punya cek scan yang tidak bisa dilewati staf.
- **0.3.4** **Ledger hanya bisa ditambah.** Saldo dihitung dari pergerakan; stok negatif ditolak; setiap scan bisa diulang tanpa terhitung dua kali.
- **0.3.5** **Merah hanya berarti gagal.** Setiap status punya warna, ikon, dan kata-kata.
- **0.3.6** **Tidak ada teks bebas di lantai gudang.** Jumlah diisi lewat stepper dan keypad.
- **0.3.7** **Bahasa Indonesia sebagai default**, bahasa Inggris cukup satu ketukan, untuk setiap teks.
- **0.3.8** **Hanya online, dan sistem memberi tahu.** Jika koneksi putus, pekerjaan terhenti dan hal itu terlihat jelas.
- **0.3.9** **Mode latihan tidak pernah menyentuh stok asli.**
- **0.3.10** **Semua stok milik merek** (§2.11).
- **0.3.11** **Data pelanggan tetap di Hiryu.** WMS tidak pernah menerima, menyimpan, mencatat di log, atau menampilkan nama, nomor telepon, alamat, catatan, atau pembayaran pelanggan, dan tidak ada tabel yang punya kolom untuk data itu (§6.6.1).
- **0.3.12** **Hiryu dulu** *(diputuskan 28 Sep)*. Hiryu adalah penghubung dengan Grab dan yang dilihat pelanggan. Di setiap langkah yang menyentuh kedua sistem, bagian Hiryu dikerjakan lebih dulu, lalu WMS mencatatnya: dark store dan login, SKU dan menu, *Mark ready*, pembatalan. Satu-satunya pengecualian adalah angka stoknya sendiri, yang dihitung di WMS lalu diketik ke Hiryu.

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
| 10 | B | Ops HQ | WMS | Unggah menu setiap toko (ini membuat SKU-nya), lalu lengkapi angka stoknya | §2.2.5, §2.2.6 |
| 11 | B | SPV | WMS | Beri setiap SKU satu bin | §3.3 |
| 12 | B | Ops HQ, dengan login manajer Grab milik setiap toko | Hiryu, lalu Grab | Buat keempat toko, beri masing-masing hub dan menunya, aktifkan di Grab, cek menu sudah sampai di Grab | §2.4.1 sampai §2.4.5 |
| 13 | C | SPV | WMS, lalu WhatsApp atau email | Permintaan restock pertama ke setiap merek | §4.1 |
| 14 | D | Staf | WMS | Terima kiriman pertama dan simpan ke rak | §5.1 |
| 15 | A | SPV | WMS, lalu Hiryu | Ketik stok awal ke setiap toko | §9.3 |
| 16 | A | Ops HQ | Grab, Hiryu, WMS | Satu pesanan uji per toko, dari awal sampai akhir, lalu buka | §2.4.6 |

**Hiryu dulu.** Setiap langkah yang menyentuh kedua sistem: kerjakan bagian Hiryu lebih dulu, lalu catat di WMS. Hiryu adalah penghubung dengan Grab: itulah yang dilihat pelanggan.

Toko yang sudah aktif tetapi stoknya belum diketik tidak menampilkan apa pun yang bisa dijual Grab. Cek ini di toko pertama (langkah 12) sebelum mengaktifkan tiga toko lainnya.

### 0.5 Target layanan dan skala **[USULAN]**

**Usulan untuk diputuskan Ops.** Belum ada angka yang disepakati. Angka ini adalah titik awal yang ditinjau lagi setelah minggu-minggu pertama di MA5.

| Ukuran | Definisi | Target |
|---|---|---|
| Tepat waktu | Pesanan dikemas sebelum batas waktu siap (ready-by) | **95%** |
| Ambil dan kemas | Tempel → dikemas | **di bawah 5 menit** |
| Siap | Pesanan masuk ke Hiryu → *Mark ready* | **dalam 10 menit** |
| Barang kurang | Baris pesanan dengan *Barang tidak ada* | **di bawah 3%** |
| Akurasi hitung | Bin yang dihitung tanpa selisih | **98%** |
| Akurasi ambil | Baris yang diambil tanpa henti karena produk salah | 99,5% atau lebih baik (dipantau) |

Sebelum hub kedua go-live: setiap daftar punya halaman dan berjalan dalam satu query; layar yang memantau kondisi langsung diperbarui lewat push; buffer scan pendek menahan scan saat Wi-Fi putus sebentar.

### 0.6 Nanti: sambungan Hiryu dengan lima pesan

Setelah sambungan Hiryu dibangun, tepat lima pesan bergerak di antara kedua sistem:

| Nama | Dari → ke | Kapan |
|---|---|---|
| **Pesanan untuk diambil** | Hiryu → WMS | Pesanan diterima |
| **Pesanan dibatalkan** | Hiryu → WMS | Pelanggan atau Grab membatalkan |
| **Pembaruan stok** | WMS → Hiryu | Setelah setiap perubahan: tersedia = stok di rak dikurangi yang ditahan untuk pesanan |
| **Pesanan siap** | WMS → Hiryu | Scan kemas |
| **Barang kurang** | WMS → Hiryu | Picker menyatakan ada barang yang tidak ada |

Aturan untuk saat itu: angka bulat, tidak pernah "tambah 2"; setiap pesan aman dikirim ulang; pesan mengantre jika sisi lain sedang mati; situs pelatihan tidak mengirim apa pun. Saat ini WMS sudah menghitung dan mengantrekan pesan-pesan ini tetapi **tidak mengirim satu pun**, karena sambungannya belum ada.

### 0.7 Hal terbuka

- **Lanjut atau tidak ke KJ5.** Angka apa yang harus dicapai MA5 sebelum KJ5 buka (§0.5), dan berapa lama? *Usulan:* dua minggu di MA5 sesuai target. *Yang memutuskan:* Ops.
- **Tingkat layanan Grab** (Q13): batas siap 10 menit adalah bacaan kita atas Hiryu, bukan angka dari Grab.

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
| **Staf** | Lantai dark store | Terima barang per AWB, simpan ke rak, tempel pesanan Grab, ambil, kemas, serahkan, hitung stok, laporkan masalah |
| **SPV** | Hub miliknya sendiri | Bin inbound sementara, rak dan bin, SKU ke bin, pertanyaan bin kedua, keputusan barang tidak ada, keputusan masalah, permintaan restock untuk hub-nya, konfirmasi selisih, pengesahan hitung stok, laporan akhir hari, **mendaftarkan staf** |
| **Ops HQ** | Semua hub | **Menambahkan merek**, SKU, foto, angka stok dan cadangan Grab, menu Hiryu dan pemetaan toko, menyetujui write-off, pengesahan selisih, menautkan kiriman tanpa AWB tercatat, **mendaftarkan dark store dan pengguna serta memberi peran** |
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

Peran Ops Head dibuat sekarang; siapa yang memegangnya diputuskan nanti. Hiryu punya perannya sendiri (ADMIN, EDITOR, VIEWER untuk staf kantor; MANAGER dan STAFF untuk login hub). Siapa memegang peran apa ada di §1.1.

- **1.2.1** Server menegakkan setiap izin; console menyembunyikan layar yang tidak bisa dipakai suatu peran.
- **1.2.2** Peran *hub operator* untuk gudang pusat disembunyikan di versi pertama dan kembali bersama gudang pusat (§19).
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

**Siapa**: Ops HQ (ADMIN atau EDITOR di Hiryu) · **Sistem**: Hiryu dulu, lalu WMS, lalu Grab · **Di dev**: *Menu & toko Hiryu* (unggah menu, hubungkan barang, peta toko), 28 Sep. Form merek dan form SKU baru: belum

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
> Kode yang dimiliki sebuah SKU di Hiryu. Hiryu mencetaknya di bawah nama SKU di tab Stock, dan lembar stok WMS mengurutkan baris berdasarkan kode yang sama, jadi SPV bisa mengetik stok baris demi baris (§9.3). Untuk produk satuan, kode ini sama dengan kode item menunya (§2.2.4).

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

#### 2.2.5 Di WMS: unggah menu setiap toko

<!--screen:hiryu-map-->

1. **Ops HQ · Hiryu → Menus → menu toko tersebut → Export CSV**

2. **Ops HQ · WMS → Menu Hiryu → pilih merek → Unggah CSV menu**

   ✓ Yang terlihat: *N barang · N SKU baru · N terhubung lewat barcode · N perlu dihubungkan*.

   Unggahan ini mengerjakan sendiri:
   - **item satuan yang belum punya SKU WMS** menjadi **SKU WMS baru**: kode di Hiryu, nama, barcode dan harganya diambil dari menu;
   - item yang **barcode**-nya cocok dengan SKU yang sudah ada terhubung ke SKU itu dengan 1 unit per penjualan;
   - **paket** (paket isi 2, bundel) menunggu di **Perlu dihubungkan**.

3. **Ops HQ · Menu Hiryu → Perlu dihubungkan**

   Untuk setiap paket, pilih SKU WMS dan jumlah unit per penjualan, sama seperti di Bundles Hiryu.

   ✓ Yang terlihat: *Perlu dihubungkan* kosong. Pesanan Grab yang berisi item belum terhubung tidak bisa di-paste.

4. **Ulangi langkah 1 dan 2 untuk toko lain milik merek itu.** Item-nya punya ID yang sama, jadi terhubung sendiri.

5. **Ops HQ · Menu Hiryu → Toko Hiryu** · *setelah toko dibuat (§2.4.1)*

   Isi setiap nomor toko Hiryu satu kali, beserta hub dan mereknya.

   ✓ Yang terlihat: keempat toko, masing-masing dengan hub-nya.

Unggah menu lagi **setiap kali menu berubah di Hiryu**, di hari yang sama.

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
2. **Ops HQ · WMS** · unggah kedua menu (§2.2.5): SKU baru dibuat. Lengkapi angka stoknya (§2.2.6).
3. **SPV · WMS** · beri SKU itu bin (§3.3).

#### 2.3.2 Perubahan harga

1. **Merek → Ops HQ** · merek meminta secara tertulis, dengan tanggal mulai berlakunya harga.
2. **Ops HQ · Hiryu → Menus → menu setiap toko → item tersebut** · ubah harganya, **Save menu**. Cek statusnya *Synced* (§2.4.5).
3. **Ops HQ · WMS → Menu Hiryu** · unggah kedua menu lagi di hari itu, supaya laporan sell-out menghitung penjualan dengan harga baru mulai tanggal tersebut (§15.1).

#### 2.3.3 Berhenti menjual produk

1. **Ops HQ · Hiryu → menu setiap toko → item tersebut** · ubah ke **UNAVAILABLE** (untuk seterusnya) atau **SOLD OUT** (untuk sementara), **Save menu**.
2. **Ops HQ · WMS → Produk → SKU tersebut** · ubah *Isi sampai* ke **0**, supaya tidak ada lagi permintaan restock.
3. **SPV** · stok yang masih ada di rak dikembalikan ke merek (§8).

#### 2.3.4 Kemasan berubah (misalnya produk satuan menjadi paket isi 2)

1. **Ops HQ · Hiryu → menu setiap toko → Bundles** · ubah *Units per sale* item itu.
2. **Ops HQ · WMS** · unggah kedua menu di hari yang sama dan atur jumlah unit yang sama di *Perlu dihubungkan* (§2.2.5).

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

**Hubungan item disimpan di dua tempat.** *Bundles* di Hiryu dan daftar item di WMS sama-sama menyimpan SKU mana yang dijual setiap item menu, dan berapa unitnya. Hiryu memakai datanya untuk mengurangi stoknya; WMS memakai datanya untuk tahu barang apa yang harus diambil. Jika satu diubah dan yang lain tidak, kedua hitungan akan makin berbeda. Jadi setiap perubahan dibuat di keduanya, di hari yang sama, dan sebulan sekali Ops HQ mengunduh daftar item WMS (*Menu Hiryu → Unduh daftar item*) lalu membandingkannya dengan halaman Bundles setiap menu.

### 2.4 Ops HQ: hubungkan setiap toko Grab ke Hiryu

**Satu toko Grab per merek per hub**: pilot ini punya **empat**, Kahf × MA5, Kahf × KJ5, Labore × MA5 dan Labore × KJ5. Setiap toko dihubungkan sendiri-sendiri, dan setiap toko punya **menunya sendiri** (§2.2). Kerjakan §2.4.1 sampai §2.4.5 **empat kali**, sekali per toko.

**Sebelum mulai**, untuk setiap toko:
- toko Grab yang sudah dibuat oleh Grab, dengan alamat hub;
- **login manajer Grab milik outlet** untuk toko itu (dari Grab atau dari merek);
- menu toko sudah dibuat, dengan setiap item terhubung ke SKU (§2.2).

Stok diketik nanti, setelah kiriman pertama (§9.3).

#### 2.4.1 Buat toko

1. **Ops HQ · Hiryu → Stores → New store**

   Beri nama persis seperti yang akan dibaca pelanggan, yaitu merek dan hub: *Labore - Cawang*.

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

   ✓ Yang terlihat: *Menu assigned to this store*, dan nama menu di Overview.

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

Kerjakan ini setelah kiriman pertama sudah di rak dan stok awal sudah diketik (§9.3).

1. **Ops HQ · aplikasi Grab** · buat satu pesanan uji di setiap toko.
2. **Staf · Hiryu, lalu WMS** · jalankan dari awal sampai akhir: paste, ambil, kemas, *Mark ready*, serah terima (§6, §7).
3. **Ops HQ** · batalkan atau selesaikan pesanan itu sesuai kesepakatan dengan Grab, lalu beri tahu SPV bahwa toko sudah buka.

**Ada error di Hiryu** (aktivasi, sinkronisasi menu, pesanan tidak masuk): hubungi **Shaun Cong**, pemilik Hiryu, dengan screenshot, nama toko, dan jam kejadiannya.

### 2.5 Lokasi

- **2.5.1** Versi pertama **hanya untuk dark store**. Tipe lokasi gudang pusat, transfer, dan pengiriman tote tetap ada di kode tapi disembunyikan (§19).
- **2.5.2** **Bin inbound sementara dan baki karantina** *(direvisi 28 Sep)*. **Baki karantina** (`HUB-KARANTINA`) dibuat otomatis saat Ops HQ mendaftarkan dark store dan tidak bisa dimatikan: baki ini satu-satunya tempat untuk unit yang tidak boleh dijual (rusak, bocor, kedaluwarsa, meragukan), jadi unit itu tidak pernah berada di bin yang bisa dijangkau picker. **SPV** mengatur **bin inbound sementara** (§3.1): berapa banyak dan ukurannya. WMS memberi setiap bin lokasi dan labelnya sendiri, mulai dari `HUB-IN-01`, satu SKU per bin, dipakai saat kiriman dihitung; WMS menentukan bin mana yang dipakai untuk tiap SKU. Keduanya tidak pernah menyimpan stok yang bisa dijual. Jumlah bin sementara bisa diubah kapan saja; kiriman dengan SKU lebih banyak dari jumlah bin sementara diterima bertahap (§5.3.2).

### 2.6 Mendaftarkan SKU **[diperbarui 30 Sep]**

Ops HQ membuat setiap SKU WMS **sekali untuk semua hub**, **dari menu Hiryu** *(diputuskan 30 Sep)*. Mengunggah menu sebuah toko (§2.2.5) membuat SKU WMS untuk setiap item satuan yang belum punya SKU: *One SKU per item* di Hiryu memberi SKU produk satuan kode item itu, jadi menu sudah membawa semua yang dibutuhkan WMS untuk mencocokkan keduanya. Lalu Ops HQ melengkapi sisanya di *Lengkapi data SKU* (§2.2.6). **Daftarkan SKU** (satu per satu, manual) tetap ada untuk produk yang belum ada di menu mana pun.

| Kolom | Berasal dari | Wajib | Catatan |
|---|---|---|---|
| Nama dan ukuran | Nama item menu | Ya | Diperbarui di setiap unggahan jika namanya berubah di Hiryu |
| **Kode SKU di Hiryu** | ID item menu produk satuan | Ya | Tidak pernah berubah. Lembar stok mengurutkan baris berdasarkan kode ini, jadi sejajar dengan tab Stock di Hiryu (§9.4). Dicocokkan tanpa melihat huruf besar atau kecil |
| **Barcode** | Kolom *barcode* di CSV menu, atau di-scan | Jika kemasan punya | Satu barcode hanya untuk satu SKU, selamanya. Satu SKU boleh punya beberapa |
| Item menu Hiryu, unit per penjualan | Unggahan menu | Ditampilkan | Setiap ID item yang menjual SKU ini, di menu setiap toko |
| Harga | Unggahan menu, per toko, dengan tanggal | Ditampilkan | Hanya untuk nilai sell-out (§15.1) |
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
- **2.6.4** Item paket (unit per penjualan lebih dari 1) tidak pernah membuat SKU: item ini dihubungkan ke SKU produk satuannya di *Perlu dihubungkan* (§2.2.5).

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

### 2.12 Peta yang dikelola Ops HQ

| Peta | Isi | Diisi oleh |
|---|---|---|
| Item Hiryu | ID item Hiryu → SKU dan unit per penjualan, **untuk menu setiap toko** | Unggahan CSV menu setiap toko (kolom yang dipakai: `item_id`, `item_name`, `barcode`, `available_status`, `price`); item satuan membuat atau menemukan SKU-nya, barcode yang cocok dihubungkan dengan 1 unit, paket dihubungkan manual |
| Toko Hiryu | Nomor toko → hub, merek dan menunya | Diketik sekali per toko |
| Kode SKU Hiryu | Di setiap SKU WMS (§2.6) | ID item satuan. Dicocokkan tanpa melihat huruf besar atau kecil, karena Hiryu mengubah kode menjadi huruf besar |
| Harga item Hiryu | ID item dan toko → harga, dengan tanggal setiap unggahan | Kolom `price` dari CSV menu yang sama; hanya dipakai untuk nilai sell-out (§15.1) |

### 2.13 Hal terbuka

- **Bundel.** 41 bundel marketplace disisihkan saat cek ulang. Apakah ada yang dijual di Grab sebagai paket **ditanyakan nanti**, per merek.
- **Menyalin menu** (§2.2.3). Cek pada salinan pertama apakah *Import CSV* ke menu baru tetap menyimpan ID item, dan apakah item salinan tetap terhubung ke SKU-nya atau harus dipilih lagi di *Bundles*.
- **Toko diaktifkan sebelum stok diketik** (§0.4 langkah 12). Cek pada toko pertama apa yang dilihat pelanggan di Grab: semua item habis, atau toko tutup.
- **Cek hubungan item bulanan** (§2.3): unduhan WMS *Unduh daftar item* akan dibuat *(diputuskan 30 Sep)*.

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

**Siapa**: SPV, Ops HQ · **Sistem**: WMS, plus WhatsApp atau email ke merek · **Di dev**: permintaan restock, persetujuan selisih, pengingat. Kolom *Catat pengiriman*, unit atau %, isi maks. per bin yang dipelajari: belum

### 4.1 Restock dari merek, dan mencatat AWB

> **Istilah · AWB dan Surat Jalan**
> **AWB** (air waybill) adalah nomor lacak kurir untuk satu kiriman. **Surat Jalan** adalah nota kiriman kertas yang dibawa driver: isinya daftar barang yang dikirim merek, dan staf menandatanganinya saat menerima. WMS mencari kiriman lewat AWB-nya.

> **Istilah · Permintaan restock**
> Daftar SKU dan jumlahnya yang diminta Ninja agar dikirim merek ke satu hub, dengan referensi `RPL-MA5-2610-01`. WMS membuat drafnya; SPV memeriksanya lalu mengirimnya lewat WhatsApp atau email.

1. **SPV · WMS → Pengingat**

   **Draf restock** muncul saat stok SKU turun ke angka *pesan ulang saat sisa*. WMS mengumpulkan setiap SKU yang perlu restock ke dalam satu draf per merek untuk hub kamu. *Untuk kiriman paling pertama*, buka **Restock ke merek → Buat permintaan**, pilih mereknya, dan WMS mengisi setiap SKU sampai angka *isi sampai*.

   ✓ Yang terlihat: draf dengan jumlah per SKU.

2. **SPV · Restock ke merek → drafnya**

   Periksa jumlahnya (terisi sampai *isi sampai*). Ubah yang perlu; tambahkan SKU secara manual jika perlu.

3. **SPV · Salin teks → WhatsApp atau email ke kontak restock merek**

   Tempel lalu kirim. Setelah itu tekan **Tandai terkirim**.

   ✓ Yang terlihat: permintaan bertanda *Terkirim*; jumlahnya tidak bisa diubah lagi.

4. **SPV · saat merek membalas dengan info pengiriman · permintaannya → Catat pengiriman**

<!--screen:restock-awb-->

   Isi **nomor AWB**, **nomor Surat Jalan**, perkiraan tanggal tiba, dan **jumlah setiap SKU yang benar-benar dikirim merek** (bisa lebih sedikit dari yang kamu minta). Jika merek memberi tanggal kedaluwarsa setiap SKU, isi juga (§5.5).

5. **SPV · Simpan pengiriman**

   ✓ Yang terlihat: permintaan bertanda *Dikonfirmasi*. Sekarang staf bisa menerima kiriman itu dengan AWB tersebut (§5.1). Kamu bisa memperbaiki data ini sampai barangnya datang.

Jika barang datang sebelum kamu mencatat AWB, staf menjalankan §5.2 dan kamu atau Ops HQ menghubungkan AWB-nya di sana.

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

### 4.4 Permintaan restock ke merek **[dibangun 17 Sep]**

Stok ini konsinyasi: merek memilikinya sampai terjual. Ninja membuat permintaan restock dan memberikan formulir konsinyasi ke merek. Ops HQ menjalankannya untuk semua hub; SPV untuk hub miliknya.

| Langkah | Siapa | Yang terjadi |
|---|---|---|
| **Peringatan** | WMS | Stok SKU di suatu hub turun ke angka *pesan ulang saat sisa* (semua bin-nya digabung). SKU muncul di *Needs restock* dengan jumlah saran sampai *isi sampai* |
| **Draf** | WMS, lalu Ops HQ atau SPV | WMS otomatis membuat satu draf permintaan per hub dan merek; seseorang memeriksa dan menyesuaikannya |
| **Terkirim** | Ops HQ atau SPV | Teks permintaan disalin dan dikirim ke merek di luar WMS (WhatsApp atau email) lalu ditandai terkirim. Jumlahnya dikunci |
| **Dikonfirmasi** | Ops HQ atau SPV | Mencatat AWB dari merek, nomor Surat Jalan, tanggal tiba, dan jumlah yang benar-benar akan dikirim merek |
| **Diterima** | Staf | Diterima per AWB (§5). Jika semua cocok, permintaan ditutup dan angka itu yang ditagih |
| **Selisih** | SPV, lalu Ops HQ, lalu Ops Head | Ada perbedaan: SPV memasukkan hitungan akhir dan alasannya; Ops HQ menyetujui; Ops Head menandatangani. Angka yang ditandatangani yang ditagih |

- **4.4.1** Referensi `RPL-<hub>-<yymm>-<n>`. Satu AWB hanya milik satu permintaan yang masih terbuka.
- **4.4.1a** **Mencatat pengiriman** *(28 Sep)*: di permintaan restock, **Catat pengiriman** mencatat AWB, nomor Surat Jalan, perkiraan tanggal tiba, dan jumlah per SKU yang benar-benar dikirim merek (§4.1). SPV atau Ops HQ bisa mengoreksinya sampai barang tiba.
- **4.4.2** **Kiriman yang AWB-nya tidak tercatat** *(diputuskan 25 Sep)* tidak ditolak. Staf memasukkan AWB dari Surat Jalan, foto Surat Jalan, merek, dan jumlah karton; Ops HQ langsung mendapat tanda. Staf menghitung unit ke bin sementara selama driver masih ada; unit ini belum menjadi stok. Ops HQ lalu menautkan AWB ke permintaan restock yang terbuka, mencatatnya sebagai kiriman tidak terencana dari Surat Jalan, atau menolaknya (barang kembali ke merek). Baru setelah itu unit bisa disimpan ke rak (§5.2).
- **4.4.3** Langkah SPV, Ops HQ, dan Ops Head pada selisih harus dilakukan tiga orang berbeda *(diputuskan 28 Sep)*.
- **4.4.4** Masih perlu disepakati dengan merek (melalui Grab): safety stock, seberapa sering restock, retur barang kedaluwarsa dan barang lambat laku, serta biaya restock yang terpisah dari biaya fulfilment 5%. Semua ini akan menjadi pengaturan (§4.8), tanpa perlu membangun ulang.

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

**Siapa**: staf, SPV · **Sistem**: WMS · **Di dev**: terima per AWB dalam batch, daftar penyimpanan. ED per batch dan kiriman tanpa AWB tercatat: belum

### 5.1 Terima kiriman

**Siapa:** staf di meja penerimaan, dengan HP hub dan scanner. **Kapan:** begitu driver merek datang.

> **Istilah · Warna hari dan sekat**
> Setiap kiriman masuk ke bin-nya **di belakang sekat berwarna**, yaitu kartu plastik yang berdiri melintang di dalam bin. Warnanya menunjukkan minggu kiriman (warna stiker di layar, §5.4); tanggal dan ED ditulis di **sekat putih**. Picker selalu mengambil dari depan, yaitu stok yang paling lama.

1. **Staf · di pintu, bersama driver**

   Pastikan Surat Jalan menyebut hub kamu dan mereknya. Hitung **karton** dan cocokkan dengan Surat Jalan. Jangan tanda tangan dulu.

2. **Staf · HP hub → stasiun WMS → Barang masuk → scan atau ketik AWB**

   ✓ Yang terlihat: barang yang menurut merek sudah dikirim, per SKU. *AWB ini belum dicatat Ops HQ* artinya AWB tidak dikenal: lanjut ke §5.2.

3. **Staf · buka karton pertama · scan setiap unit**

   WMS menunjuk satu **bin inbound sementara** untuk setiap SKU (`MA5-IN-01`, `MA5-IN-02` …). Masukkan unit ke bin itu.

   ✓ Yang terlihat: *cocok*, *kurang N* atau *lebih N* per SKU selama kamu scan.

4. **Staf · tanggal kedaluwarsa (ED)**

   Jika data dari merek sudah mencantumkan ED (§4.1), WMS menampilkannya: cocokkan dengan kemasan. Jika belum, WMS memintanya di **unit pertama setiap SKU**: ketik bulan dan tahun yang tercetak di kemasan. Tidak ada tanggal, atau tidak terbaca: **Tidak ada ED**. Dua tanggal untuk satu SKU: tambahkan tanggal kedua, lalu scan unit-unit itu di bawah tanggal tersebut.

   ✓ Yang terlihat: ED di sebelah SKU.

   **Ditandai (30 Sep):** tujuannya ED datang **sebagai data dari merek**, jadi staf tidak perlu mengetik apa pun saat menerima barang. Sampai merek memberi kepastian (Q15), langkah ini tetap ada.

5. **Staf · saat semua bin sementara penuh · Selesai batch ini**

   Taruh batch ini di rak dulu (langkah 6) sebelum menghitung sisanya.

6. **Staf · taruh di rak · WMS → Taruh di rak**

<!--screen:putaway-full-->

   Untuk setiap bin sementara, WMS menyebut **bin rak** tujuannya. Bawa bin sementara ke rak. Pasang sekat berwarna baru di belakang stok yang sudah ada, lalu taruh unit baru di belakangnya, dan tulis tanggal serta ED di sekat putih. **Scan label bin rak.**

   ✓ Yang terlihat: bin sementara kosong. Unit **bisa dijual sejak scan ini**.

7. **Staf · jika bin rak penuh · Bin penuh**

   WMS memberimu bin kosong dengan ukuran sama, sedekat mungkin. Taruh sisanya di sana lalu scan labelnya. Nanti SPV akan ditanya apakah bin pertama benar-benar penuh (§4.2); kamu tidak perlu menunggu.

8. **Staf · Semua barang AWB sudah diterima**

   Lakukan saat semua barang sudah masuk. Tulis selisih di Surat Jalan (*kurang 2 LBR-0005*), tanda tangani, lalu berikan satu salinan ke driver.

   ✓ Yang terlihat: penerimaan ditutup. Selisih diteruskan ke SPV (§4.4).

9. **SPV · WMS → Stok untuk Hiryu**

   Ketik SKU yang baru diterima ke Hiryu (§9.2).

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

- **5.3.1** **Inbound dimulai dari AWB** atau referensi RPL (§4.4). Penerimaan dibuka dengan jumlah yang sudah dikonfirmasi merek, lalu dibandingkan per SKU selama scan.
- **5.3.2** **Bertahap.** Satu bin sementara menampung satu SKU; jumlah bin sementara di hub diatur di *Rak & bin*. Satu AWB bisa diterima dalam beberapa tahap.
- **5.3.3** **Ke mana setiap unit disimpan.** Stok baru masuk ke bin pertama SKU sampai mencapai **isi maks. per bin**, lalu ke bin berikutnya. Jika **belum ada angkanya**, semua masuk ke bin pertama sampai staf menekan **Bin penuh** (§5).
- **5.3.4** **Bin penuh** saat putaway: WMS menawarkan bin kosong terdekat dengan ukuran bin SKU itu di hub tersebut, mendaftarkannya sebagai bin berikutnya untuk SKU itu, dan mengajukan pertanyaan bin kedua ke SPV (§4.6). Staf tidak perlu menunggu.
- **5.3.5** **Bisa dijual sejak scan putaway.** Tidak ada yang menunggu tanda tangan. SKU muncul di lembar stok untuk Hiryu (§9.4).
- **5.3.6** **Daftar putaway.** Catatan tetap tentang apa disimpan di mana, warna hari, dan batas klaim 24 jam; SPV menandatanganinya untuk kepatuhan.
- **5.3.7** **24 jam.** Selisih dengan merek harus diajukan dalam 24 jam sejak penerimaan; setelah itu kerugian ditanggung hub.

### 5.4 Warna hari dan FIFO

Setiap kiriman diletakkan di belakang sekat berwarnanya sendiri di dalam bin; warnanya menunjukkan minggu kiriman, dan tanggalnya ditulis di sekat putih. WMS tidak melacak sekat. WMS mengarahkan picker ke bin yang berisi stok yang **paling cepat kedaluwarsa** (atau, jika tidak ada tanggal kedaluwarsa, stok paling lama), dan layar menampilkan *ambil dari sekat paling lama*.

### 5.5 Tanggal kedaluwarsa saat penerimaan **[DIPUTUSKAN 28 Sep; sumber ditandai 30 Sep]**

- **5.5.1** **Asal tanggalnya.** Merek diminta mencantumkan ED (tanggal kedaluwarsa) setiap SKU di data pengirimannya atau di Surat Jalan; SPV atau Ops HQ mengisinya di *Catat pengiriman* (§4.1). Jika tidak ada, staf membacanya dari kemasan saat men-scan unit pertama setiap SKU ketika menerima barang (§5.1). Bulan dan tahun sudah cukup; *Tidak ada ED* boleh dipilih.
- **5.5.1a** **Ditandai** *(30 Sep)*: tujuannya **tidak ada ketikan saat menerima barang**. Belum diketahui apakah merek bisa mengirim ED sebagai data (Q15). Sampai saat itu, langkah mengetik tetap ada sebagai cadangan.
- **5.5.2** **Disimpan per batch**: satu batch adalah satu SKU dalam satu kiriman dengan satu ED. Kiriman dengan dua ED untuk satu SKU dihitung dua batch. Saldo menyimpan batch-nya, jadi WMS tahu bin mana berisi tanggal yang mana.
- **5.5.3** **Dipakai untuk**: mengarahkan picker ke ED paling awal lebih dulu; menampilkan ED di layar taruh di rak, ambil, dan hitung stok; dan tanda **ED dekat** beberapa hari sebelum kedaluwarsa (default 90 hari, berupa pengaturan sampai syarat konsinyasi menentukan lain), agar SPV bisa meminta merek menariknya kembali.
- **5.5.4** ED tetap ditulis di sekat putih di dalam bin.

### 5.6 Hal terbuka

- **ED sebagai data** *(ditandai 30 Sep)*: bisakah merek mengirim tanggal kedaluwarsa setiap SKU bersama kirimannya, supaya staf tidak perlu mengetik apa pun saat penerimaan (§5.5.1a, Q15)?
- **Jam terima barang.** Kapan merek boleh mengirim, dan siapa yang menerima saat SPV libur.
- **Sisa umur minimal saat diterima.** Belum ada aturan menolak barang yang segera kedaluwarsa (misalnya sisa kurang dari 6 bulan). Terkait tanda *ED dekat* (90 hari, §5.5.3), Q5 dan Q15.
- **Kerusakan saat diterima.** Aturan klaim 24 jam sudah ada (§5.3.7), tapi langkah staf belum: foto, hitung sebagai kurang, dan unitnya ditaruh di mana.
- **Kiriman pertama yang besar** diterima sebagai risiko yang disadari (§17). Perkiraan waktu per 100 unit akan membantu merencanakan staf di hari pertama.

## 6. Ambil dan kemas

**Siapa**: packer di laptop, picker dengan HP · **Sistem**: Hiryu dulu, lalu WMS · **Di dev**: *Tempel pesanan Grab* (layar 20), ambil terpandu, batas siap 10 menit, 28 Sep. Aturan kemasan dan jalur terjadwal: belum

### 6.1 Salin pesanan dari Hiryu

**Siapa:** packer di laptop kemas. Sekitar 20 detik untuk menyalin, lalu ambil barang. Hiryu menganggap pesanan **terlambat setelah 10 menit**, jadi targetnya *Mark ready* dalam **10 menit** sejak pesanan masuk.

> **Istilah · Nomor GM dan ID pesanan Grab**
> **Nomor GM** (`GM-358`) adalah nomor pesanan pendek dari Hiryu, dicetak besar di slip kemas: nomor inilah yang dipakai orang. **ID pesanan Grab** adalah referensi panjang dari Grab: WMS memakainya sebagai kunci, karena nomor GM bisa berulang.

> **Istilah · Live Orders dan slip kemas**
> **Live Orders** adalah papan pesanan Hiryu yang sedang berjalan, dibuka sepanjang hari di laptop kemas. Saat pesanan masuk, Hiryu membunyikan suara dan printer struk mencetak **slip kemas**, kertas dari Grab berisi nomor GM dan barang-barangnya. Slip ini bisa menampilkan nama pelanggan, jadi jangan pernah difoto.

<!--screen:hiryu-copy-->

1. **Packer · laptop → Hiryu Live Orders**

   Suara pesanan baru berbunyi dan slip tercetak. Klik pesanannya untuk membukanya.

   ✓ Yang terlihat: halaman pesanan, dengan *Order GM-…* di bagian atas.

2. **Packer · halaman pesanan · hanya jika muncul Accept**

   Toko memakai penerimaan manual: tekan **Accept** dulu.

   ✓ Yang terlihat: status berubah menjadi ACCEPTED.

3. **Packer · halaman pesanan · Raw payload**

   Biarkan tertutup: tombolnya harus bertuliskan **Show**.

4. **Packer · klik satu kali pada judul *Order GM-…***

   Judul ini hanya teks biasa, jadi mengkliknya tidak mengubah apa pun di Hiryu. Jangan klik di dekat tombol.

5. **Packer · Ctrl + A, lalu Ctrl + C**

   ✓ Yang terlihat: tidak ada yang berubah di layar. Halamannya sudah tersalin.

### 6.2 Tempel ke WMS

<!--screen:paste-->

1. **Packer · laptop → tab WMS → Tempel pesanan Grab**

   Biarkan tab ini terbuka di sebelah Hiryu sepanjang hari. Klik kotak abu-abu, lalu tekan **Ctrl + V**.

   ✓ Yang terlihat: nomor GM, tokonya, setiap baris dengan bin-nya, dan **centang hijau**: jumlah baris dan unit sama dengan hitungan Hiryu sendiri. Teks yang ditempel tidak pernah ditampilkan atau disimpan.

2. **Packer · cek**

   Nomor GM di layar sama dengan nomor di slip.

3. **Packer · Mulai ambil**

   ✓ Yang terlihat: *GM-358 masuk antrean ambil*. HP picker menampilkan pesanan itu. Jika bekerja sendiri: tekan **Ambil sendiri sekarang** dan ambil barangnya sendiri.

| Kata WMS | Lakukan ini |
|---|---|
| *Salinan tidak lengkap* | Kembali ke Hiryu, klik judulnya, Ctrl + A, Ctrl + C lagi |
| *Tutup "Raw payload" dulu* | Di Hiryu tekan *Hide* pada Raw payload, lalu salin lagi |
| *Barang belum dihubungkan* | Beri tahu SPV. Ops HQ menghubungkan itemnya (§2.2.5), lalu paste lagi |
| *Pesanan sudah ada* | Pesanan ini sudah pernah di-paste. Tidak perlu melakukan apa pun |
| *Toko ini milik hub lain* | Salah hub. Beri tahu SPV |
| *Tekan Accept di Hiryu dulu* | Toko memakai penerimaan manual dan pesanan ini belum diterima. Tekan **Accept** di Hiryu, lalu salin lagi |
| *Pesanan terjadwal* | Pesanan ini terjadwal. Pesanan masuk antrean sesuai waktunya; ambil barangnya saat WMS memindahkannya ke paling atas |

### 6.3 Ambil barang

**Siapa:** picker, dengan HP hub dan scanner.

<!--screen:pick-->

1. **Picker · HP hub → WMS station → Ambil pesanan**

   Pesanan berikutnya terbuka sendiri, mulai dari yang sisa waktunya paling sedikit.

   ✓ Yang terlihat: bin pertama, ditandai di rak dan level-nya, foto produk, dan jumlah yang harus diambil.

2. **Picker · di bin**

   Ambil sejumlah angka yang tampil **dari depan**, dari sekat paling lama dulu (§5.4).

3. **Picker · scan setiap unit**

   ✓ Yang terlihat: setiap scan mencentang satu unit, lalu bin berikutnya muncul. **Produk yang salah** menghentikan pengambilan dan menampilkan kedua produk berdampingan: kembalikan barang itu dan ambil yang benar. Jika produk yang salah itu memang ada di bin ini, tekan **Barang ini salah tempat**.

4. **Picker · barang tidak ada, atau kurang**

   Tekan **Barang tidak ada** (§8.1).

5. **Picker · setelah unit terakhir**

   ✓ Yang terlihat: *Pesanan selesai diambil*. Bawa keranjang ke meja kemas, lalu tekan **Serahkan ke meja packing**.

### 6.4 Kemas

**Siapa:** packer di meja kemas.

> **Istilah · Rak siap ambil (ready shelf)**
> Rak di **lantai bawah, di sebelah meja serah terima**, tempat tas yang sudah dikemas menunggu driver Grab. Tas diletakkan berdiri dengan nomor GM menghadap ke luar.

<!--screen:pack-->

1. **Packer · laptop → WMS → Kemas & serah ke driver → Siap dikemas**

   Cari pesanannya. Ambil kemasan yang disebut WMS: **tas kertas** atau **karton** (§6.10). Jika benar-benar tidak muat, tekan **Ganti kemasan** dan pilih alasannya.

2. **Packer · di meja kemas**

   Kemas barangnya. Masukkan slip Hiryu ke dalam kemasan atau tempel di luar, dengan nomor GM terlihat. Dua kemasan: nomor GM di keduanya.

3. **Packer · Hiryu dulu → pesanannya → Mark ready**

   Hiryu memberi tahu Grab bahwa tas sudah siap dan mengurangi unit itu dari stoknya sendiri. (Jika Hiryu sudah menambahkan foto tas yang sudah dikemas, ambil fotonya di sini, sebelum *Mark ready*. WMS tidak menyimpan foto.)

   ✓ Yang terlihat: pesanan keluar dari *Pending packing* di Live Orders.

4. **Packer · lalu WMS → Sudah Mark ready di Hiryu**

   Konfirmasi nomor GM. Slip ini desain Grab dan tidak punya kode untuk di-scan, jadi ketukan ini adalah catatan WMS bahwa pesanan sudah dikemas.

   ✓ Yang terlihat: pesanan pindah ke *Menunggu driver*.

5. **Packer · bawa tasnya ke rak siap ambil di lantai bawah**

### 6.5 Pesanan

- **6.5.1** **Satu kanal di versi pertama: GrabMart Kilat.** Pesanan masuk ke WMS dengan cara ditempel (§6.6). Pesanan WhatsApp masuk versi berikutnya (§19).
- **6.5.2** Setiap pesanan membawa ID pesanan Grab (kunci utama), nomor GM (untuk dibaca orang), toko Hiryu, hub, dan **batas siap = waktu pesanan di Hiryu + 10 menit** *(diubah 28 Sep)*: Hiryu menganggap pesanan terlambat setelah 10 menit, dan perkiraan Grab sendiri di data Malaysia sekitar 7 menit. Tingkat layanan Grab yang sebenarnya masih perlu dikonfirmasi (Q13).
- **6.5.2a** **Pesanan terjadwal.** Hiryu menampilkan *Scheduled time* pada pesanan terjadwal. WMS membacanya; batas siap = waktu terjadwal dikurangi waktu persiapan yang diatur Ops HQ (default 20 menit), sampai Grab mengonfirmasi arti waktu terjadwal itu. Pesanan menunggu di jalur *Terjadwal* dan naik ke atas saat waktunya tiba.
- **6.5.2b** **Penerimaan pesanan mengikuti Hiryu.** Hiryu menampilkan *Acceptance: AUTO* atau *MANUAL* pada pesanan. Di toko MANUAL, pesanan yang ditempel tapi masih berstatus RECEIVED ditolak dengan pesan *Tekan Accept di Hiryu dulu*, jadi WMS tidak pernah memulai pesanan yang belum diterima Hiryu.
- **6.5.3** **Stok langsung ditahan untuk pesanan begitu pesanan ditempel**, jadi dua pesanan tidak mungkin mendapat unit terakhir yang sama. Ditahan artinya unit tetap di rak tapi tidak lagi tersedia untuk pesanan lain.
- **6.5.4** **Antrean pick**: tiga jalur (menunggu, sedang diambil, selesai hari ini), diurutkan berdasarkan sisa waktu sebelum batas siap, bukan berdasarkan umur pesanan. Picker yang menahan pesanan terlalu lama akan ditandai; SPV bisa melepasnya.
- **6.5.5** **Perilaku stok Grab sendiri** *(dikonfirmasi 25 Sep)*: Grab menurunkan stok yang ditampilkannya begitu pesanan dibuat, dan **tidak mengembalikannya saat pesanan dibatalkan**. Jadi setelah pembatalan, Grab menampilkan unit lebih sedikit dari yang ada di hub sampai SPV mengetik ulang stoknya. WMS menandai SKU tersebut sebagai berubah di lembar stok.

### 6.6 Sekarang: pesanan lewat salin dan tempel **[DIPUTUSKAN 21 Sep, build pertama]**

Dua jalan masuk, satu pembaca, satu endpoint:

| | Tempel halaman pesanan | Tombol satu klik |
|---|---|---|
| Yang dilakukan staf | Salin seluruh halaman pesanan Hiryu, tempel di WMS (§6.1, §6.2) | Klik **Kirim ke WMS** di bilah bookmark saat pesanan Hiryu terbuka |
| Build | **Pertama** | Setelah tempel berjalan, dan setelah memberi tahu Shaun dan tim keamanan NV |
| Menyentuh Hiryu? | Tidak | Hanya membaca halaman yang terlihat, seperti menyalin |

#### 6.6.1 Data pelanggan tetap di Hiryu

- Teks yang ditempel **dibaca di browser** dan tidak pernah dikirim. Halaman hanya mengambil kolom di 13.2.2, mengirim kolom itu, lalu mengosongkan kotak, baik tempel berhasil maupun tidak.
- Server hanya menerima kolom itu, tidak ada yang lain; kolom yang tidak dikenal ditolak dan setiap kolom teks punya pola yang ketat.
- **Raw payload ditolak**: tempelan yang berisi data mentah Hiryu (yang memuat nama dan kontak pelanggan) dibuang dengan pesan *Tutup "Raw payload" dulu, lalu salin ulang*.
- Nama dan email staf dari kartu History di Hiryu diabaikan. Harga dan total diabaikan.

#### 6.6.2 Apa yang diambil pembaca

ID pesanan Grab; nomor GM; status Hiryu; nomor toko Hiryu; waktu pesanan; *N lines · M units* milik Hiryu; per baris: jumlah, ID item Hiryu, dan pilihan saat stok habis (ganti, hapus, batalkan, hubungi) beserta item pengganti dan jumlahnya.

- **Juga dibaca**: *Acceptance* (AUTO atau MANUAL, §6.5.2b) dan *Scheduled time* jika ada (§6.5.2a).
- **Catatan pelanggan dibuang.** Kartu Items bisa menampilkan catatan pelanggan di bawah satu baris; pembaca tidak pernah menganggapnya sebagai nama item dan tidak pernah mengirimnya.
- **ID item dicocokkan dengan peta item, bukan dikenali dari prefiksnya**, jadi prefiks apa pun yang dipakai ID item Indonesia tidak masalah.
- **Kuncinya ID pesanan Grab, tidak pernah nomor GM.** Nomor GM bisa berulang (Malaysia sudah punya dua GM-482 yang berbeda).
- **Cek**: jumlah baris yang ditemukan dan total unit harus sama dengan *N lines · M units* di Hiryu. Jika tidak, tidak ada yang dikirim.
- **Bangun berdasarkan tempelan asli**: sebelum membangun, kumpulkan 10 tempelan dari Malaysia (beberapa status, bundel, kedua jenis stok habis, satu pembatalan) dengan data pelanggan dihapus manual. Jika halaman Hiryu berubah, pembaca menolak dengan jelas dan tidak pernah menebak.

#### 6.6.3 Apa yang terjadi saat tempel

| Status Hiryu di tempelan | WMS |
|---|---|
| RECEIVED, ACCEPTED | Pesanan baru: tahan stok, masuk antrean, mulai pengambilan terpandu. Unit per SKU = jumlah × unit per penjualan |
| Pesanan yang sama lagi, masih terbuka | Membuka pengambilan yang sudah ada |
| CANCELLED, REJECTED, FAILED | Menampilkan konfirmasi yang sama dengan tombol *Dibatalkan di Hiryu* (§8.4) |
| DRIVER_ALLOCATED atau setelahnya, belum pernah ditempel | Ditolak; SPV memakai *Catat pesanan terlewat* jika pesanan itu memang sudah diserahkan |
| Toko milik hub lain | Ditolak, dengan menyebut hub yang benar |

Endpoint `POST /api/hiryu/paste`, terbuka untuk staf ke atas di hub itu; mencatat siapa yang menempel, kapan, dan apakah lewat tempel atau tombol.

#### 6.6.4 Tombol satu klik, nanti

Bookmark bernama **Kirim ke WMS** di profil Chrome biasa pada PC pengemasan (bukan profil untuk cetak kiosk). Bookmark ini membaca teks yang terlihat di halaman pesanan Hiryu yang terbuka, menjalankan pembaca yang sama, lalu membuka layar tempel WMS yang sudah terisi dan menunggu *Mulai ambil*. Bookmark ini tidak memanggil apa pun di Hiryu dan tidak membaca login.

### 6.7 Pick terpandu

- **6.7.1** Picker diarahkan ke **satu bin setiap kali**, sesuai urutan jalan, dengan kode bin, foto produk, dan jumlah yang harus diambil.
- **6.7.2** **Setiap unit di-scan.** Produk yang salah menghentikan pick dan menampilkan kedua produk berdampingan. Tidak bisa dilewati.
- **6.7.3** Mengambil beberapa pesanan sekaligus tidak ada di versi pertama. Cara ini baru menguntungkan di atas sekitar 15 pesanan per jam per picker; pilot merencanakan sekitar 7 pesanan per hari per hub.

### 6.8 Ke mana picker diarahkan

Picker pergi ke bin SKU mana pun yang berisi **stok paling lama**. Tidak ada tugas memindahkan stok dari satu bin ke bin lain; picker cukup mengikuti stok paling lama.

### 6.9 Aturan kemas

- **6.9.1** WMS menentukan kemasan sebelum pick dimulai (§6.10). Packer bisa mengubahnya dengan dua ketukan dan alasan dari daftar.
- **6.9.2** **Tidak ada label untuk di-scan** *(25 Sep; urutan diubah 28 Sep)*. Slip packing Hiryu adalah desain Grab dan tidak memuat kode yang bisa dibaca WMS, jadi scan saat pick adalah pengecekannya. Setelah pesanan dikemas, staf menekan *Mark ready* di **Hiryu dulu**, lalu menekan **Sudah Mark ready di Hiryu** di WMS, yang menandai pesanan sebagai **dikemas dan siap** (§0.3.12).

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
| Menunggu | Tempel |
| Sedang diambil | Picker mengambil pesanan |
| Dikemas dan siap | *Sudah Mark ready di Hiryu*, ditekan setelah menekan *Mark ready* di Hiryu |
| Diambil driver | Staf menekan *Sudah diambil driver* |
| Dibatalkan | Tombol *Dibatalkan di Hiryu* |

### 6.12 Hal terbuka

- **Batas kemasan** setelah uji beban (Q8, §6.10.3).
- **Menutup kemasan.** Cara menutup tas atau kardus (staples, lakban, stiker segel), letak slip Hiryu, dan kedua kemasan pada pesanan dua kemasan sama-sama diberi nomor GM.
- **Pilihan pelanggan saat barang habis.** Pembaca tempel mengambilnya (§6.6.2), tapi barang tidak ada selalu membatalkan pesanan (§8.3). Tetap dibaca, atau dihapus?
- **Pesanan terjadwal** (Q13): arti *Scheduled time*. Jalur *Terjadwal* belum dibuat.
- **Tas dan kardus yang terpakai** per pesanan diketahui dari aturan kemasan; stoknya ada di §12.

## 7. Serah ke Grab

**Siapa**: yang membawa tas ke bawah · **Sistem**: WMS; Hiryu terupdate sendiri · **Di dev**: *Kemas & serah ke driver* (layar 21), 28 Sep

### 7.1 Serahkan ke driver Grab

**Siapa:** siapa pun yang ada di meja serah terima di lantai bawah, dengan HP hub kedua.

<!--screen:handover-->

1. **Staf · HP hub kedua → WMS → Kemas & serah ke driver → Menunggu driver**

   ✓ Yang terlihat: semua tas yang menunggu, dengan lama menunggunya. **Kuning** berarti lebih dari 20 menit.

2. **Staf · driver datang**

   Tanyakan nomor pesanannya. Cari tas yang slipnya menunjukkan **nomor GM** yang sama.

3. **Staf · nomornya sama → Ya, sudah diambil driver**

   Konfirmasi, lalu berikan tasnya ke driver.

   ✓ Yang terlihat: tas hilang dari daftar. Hiryu diperbarui sendiri saat Grab mencatat pengambilan.

4. **Staf · nomornya tidak sama**

   Jangan serahkan. Minta driver mengecek aplikasi Grab; panggil SPV jika masih tidak sama.

Jika Hiryu menampilkan pesanan itu sebagai **dibatalkan**, jangan serahkan: tekan **Dibatalkan di Hiryu** pada pesanan itu (§8.2) lalu bongkar kemasannya.

### 7.2 Aturan serah terima **[DIPUTUSKAN 25 Sep]**

- **7.2.1** Pesanan yang sudah dikemas menunggu di **rak siap**. *Serah ke driver* menampilkan daftarnya beserta lama menunggu.
- **7.2.2** Saat driver datang, staf mencocokkan nomor pesanan yang disebut driver dengan nomor GM di slip, lalu menekan **Sudah diambil driver**. WMS mencatat siapa yang menyerahkan dan kapan. Pesanan **selesai** di WMS.
- **7.2.3** Kantong yang menunggu lebih dari 20 menit (bisa diatur) berwarna kuning dan memberi tanda ke SPV.
- **7.2.4** Tidak ada foto yang disimpan di WMS: slip packing di kantong bisa menampilkan nama pelanggan (§0.3.11). Foto kantong yang sudah dikemas, sebagai bukti jika ada sengketa, direncanakan **di Hiryu** *(28 Sep)*; begitu fiturnya ada, staf mengambil foto di sana sebelum menekan *Mark ready*.

### 7.3 Hal terbuka

- **Driver tidak datang.** Setelah tanda 20 menit, SPV mengecek Hiryu. Kalau pesanan masih aktif, lalu apa: hubungi dukungan merchant Grab, tetap menunggu, atau minta driver baru?
- **Bukti dari driver.** Apa yang diterima staf kalau driver tidak punya nomor pesanan, atau menyebut nomor yang salah.
- **Satu orang bertugas** yang membawa tas ke bawah meninggalkan laptop saat pesanan masuk. *Usulan:* diterima untuk pilot; jeda hub kalau dua pesanan *Late* (§13.2).
- **Foto bukti di Hiryu** (Q14): belum ada tanggal.

## 8. Pembatalan dan retur

**Siapa**: staf, SPV · **Sistem**: Hiryu dulu, lalu WMS · **Di dev**: *Dibatalkan di Hiryu*, barang tidak ada dengan langkah batal, kembalikan ke rak, 28 Sep. Kembalian dari driver, surat jalan retur, retur ke merek: belum

### 8.1 Barang tidak ada atau kurang

Jika ada barang yang tidak ada, **seluruh pesanan dibatalkan**. Grab tidak mengizinkan pesanan diubah. Jadi Hiryu tidak bisa mengirim sebagian pesanan, dan barang pengganti juga tidak bisa dicatat.

<!--screen:short-->

1. **Picker · HP hub → Barang tidak ada**

   Isi apa yang kamu temukan: **Tidak ada sama sekali**, atau atur jumlahnya dengan − dan +.

   ✓ Yang terlihat: *Cek dulu di tempat lain*, dengan tempat lain yang tercatat di WMS menyimpan SKU itu (bin lain, bin sementara barang masuk).

2. **Picker · cari di sana**

   Jika ketemu: tekan **Ketemu, lanjut ambil**. Pengambilan berlanjut dari bin itu.

3. **Picker · masih tidak ada → Catat, lalu panggil SPV**

   ✓ Yang terlihat: *Pesanan harus dibatalkan* dengan nomor GM. Berhenti mengambil pesanan ini dan panggil SPV.

4. **SPV · Hiryu dulu → pesanannya → Cancel order**

   Alasan **2001 Item out of stock**.

   ✓ Yang terlihat: pesanan CANCELLED di Hiryu.

5. **SPV · di HP picker → Sudah dibatalkan di Hiryu**

   Konfirmasi nomor GM.

   ✓ Yang terlihat: pesanan dilepas. Barang yang sudah diambil masuk ke **Kembalikan ke rak**.

6. **Staf · WMS station → Kembalikan ke rak → Kerjakan**

   Scan setiap unit yang sudah diambil kembali ke bin-nya.

7. **SPV · langsung ketik stok SKU itu ke Hiryu** (§9.2), supaya Grab berhenti menjualnya.

### 8.2 Pesanan dibatalkan

<!--screen:cancel-->

1. **Siapa saja · Hiryu menampilkan pesanan sebagai CANCELLED** (di Live Orders atau di halaman pesanan).

2. **Staf · WMS · buka pesanannya** dari antrean ambil, layar ambil, atau *Kemas & serah ke driver*, lalu tekan **Dibatalkan di Hiryu**.

3. **Staf · periksa nomor GM lalu konfirmasi**

   ✓ Yang terlihat: pesanan hilang dari daftar. Barang yang sudah diambil masuk ke **Kembalikan ke rak**.

4. **Staf · tas yang sudah dikemas** · bongkar dulu.

5. **Staf · WMS station → Kembalikan ke rak → Kerjakan**

   Scan setiap unit, lalu bin yang disebut WMS.

   ✓ Yang terlihat: setiap unit kembali menjadi stok saat bin-nya di-scan.

6. **Staf · beri tahu SPV.** Hiryu tidak mengembalikan unit pesanan yang dibatalkan ke stoknya, jadi SPV mengetik ulang stok SKU itu (§9.2).

Jika tombol batal tertekan tanpa sengaja: SPV membuka **WMS → Pesanan → pesanannya → Buka lagi**, lalu pesanan itu di-paste lagi dari Hiryu.

### 8.3 Jika barang tidak ada **[DIPUTUSKAN 28 Sep]**

Grab tidak mengizinkan pesanan diubah, jadi Hiryu tidak bisa mengirim sebagian pesanan atau mencatat barang pengganti. **Barang yang tidak ada membatalkan seluruh pesanan**, dengan alasan **2001 Item out of stock**.

1. Picker menekan **Barang tidak ada** dan mengisi berapa yang ditemukan: tidak ada, atau angka yang diatur dengan − dan +.
2. WMS **menghentikan pesanan** dan menampilkan tempat lain di hub ini yang tercatat menyimpan SKU itu (bin lain, bin sementara barang masuk yang belum disimpan ke rak). Jika picker menemukannya di sana: **Ketemu, lanjut ambil**, dan pengambilan berlanjut.
3. Jika tidak, SPV membatalkan di **Hiryu dulu** (*Cancel order*, alasan 2001), lalu menekan **Sudah dibatalkan di Hiryu** di WMS. WMS melepas pesanan; unit yang sudah diambil dikembalikan ke rak.
4. SPV langsung mengetik stok SKU itu ke Hiryu (§9.2).

Saat *Barang tidak ada* ditekan, WMS juga:

- **mengubah hitungan bin menjadi jumlah yang ditemukan**, agar pesanan lain tidak diarahkan ke bin yang kosong;
- **memasukkan SKU ke lembar stok** dan ke hitung cek berikutnya (§10.1);
- **memberi tahu SPV**, dengan menyebut nama picker.

Di sini picker boleh menurunkan stok tanpa SPV, karena kalau menunggu, Grab terus menjual produk yang tidak ada di hub. Untuk mencegah penyalahgunaan, SPV melihat setiap laporan beserta nama picker.

Karena setiap barang yang tidak ada membatalkan satu pesanan utuh dan menurunkan penilaian toko, **pencegahan paling penting**: cadangan Grab (§9.5), mengetik stok di setiap pemicu (§9.2), dan hitung stok (§10.1).

### 8.4 Pembatalan **[DIPUTUSKAN 25 Sep]**

Pembatalan cukup dengan **satu tombol**, bukan tempel. Saat Hiryu menampilkan pesanan sebagai dibatalkan, staf menekan **Dibatalkan di Hiryu** pada pesanan itu di WMS (antrean, pick, pack, atau serah terima) dan mengonfirmasi nomor GM. WMS melepas stok yang ditahan; unit yang sudah diambil masuk ke **Kembalikan ke rak**, tempat staf mana pun men-scan setiap unit kembali ke bin-nya, dan setiap scan mengembalikannya ke stok. Kantong yang sudah dikemas dibongkar dulu. Penekanan tombol dicatat dengan nama staf; SPV bisa membuka kembali pesanan yang dibatalkan karena salah. Cek pesanan akhir hari (§13.4) menangkap pembatalan yang tidak ditekan siapa pun.

### 8.5 Masalah pesanan

| Masalah | Yang dilakukan WMS | Siapa yang bertindak |
|---|---|---|
| Tempel ditolak (item belum dipetakan) | Item masuk ke *Perlu dipetakan* milik HQ; pesanan menunggu | Ops HQ memetakannya; staf menempel lagi |
| Pesanan ada di Hiryu, tidak pernah ditempel | Muncul di cek pesanan akhir hari | SPV. Jika sudah diserahkan, SPV menempelnya dengan **Catat pesanan terlewat**: WMS mengurangi stok tanpa pick dan menandainya tidak di-scan |
| Pembatalan yang tidak ditekan siapa pun | Muncul di cek pesanan | SPV menekan *Dibatalkan di Hiryu*; unit yang sudah diambil kembali ke rak |
| Kantong tidak diambil | Kuning setelah 20 menit, tanda ke SPV | SPV mengecek Hiryu; jika dibatalkan, bongkar kemasannya |
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

**Siapa**: SPV · **Sistem**: WMS, lalu Hiryu, lalu WMS · **Di dev**: *Stok untuk Hiryu*, 28 Sep. Tanda 2 jam: belum

### 9.1 Bagaimana angka berubah

| Di mana | Siapa yang mengubah | Kapan berubah |
|---|---|---|
| **WMS** (hitungan sebenarnya) | Scan staf | Setiap simpan ke rak, ambil barang, hitung stok, retur, dan laporan masalah |
| **Hiryu** (Units on hand) | **Hanya SPV**, dengan mengetik | Saat SPV mengetik. Hiryu juga mengurangi unit sendiri saat pesanan **ditandai siap**. Hiryu tidak pernah mengembalikan unit pesanan yang dibatalkan |
| **Grab** (yang dilihat pelanggan) | Hiryu | Setiap kali SPV menyimpan stok di Hiryu. Grab juga menurunkan angkanya sendiri begitu pesanan dibuat, dan tidak menaikkannya lagi jika pesanan dibatalkan |

Jadi angka Grab hanya benar sampai saat terakhir SPV mengetik stok. **Hanya SPV yang mengetik stok ke Hiryu**, karena SPV yang bertanggung jawab atas dark store. Ops HQ tidak mengetik stok, kecuali sebagai pengganti yang ditunjuk SPV.

### 9.2 Kapan mengetik stok ke Hiryu

| Saat | SKU yang mana |
|---|---|
| **Saat buka**, sebelum toko buka di Grab | Semua (baris berwarna) |
| **Setelah kiriman disimpan ke rak** | SKU dalam kiriman itu |
| **Setelah setiap pesanan dibatalkan** | SKU dalam pesanan itu |
| **Setelah ada barang tidak ada** (§8.1) | SKU itu, langsung |
| **Setelah hitungan stok ditandatangani** | SKU yang dihitung |
| **Setelah keputusan karantina** (kembali ke rak, hapus stok) | SKU itu |
| **Tengah hari**, pukul 13:00 | Semua baris berwarna |
| **Akhir hari** | Semua baris berwarna, setelah cek pesanan (§13.3) |

WMS menandai setiap SKU yang angkanya berubah tapi belum diketik dalam 2 jam.

### 9.3 Cara mengetik

**Siapa:** SPV, di laptop kemas. Setiap hub punya **dua toko** (Kahf dan Labore): ketik keduanya.

<!--screen:eod-->

1. **SPV · Hiryu → Live Orders · pilih saat sepi jika bisa**

   Paling baik jika *Pending accept* dan *Pending packing* sama-sama **0**: dengan begitu Grab langsung menampilkan angka yang benar. Jika tidak bisa menunggu, tetap ketik: angka WMS sudah memperhitungkan pesanan yang sedang berjalan, jadi angka Hiryu akan benar setelah pesanan itu ditandai siap.

<!--screen:hiryu-live-->

2. **SPV · WMS → Stok untuk Hiryu**

   ✓ Yang terlihat: satu tabel per toko. Baris yang perlu diketik **berwarna**; setiap baris menampilkan **Kode SKU di Hiryu** dan angka di bawah **Ketik di Hiryu**.

3. **SPV · Hiryu → Stores → toko pertama → Stock**

   Untuk setiap baris berwarna, cari **Kode SKU di Hiryu** yang sama (tercetak di bawah nama SKU di Hiryu) lalu ketik angka dari *Ketik di Hiryu* ke **Units on hand**. Tekan **Save stock**.

<!--screen:hiryu-stock-->

   ✓ Yang terlihat: Hiryu menyimpan angkanya.

4. **SPV · lalu WMS → Sudah disimpan di Hiryu** untuk toko itu

   ✓ Yang terlihat: baris tidak lagi berwarna, dengan waktu kamu mengetik.

5. **Ulangi langkah 3 dan 4 untuk toko lain di hub itu.**

Jangan pernah memakai kolom **Arrived** di Hiryu: kolom itu menambah hitungan, padahal angka WMS sudah termasuk kiriman itu.

### 9.4 Sekarang: stok diketik manual **[DIPUTUSKAN 25 Sep, build pertama]**

- **9.4.1** *Stok untuk Hiryu*, satu tabel per toko Hiryu: **Kode SKU di Hiryu**, nama, stok tersedia di WMS, cadangan Grab, **Ketik di Hiryu**, nilai terakhir yang diketik, dan tanda berubah. Diurutkan menurut kode SKU Hiryu, seperti tab Stock di Hiryu, supaya kedua layar sejajar.
- **9.4.2** **Ketik di Hiryu = unit di rak + unit yang sudah diambil untuk pesanan yang belum ditandai siap − cadangan Grab, tidak pernah di bawah 0** *(diubah 28 Sep)*. Hiryu tetap akan mengurangi setiap pesanan yang belum ditandai siap, jadi angka ini benar kapan pun diketik; pesanan yang belum ditempel masih ada di rak dan nanti dikurangi oleh Hiryu. Unit di karantina atau di bin inbound sementara tidak termasuk unit di rak.
- **9.4.3** Baris ditandai berubah jika angkanya berbeda dari nilai terakhir yang diketik, dan selalu ditandai setelah ada pembatalan untuk SKU itu (Grab tidak mengembalikan hitungannya, §6.5.5).
- **9.4.4** **Hanya SPV hub yang mengetik stok** *(diputuskan 28 Sep)*, karena SPV yang bertanggung jawab atas dark store; Ops HQ hanya sebagai pengganti yang ditunjuk SPV. SPV mengetik baris yang berubah ke *Units on hand* di Hiryu, menyimpan di Hiryu, lalu mengetuk **Sudah disimpan di Hiryu**; WMS mencatat setiap nilai sebagai sudah diketik. Kapan mengetik ada di §9.2.
- **9.4.5** **Sebaiknya saat sepi** *(dikonfirmasi 28 Sep)*: Hiryu mengurangi stok saat pesanan ditandai siap, dan tidak pernah mengembalikan unit dari pesanan yang dibatalkan. Dengan 0 *Pending accept* dan 0 *Pending packing*, Grab langsung menampilkan angka yang benar; selama ada pesanan yang sedang berjalan, Grab sebentar ikut menampilkan unit-unit itu, sampai pesanan ditandai siap. Setelah setiap pembatalan, SKU di dalamnya diketik ulang.
- **9.4.6** Jangan pernah memakai kolom *Arrived* di Hiryu (*Add to stock*): kolom itu menambah hitungan Hiryu.

### 9.5 Cadangan Grab (Grab buffer) **[DIPUTUSKAN 25 dan 28 Sep]**

**Apa itu**: beberapa unit dari setiap SKU yang tidak kita tampilkan ke Grab. Jika WMS mencatat 5, Grab diberi tahu 4. Unit cadangan itu menutup salah hitung, unit rusak yang belum dilaporkan siapa pun, atau pesanan yang masuk sebelum SPV mengetik. Tanpa cadangan, unit yang ternyata tidak ada berarti barang tidak ada, dan barang yang tidak ada membatalkan seluruh pesanan (§8.3).

**Diputuskan**: **1 unit per SKU secara bawaan** sejak go-live. Ops HQ bisa mengatur SKU mana pun ke 0, angka lain, atau persentase dari stok tersedia (§4.5.3). Ninja yang menetapkannya, sebagai perencana stok untuk dark store miliknya sendiri.

**Efek samping**: *Units on hand* di Hiryu lebih rendah dari hitungan sebenarnya sebesar cadangan itu, jadi **laporan selalu diambil dari WMS**, tidak pernah dari Hiryu. **Cara menerapkannya** *(28 Sep)*: Hiryu saat ini tidak punya pengaturan buffer (tidak ada di layarnya sekarang), jadi cadangan ini bukan fitur Hiryu. Cadangan diterapkan **oleh WMS**: angka *Ketik di Hiryu* di lembar stok sudah dikurangi cadangan, dan SPV mengetik angka itu ke Hiryu seperti biasa (§9.4). Tidak ada langkah tambahan. Jika nanti Hiryu menambah pengaturan buffer (Q16), angkanya dipindah ke sana.

### 9.6 Hal terbuka

- **SPV berhalangan.** Hanya SPV yang mengetik stok; pengganti "ditunjuk SPV" (§9.4.4), tapi tidak ada yang mencatat siapa. *Usulan:* SPV menunjuk pengganti di WMS untuk rentang tanggal tertentu.
- **Waktu mengetik.** 105 SKU di dua toko makan waktu saat buka. Apakah tab Stock Hiryu bisa menerima unggahan CSV? *Tanyakan:* tim Hiryu.
- **Stok awal di hari go-live** mengikuti §0.4 langkah 8 sampai 11. Waktu tepatnya (diketik setelah kiriman pertama disimpan, sebelum aktivasi) masuk ke rencana go-live.

## 10. Stock opname

**Siapa**: staf menghitung; SPV, Ops HQ dan Ops Head menyetujui · **Sistem**: WMS, lalu Hiryu · **Di dev**: hitung buta, hitung ulang, satu persetujuan. Persetujuan tiga langkah dan rencana hitung: belum

### 10.1 Kapan menghitung stok

| Hitungan | SKU yang mana | Seberapa sering | Siapa |
|---|---|---|---|
| **Hitung rutin** | 20% SKU teratas menurut unit terjual | Setiap minggu | Staf menghitung, SPV memeriksa |
| **Hitung rutin** | Semua SKU lainnya | Setiap bulan | Staf menghitung, SPV memeriksa |
| **Hitung khusus** | SKU yang pernah kena barang tidak ada, unit ditemukan, atau laporan karantina | Hari berikutnya | Staf menghitung, SPV memeriksa |
| **Hitung penuh** | Setiap SKU di hub | Hari terakhir setiap bulan, sebelum laporan sell-out ke merek | Staf menghitung, SPV dan Ops HQ memeriksa |

Selisih yang ditemukan saat hitung stok harus disetujui **SPV, lalu Ops HQ, lalu Ops Head** sebelum WMS mengubah stok. Unit yang ternyata **kurang** langsung dikeluarkan dari stok yang bisa dijual selama persetujuan berjalan, supaya Grab berhenti menjualnya. Unit yang ternyata **lebih** baru ditambahkan setelah Ops Head menyetujui. Setelah itu, ketik SKU-nya ke Hiryu (§9.2).

> **Istilah · Hitung buta (blind count)**
> Orang yang menghitung tidak pernah melihat angka yang diharapkan WMS. Ia men-scan apa yang benar-benar ada di bin, jadi hitungannya tidak terpengaruh angka sistem.

#### 10.1.1 Cara menghitung

1. **SPV · WMS → Hitung stok → Rencana**

   ✓ Yang terlihat: bin yang harus dihitung hari ini (hitung rutin dan hitung khusus). Bagikan ke staf.

2. **Staf · HP hub → WMS station → Hitung stok → scan label bin**

   Bin itu dikunci untukmu selama kamu menghitung; angka WMS tetap tersembunyi.

3. **Staf · scan setiap unit di bin, lalu Selesai**

   ✓ Yang terlihat: *Cocok*, atau ada selisih.

4. **Staf · ada selisih → Hitung ulang**

   Hitung bin itu sekali lagi. Baru setelah itu WMS menampilkan kedua angka.

5. **SPV → Ops HQ → Ops Head · WMS → Hitung stok → Hasil**

   Masing-masing memeriksa selisihnya, lalu menyetujui atau mengembalikannya dengan catatan, sesuai urutan itu, oleh tiga orang yang berbeda (§10.2).

   ✓ Yang terlihat: stok dikoreksi setelah Ops Head menyetujui.

6. **SPV · ketik SKU yang dihitung ke Hiryu** (§9.2).

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
| **Laptop kemas** (dari kit) | 1 | Meja kemas, lantai atas | Live Orders Hiryu, copy dan paste ke WMS, *Mark ready*, SPV mengetik stok | Packer yang sedang bertugas; SPV untuk stok | Dicolok sepanjang hari |
| **Printer struk** (dari kit) | 1 | Di sebelah laptop | Slip kemas Hiryu, tercetak sendiri | Tidak ada: berjalan sendiri | Dicolok |
| **Printer A4** (sudah ada di stasiun) | 1 | Stasiun | Label (§3.1, §3.2), nota retur (§8.6), catatan kertas (§14) | SPV | Dicolok |
| **HP hub untuk picking**, dengan WMS terpasang, dan **scanner 2D nirkabel** dari kit yang terhubung ke HP itu | 1 + 1 | Dibawa | Picking, putaway, penerimaan, hitung stok, *Laporkan masalah* | Picker yang sedang bertugas; diserahkan saat ganti shift | Di meja kemas saat malam |
| **HP hub untuk serah terima** (atau tablet) | 1 | Meja serah terima, lantai bawah | *Kemas & serah ke driver*, rak siap ambil | Siapa pun yang membawa tas ke bawah | Di meja serah terima |

- **Satu laptop, banyak orang.** Pengaturan printer di laptop tetap tersimpan, siapa pun yang masuk, karena Hiryu menyimpan printer per browser, bukan per orang. Hanya orang yang sedang memakai laptop yang masuk. Orang berikutnya mengeluarkan akun orang sebelumnya, lalu masuk dengan akunnya sendiri.
- **Dua orang bertugas** (target 5 menit): satu orang mengambil barang dengan HP picking, satu orang lagi paste, mengemas, dan menekan Mark ready di laptop, lalu membawa tas ke bawah. **Satu orang bertugas**: dia mengerjakan keduanya, dengan urutan yang sama, dan membawa HP picking ke bawah.
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

**Siapa**: SPV · **Sistem**: Hiryu dan WMS · **Di dev**: tab stok saja. Laporan akhir hari: belum

### 13.1 Selama shift: yang dipantau SPV

- **Barang tidak ada** (§8.1): datangi picker dan cek tempat lain yang ditunjuk WMS. Jika memang tidak ada, batalkan **di Hiryu dulu** (*Cancel order*, alasan 2001), lalu tekan *Sudah dibatalkan di Hiryu*. Setelah itu ketik stok SKU itu ke Hiryu.
- **Pengingat**: draf restock yang perlu dikirim, kiriman yang lewat tanggalnya, selisih yang perlu dikonfirmasi, kiriman yang menunggu Ops HQ.
- **Serah ke driver**: tas yang berwarna kuning selama 20 menit atau lebih. Cek pesanannya di Hiryu. Jika Grab membatalkannya, tekan *Dibatalkan di Hiryu* dan minta staf membongkar kemasannya.

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

1. **SPV · Hiryu → Orders**

   Atur *Dark store* ke hub ini, lalu *From* dan *To* ke hari ini. Klik judul *Orders*, tekan **Ctrl + A**, lalu **Ctrl + C**.

<!--screen:hiryu-orders-->

2. **SPV · WMS → Laporan akhir hari → Cek pesanan → paste**

   ✓ Yang terlihat: tiga daftar: ada di Hiryu tapi tidak di WMS; dibatalkan di Hiryu tapi masih terbuka di WMS; ada di WMS tapi tidak di Hiryu.

3. **SPV · perbaiki setiap baris**

   Pesanan yang belum pernah di-paste: paste sekarang, atau pakai *Catat pesanan terlewat* jika sudah diserahkan. Pembatalan yang belum ditekan siapa pun: *Dibatalkan di Hiryu* (§8.2). Pesanan yang ada di WMS tapi tidak ada di Hiryu: cek nomor GM-nya di Hiryu.

4. **SPV · ketik stoknya** (§9.3).

5. **SPV · Masalah hari ini**

   Putuskan masalah yang masih terbuka, catat jeda hub jika ada, dan tinggalkan catatan untuk SPV besok.

6. **SPV · perangkat**

   Semua orang keluar dari Hiryu dan WMS; HP dan scanner diisi dayanya (§12.1).

### 13.4 Laporan akhir hari **[DIPUTUSKAN 25 Sep]**

Satu layar per hub, **Laporan akhir hari**, untuk SPV menutup hari di Hiryu:

| Tab | Isi |
|---|---|
| **Stok untuk Hiryu** | §9.4, semua SKU, baris yang berubah di atas |
| **Cek pesanan** | Tempel daftar pesanan Hiryu hari itu (daftar ini tidak memuat data pelanggan; WMS hanya menyimpan ID pesanan Grab, nomor GM, toko, dan status). Tiga daftar: ada di Hiryu tapi tidak di WMS; dibatalkan di Hiryu, masih terbuka di WMS; ada di WMS tapi tidak di Hiryu |
| **Masalah hari ini** | Laporan, keputusan, semua yang masih terbuka |
| **Penjualan** | Unit terjual per SKU hari ini; menjadi masukan laporan sell-out bulanan (§15.1) |

Bisa diunduh sebagai CSV. Tab *Stok untuk Hiryu* yang sama dipakai saat buka toko dan setelah setiap pengiriman.

### 13.5 Hal terbuka

- **Daftar cek buka toko.** Belum ditulis: login, perangkat terisi daya, kertas printer, cek *Pengingat* dan baki karantina, ketik stok awal (§9.2), lalu buka.
- **Jam kerja dan shift** untuk pilot, serta serah terima antar shift atau antar SPV.
- **Istirahat saat hanya satu orang bertugas**: jeda hub atau tidak.
- **Tugas mingguan dan bulanan SPV.** Tugasnya tersebar di beberapa bagian (daftar bin cetak setiap Senin §14.1, hitung berkala §10.1, bahan habis pakai §12, cek hubungan barang §2.3). Satu kalender akan membantu.

## 14. Gangguan sistem dan rencana cadangan

**Siapa**: semua yang bertugas, SPV, Ops HQ · **Sistem**: kertas, lalu WMS · **Di dev**: belum (daftar bin cetak, catatan kertas, *Catat pesanan terlewat*)

### 14.1 Jika sistem mati

| Apa yang mati | Tandanya | Lakukan ini |
|---|---|---|
| **WMS**, kurang dari 15 menit | WMS tidak bisa dibuka atau menampilkan *Tidak terhubung* | Tetap terima pesanan. Ambil barang berdasarkan **daftar bin cetak** di meja kemas (setiap SKU dengan bin-nya, dicetak setiap Senin dan setiap kali rak berubah). Tulis setiap pesanan di **catatan kertas** (nomor GM, SKU, jumlah, bin). Tanpa scan |
| **WMS**, lebih dari 15 menit | Masih mati | **Jeda hub** di Grab selama 1 jam (§13.2). Selesaikan pesanan yang sudah masuk, dari catatan kertas. Beri tahu Ops HQ |
| **Internet di hub** | Hiryu dan WMS sama-sama tidak bisa dibuka | Sambungkan laptop ke **data seluler HP picking**. Jika itu juga gagal, telepon Ops HQ: mereka menjeda hub dari kantor |
| **Hiryu** | Hiryu tidak bisa dibuka; tidak ada pesanan baru | Tidak ada yang perlu diambil. Telepon Ops HQ, yang akan menghubungi tim Hiryu (Shaun Cong) |
| **Listrik** | Laptop memakai baterai, printer mati | Tulis nomor GM di setiap tas dengan tangan. Lanjutkan kerja dengan baterai; jeda hub jika listrik tidak menyala lagi dalam 30 menit |
| **Printer struk** | Slip tidak keluar | Tulis nomor GM di tas; pesan gulungan kertas baru atau laporkan printernya |

**Setelah WMS menyala lagi:**

1. **SPV · WMS → Tempel pesanan Grab → Catat pesanan terlewat**

   Paste setiap pesanan dari catatan kertas. WMS mengurangi stok tanpa scan ambil dan menandainya *unscanned*.

2. **SPV · paste pembatalan yang ada** lalu tekan *Dibatalkan di Hiryu* (§8.2).

3. **SPV · WMS → Hitung stok** · rencanakan **hitung khusus** untuk setiap bin yang tertulis di catatan kertas (§10.1.1).

4. **SPV · ketik stok ke Hiryu** (§9.3).

### 14.2 Hal terbuka

- **Daftar kontak** di meja kemas: siapa yang dihubungi untuk Hiryu, dukungan merchant Grab, Ops HQ yang bertugas dan IT, dengan nomornya.
- **Alat kertas.** Daftar bin cetak, formulir catatan kertas dan *Catat pesanan terlewat* belum dibuat; catatan kertas butuh templat.
- **Masalah di sisi Grab** (Grab berhenti mengirim pesanan, menu tidak mau sinkron) belum dibahas.

## 15. Laporan ke merek

**Siapa**: Ops HQ · **Sistem**: WMS · **Di dev**: harga Hiryu tersimpan setiap unggah menu. Laporannya sendiri: belum

### 15.1 Laporan sell-out bulanan ke merek **[DIPUTUSKAN 28 Sep]**

Ninja mengirim laporan bulanan ke setiap merek: unit terjual dan unit tersisa per SKU, per hub, beserta nilai penjualan. Jumlah unit berasal dari WMS. **Nilainya memakai harga Hiryu sendiri**, yaitu harga yang dibayar pelanggan di Grab: setiap unggahan menu (§2.12) menyimpan harga setiap item beserta tanggalnya, dan setiap baris yang terjual dinilai dengan harga item itu pada hari pesanan (paket isi 2 dengan harga paket isi 2). WMS tetap tidak mengambil uang dari pesanan (§0.3.11); harganya berasal dari menu, bukan dari pesanan. Tab *Penjualan* di laporan akhir hari (§13.4) menyusunnya hari demi hari; Ops HQ mengunduh data satu bulan sebagai CSV. *Unit tersisa* berasal dari hitung stok penuh di hari terakhir bulan itu (§10.1).

### 15.2 Hal terbuka

- **Siapa penerimanya.** Untuk Kahf dan Labore (model 3PL Grab), laporan dikirim ke merek, ke Grab, atau keduanya (§2.11.3)?
- **Kapan dan bagaimana.** Tanggal berapa tiap bulan, formatnya (CSV atau PDF), siapa yang mengirim, dan berapa lama merek boleh mempertanyakannya.
- **Laporan lain** yang mungkin diharapkan merek: stok mingguan, daftar hampir kedaluwarsa, penghapusan stok dan retur, selisih kiriman. Belum diputuskan.
- **Penagihan.** Unit terjual menentukan tagihan. Penyelesaian pembayaran di luar WMS (§20), tapi laporannya harus sama dengan yang dipakai bagian keuangan.

---

# Bagian C. Status dan keputusan

## 16. Status build

Per 30 September 2026. **Dev** = sudah di wms-test--dev untuk diuji (build pertama, 28 Sep). **Sudah dibuat** = ada di aplikasi dari build sebelumnya. Belum ada yang di produksi.

| Proses | Di dev atau sudah dibuat | Belum |
|---|---|---|
| 1. Login dan akses pengguna | Login Google, daftar pengguna | Peran Ops Head dengan persetujuan terakhir untuk selisih dan penghapusan stok; SPV hanya menambah staf; hanya akun @ninjavan.co |
| 2. Pendaftaran dan pengaturan toko | Dev: *Menu & toko Hiryu* (unggah CSV menu, hubungkan barang, peta toko, harga tersimpan) | SKU dibuat dari unggahan menu; *Lengkapi data SKU*; satu menu per toko (item dan harga disimpan per toko); form merek; *Unduh daftar item*; scan konfirmasi barcode |
| 3. Pengaturan rak | Rak dan bin, satu bay; peta hub | Rak dimasukkan sesuai hitungan (bay, bin ke samping, tumpukan), tanpa tipe rak; lembar label A4 dengan garis potong; *Cek label*; *Pindah bin*; bin inbound sementara; baki karantina sebagai lokasi |
| 4. Restock dan batas stok | Permintaan restock, persetujuan selisih, pengingat, draf otomatis | *Buat permintaan* untuk pengiriman pertama; kolom *Catat pengiriman* termasuk ED; unit atau %; isi maks. per bin yang dipelajari dan pertanyaan bin kedua; selisih tiga langkah |
| 5. Barang masuk dan penyimpanan | Terima per AWB dalam batch, daftar penyimpanan, produk tak dikenal ke HQ | ED per batch; kiriman tanpa AWB tercatat; scan ulang dan ketik digit sebelum *tak dikenal* |
| 6. Ambil dan kemas | Dev: tempel (layar 20), ambil terpandu, batas siap 10 menit, nomor GM di layar ambil | Aturan kemasan; jalur *Terjadwal* |
| 7. Serah ke Grab | Dev: *Kemas & serah ke driver* (layar 21) | |
| 8. Pembatalan dan retur | Dev: *Dibatalkan di Hiryu*, barang tidak ada (cek tempat lain, lalu batal), kembalikan ke rak, buka lagi (SPV) | Kembalian dari driver; surat jalan retur; retur ke merek |
| 9. Update stok harian | Dev: *Stok untuk Hiryu* | Tanda 2 jam |
| 10. Stock opname | Hitung buta, hitung ulang, persetujuan | Rencana hitung; persetujuan tiga langkah |
| 11. Klaim dan karantina | | Semua di §11 |
| 12. Bahan habis pakai dan infrastruktur | | Di luar WMS untuk saat ini |
| 13. Rutinitas shift | | Laporan akhir hari (*Cek pesanan*, *Masalah hari ini*, *Penjualan*) |
| 14. Gangguan sistem | | Daftar bin cetak, catatan kertas, *Catat pesanan terlewat* |
| 15. Laporan ke merek | Harga tersimpan setiap unggah menu | Laporan penjualan bulanan |

**Deploy berikutnya ke dev**: (2) pendaftaran dan peran (Ops Head, hanya @ninjavan.co), SKU dari unggahan menu dengan *Lengkapi data SKU*, satu menu per toko, form merek, rak sesuai hitungan dengan lembar label; (3) karantina dan persetujuan, kedaluwarsa per batch, kemasan, laporan akhir hari. Tombol satu klik menyusul setelah fitur tempel berjalan di hub.

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
