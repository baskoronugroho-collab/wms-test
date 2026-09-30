# Ninja Kilat WMS: kebutuhan sistem dan instruksi kerja

| | |
|---|---|
| **Produk** | Ninja Kilat WMS |
| **Versi** | v4.0: isi yang sama dengan v3.3, disusun per proses. Bagian A berisi yang dibaca semua orang sekali; Bagian B punya satu bagian per proses, masing-masing berisi langkah di kedua sistem (Hiryu dulu), aturan, dan hal terbuka yang masih perlu dimatangkan; Bagian C berisi status build dan keputusan |
| **Tanggal** | 29 September 2026 |
| **Pemilik** | Baskoro Nugroho |
| **Status** | Spesifikasi untuk ditinjau, proses demi proses. Layar WMS masih draf; build pertama sudah di dev |
| **Acuan** | *QC Systems: Hiryu, WMS, TMS* (ChangWen, 11 Sep 2026), `docs/canonical/qc-oms-wms.html`, untuk desain jangka panjang. Jika build pertama butuh solusi sementara (belum ada koneksi ke Hiryu), halaman ini menyebutkannya |
| **Menggantikan** | v3.3 tanggal 28 September (disimpan di `docs/archive/PRD-v3.3.md`; nomor bagiannya ada di Lampiran C) dan semua versi sebelumnya |
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

Sebelum pesanan Grab pertama, langkah-langkah ini dikerjakan **sesuai urutan ini**. Setiap langkah menyebut siapa yang mengerjakan dan di sistem mana.

| # | Siapa | Di mana | Langkah | Lihat |
|---|---|---|---|---|
| 1 | Ops HQ (ADMIN) | Hiryu | Negara dan mata uang, satu kali; dark store, jam bukanya, login MANAGER untuk SPV | §2.1.1 |
| 2 | Ops HQ | WMS | Daftarkan dark store yang sama dan orangnya (SPV dulu) | §2.1.2, §1.3 |
| 3 | SPV | WMS | Bin sementara barang masuk dan baki karantina, lalu rak | §3.1, §3.2 |
| 4 | SPV | Hiryu, lalu WMS | Login staf di Hiryu, lalu akun staf di WMS | §1.3.1 |
| 5 | Ops HQ | Hiryu | SKU, lalu menu, lalu hubungkan setiap item ke SKU-nya | §2.2.1 sampai §2.2.3 |
| 6 | Ops HQ | WMS | Tambahkan merek, daftarkan setiap SKU dengan kode Hiryu-nya, upload menu Hiryu | §2.2.4 sampai §2.2.6 |
| 7 | SPV | WMS | Beri setiap SKU satu bin di hub | §3.3 |
| 8 | SPV dan staf | WMS | Kiriman pertama dari merek: permintaan restock, AWB, terima | §4.1, §5 |
| 9 | Ops HQ | Hiryu | Buat toko Grab, beri hub dan menu | §2.4.1 sampai §2.4.3 |
| 10 | SPV | Hiryu | Ketik stok awal | §9 |
| 11 | Ops HQ + login manajer Grab milik outlet | Hiryu + Grab | Aktifkan toko di Grab, cek menu sudah sampai di Grab, buat pesanan uji | §2.4.4 sampai §2.4.6 |

**Hiryu dulu.** Setiap langkah yang menyentuh kedua sistem: kerjakan bagian Hiryu lebih dulu, lalu catat di WMS. Hiryu adalah penghubung dengan Grab: itulah yang dilihat pelanggan.

### 0.5 Target layanan dan skala

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

- **Lanjut atau tidak ke KJ5.** Angka apa yang harus dicapai MA5 sebelum KJ5 buka (tepat waktu, barang tidak ada, akurasi hitung dari §0.5), dan berapa lama? *Usulan:* dua minggu di MA5 sesuai target. *Yang memutuskan:* Ops HQ.
- **Tingkat layanan Grab** (Q13): batas siap 10 menit adalah bacaan kita atas Hiryu, bukan angka dari Grab.

# Bagian B. Proses

Lima belas proses. Masing-masing diawali siapa yang mengerjakan, di sistem mana, dan apa yang sudah ada di dev.

## 1. Login dan akses pengguna

**Siapa**: Ops HQ, SPV · **Sistem**: Hiryu dulu, lalu WMS · **Di dev**: login Google dan daftar pengguna. Peran versi 28 Sep (Ops Head, SPV hanya menambah staf): belum

### 1.1 Masuk ke Hiryu

<!--screen:hiryu-login-->

1. Pilih **Indonesia**. Malaysia punya daftar toko dan pengguna sendiri.
2. **Staf hub dan SPV** masuk dengan **email dan password** akun Hiryu milik dark store mereka (dibuat di §1.3.1). Mereka hanya melihat Live Orders, Orders, halaman pesanan, dan tab Stock toko mereka. Tidak ada yang lain.
3. **Staf kantor Ninja** (Ops HQ) memakai **Sign in with Google**, dengan akun Hiryu yang sudah dibuatkan oleh ADMIN Indonesia (§2.1.1).

**Siapa memegang peran Hiryu apa**

| Peran Hiryu | Diberikan kepada | Bisa |
|---|---|---|
| **ADMIN** | Lead Ops HQ (diberikan oleh pemilik proyek) | Semuanya, termasuk pengguna, pengaturan, dan *Activate on Grab* |
| **EDITOR** | Ops HQ | Toko, menu, SKU, stok, jam buka, staf hub |
| **VIEWER** | Siapa saja yang hanya perlu melihat | Hanya melihat |
| **MANAGER** (login hub) | SPV hub | Orders, Live Orders, mengetik stok, login staf di hub sendiri |
| **STAFF** (login hub) | Staf hub | Orders, Live Orders, halaman pesanan |

### 1.2 Pengguna dan peran

| Peran | Di mana | Tugas |
|---|---|---|
| **Staf** | Lantai dark store | Terima barang per AWB, simpan ke rak, tempel pesanan Grab, ambil, kemas, serahkan, hitung stok, laporkan masalah |
| **SPV** | Hub miliknya sendiri | Bin inbound sementara, rak dan bin, SKU ke bin, pertanyaan bin kedua, keputusan barang tidak ada, keputusan masalah, permintaan restock untuk hub-nya, konfirmasi selisih, pengesahan hitung stok, laporan akhir hari, **mendaftarkan staf** |
| **Ops HQ** | Semua hub | **Menambahkan merek**, SKU, foto, angka stok dan cadangan Grab, menu Hiryu dan pemetaan toko, menyetujui write-off, pengesahan selisih, menautkan kiriman tanpa AWB tercatat, **mendaftarkan dark store dan pengguna serta memberi peran** |
| **Ops Head** | Semua hub | Tanda tangan terakhir di setiap write-off (§11.5). Melihat semua yang dilihat Ops HQ |
| **Superadmin** | Semua | Semua yang dilakukan Ops HQ, memberi peran Ops Head dan superadmin, melihat aplikasi sebagai peran lain (hanya baca) |

**Siapa mendaftarkan siapa** *(diputuskan 25 Sep)*:

| | Daftarkan dark store | Tambah merek | Daftarkan pengguna | Peran yang bisa diberikan |
|---|---|---|---|---|
| **Superadmin** | Ya | Ya | Ya | Semua, termasuk Ops Head dan superadmin |
| **Ops Head** | Tidak | Tidak | Tidak | Tidak ada |
| **Ops HQ** | Ya | Ya | Ya | Staf, SPV, Ops HQ |
| **SPV** | Tidak | Tidak | Ya, di hub miliknya | Hanya staf |
| **Staf** | Tidak | Tidak | Tidak | Tidak ada |

Hiryu punya perannya sendiri (ADMIN, EDITOR, VIEWER untuk staf kantor; MANAGER dan STAFF untuk login hub). Siapa memegang peran apa ada di §1.1.

- **1.2.1** Server menegakkan setiap izin; console menyembunyikan layar yang tidak bisa dipakai suatu peran.
- **1.2.2** Peran *hub operator* untuk gudang pusat disembunyikan di versi pertama dan kembali bersama gudang pusat (§19).
- **1.2.3** **Dua tampilan.** *Station* untuk lantai gudang: huruf besar, satu keputusan per layar, area scan yang selalu aktif; bisa dipakai di laptop dengan scanner, tablet, atau ponsel (bisa diinstal, scan dengan kamera, atau ketik kodenya). *Console* untuk SPV dan Ops HQ: tabel, filter, antrean.

### 1.3 Akun untuk orang baru

1. **Tambah pengguna.** Isi email Google orang tersebut (@ninjavan.co), nama, peran, dan hub-nya. Ops HQ bisa memberi peran Staf, SPV, dan Ops HQ. Hanya superadmin yang bisa memberi peran Ops Head atau superadmin.
2. **SPV** hanya melihat *Tambah pengguna*, dan hanya bisa menambah **Staf** di hub mereka sendiri.

#### 1.3.1 Akun staf di kedua sistem

1. **Hiryu dulu: Dark stores → hub kamu → Staff → Add staff**, peran **STAFF** (pakai MANAGER hanya untuk wakil SPV). Berikan ke setiap orang password sementara yang ditampilkan Hiryu satu kali.
2. **Lalu WMS: Dark store & pengguna → Tambah pengguna**, peran Staf, hub kamu.

### 1.4 Admin, akses, pelatihan, dan keamanan

- **1.4.1** Login memakai Google SSO lewat proxy Substrait; aplikasi tidak menyimpan password. Superadmin dan Ops HQ melihat semua hub; yang lain melihat hub mereka sendiri. Tidak ada yang bisa mengubah perannya sendiri.
- **1.4.2** Saat go-live, akun staf otomatis dimatikan; akun dibuat seperti di 15.5.
- **1.4.5** **Pendaftaran** *(diputuskan 25 dan 28 Sep)*: superadmin dan Ops HQ mendaftarkan dark store, menambah merek, mendaftarkan pengguna, dan memberi peran (Ops HQ sampai tingkat Ops HQ; hanya superadmin yang bisa memberi peran Ops Head atau superadmin). SPV hanya mendaftarkan staf, di hub mereka sendiri, dan bisa menonaktifkannya. Tidak ada yang bisa mengubah perannya sendiri.
- **1.4.6** **Akses Hiryu** *(28 Sep)*: pemilik proyek memegang ADMIN Hiryu untuk Indonesia dan memberikannya (atau EDITOR, VIEWER) ke Ops HQ. Login hub (MANAGER untuk SPV, STAFF untuk staf) dibuat di Staff tab milik dark store di Hiryu, oleh ADMIN, EDITOR, atau MANAGER hub itu. Hiryu menampilkan password sementara satu kali; orang itu membuat password sendiri saat login pertama.
- **1.4.3** Situs pelatihan terpisah dengan banner, reset sekali ketuk, barcode uji, dan simulator pesanan Hiryu. Situs ini tidak pernah menyentuh stok asli.
- **1.4.4** **Keamanan**: tim keamanan Substrait meninjau aplikasi saat di-deploy dan menyebutkan apa yang harus diperbaiki. Ini menggantikan pertanyaan sebelumnya soal siapa yang meninjau temuan scan.

### 1.5 Hal terbuka

- **Staf hub tanpa akun Google perusahaan.** WMS memakai login Google (§1.3). Kalau staf hub adalah pekerja kontrak atau harian, mungkin mereka tidak punya. *Usulan:* cek dengan HR dan NV IT minggu ini; kalau tidak ada, minta Substrait cara login lain sebelum go-live. *Yang memutuskan:* Ops HQ bersama NV IT.
- **Ada yang berhenti.** Belum ada langkah untuk menutup login Hiryu dan akun WMS seseorang di hari terakhirnya, atau untuk lupa password Hiryu. *Usulan:* Hiryu dulu, lalu WMS, di hari yang sama, oleh SPV; Ops HQ mengecek kedua daftar pengguna sebulan sekali.
- **Laptop bersama.** Hiryu menyimpan satu login per browser, jadi orang berikutnya harus logout orang sebelumnya (§12.1). Tidak ada yang mengecek. *Usulan:* logout jadi langkah terakhir setiap shift (§13).
- **Siapa Ops Head** untuk pilot, dan siapa penggantinya saat berhalangan. Setiap penghapusan stok, selisih hitung dan selisih kiriman menunggu tanda tangannya.
- **Merek.** Merek tidak login ke kedua sistem dan menerima laporan (§15). Konfirmasi, atau tentukan apa yang boleh dilihat merek.

## 2. Pendaftaran dan pengaturan toko: hub, merek, SKU, toko Grab

**Siapa**: Ops HQ (ADMIN atau EDITOR di Hiryu) · **Sistem**: Hiryu dulu, lalu WMS, lalu Grab · **Di dev**: *Menu & toko Hiryu* (unggah menu, hubungkan barang, peta toko), 28 Sep. Form merek dan form SKU baru: belum

### 2.1 Ops HQ: daftarkan hub baru

#### 2.1.1 Di Hiryu: instance, dark store, login SPV

Butuh login **ADMIN** Hiryu.

1. **Satu kali untuk Indonesia:** *Settings*. Cek bahwa instance melayani **Indonesia**, mata uangnya **IDR**, dan hari kerja memakai waktu Jakarta (WIB). Mata uang hanya bisa diubah selama belum ada menu, jadi kerjakan ini dulu.
2. **Users → Invite user** untuk setiap orang Ops HQ yang butuh Hiryu: email kerja (akun Google perusahaan, tanpa password), nama, dan peran **EDITOR** (atau VIEWER jika hanya untuk melihat).
3. **Dark stores → New dark store.** Beri nama yang sama dengan di WMS (*Cawang*). Satu dark store untuk setiap hub fisik.
4. **Dark store tersebut → Hours.** Atur jam buka. Semua toko Grab yang dilayani dari hub ini mengikuti jam ini.
5. **Dark store tersebut → Staff → Add staff** untuk SPV: email, nama, peran **MANAGER**. Hiryu menampilkan **password sementara satu kali**: langsung berikan ke SPV. SPV memilih password sendiri saat pertama kali masuk.

<!--screen:hiryu-darkstore-->

#### 2.1.2 Di WMS: dark store

<!--screen:admin-setup-->

1. **Dark store & pengguna → Tambah dark store.** Hanya Superadmin atau Ops HQ. Isi kode hub (MA5), nama, alamat, nama dark store di Hiryu, dan SPV hub.
2. WMS membuat **baki karantina** (`MA5-KARANTINA`) sendiri. Setiap hub punya satu, dan baki ini tidak bisa dimatikan. SPV yang menyiapkan bin sementara barang masuk (§3.1).

### 2.2 Ops HQ: tambahkan merek dan produknya

Hiryu dulu, lalu WMS, supaya WMS bisa diisi kode Hiryu untuk setiap SKU.

#### 2.2.1 Di Hiryu: buat SKU

<!--screen:hiryu-skus-->

1. **SKUs → New SKU.**
2. **Code**: pakai kode SKU merek jika ada. Jika tidak ada, buat kode sendiri yang jelas (`LAB-GB-MC-100`). Hiryu mengubahnya jadi huruf besar. Kode inilah yang di WMS disebut **Kode SKU di Hiryu**.
3. **Name**: merek, produk, dan ukuran (*Labore GentleBiome Mild Cleanser 100 ml*). **Create.**

SKU adalah **barang yang ada di rak**. Item menu adalah **apa yang dibeli pelanggan**. Satu SKU bisa dijual satuan dan juga sebagai paket isi 2.

#### 2.2.2 Di Hiryu: buat menu

<!--screen:hiryu-menu-->

1. **Menus → New menu** (*Labore*), satu menu per merek, dipakai bersama oleh toko merek itu di semua hub. Lalu **Add category** (*Cleanser*, *Moisturiser*).
2. **Add item** di setiap kategori: Item ID (unik di dalam menu; untuk produk satuan pakai kode SKU), nama dengan ukuran, harga dalam IDR, urutan, deskripsi (dilihat pembeli), dan paling banyak **4 foto**, persegi (1:1). **Add to draft.**
3. **Save menu.** Tidak ada yang sampai ke Grab sebelum kamu menyimpan. Saat disimpan, menu dikirim ke setiap toko yang memakainya.

Untuk banyak item sekaligus: **Export CSV**, isi filenya, lalu **Import CSV**. Import **mengganti seluruh menu** untuk setiap toko yang memakainya, jadi ekspor dulu untuk menyimpan salinan.

#### 2.2.3 Di Hiryu: hubungkan setiap item ke SKU-nya

<!--screen:hiryu-bundles-->

1. Di menu, buka **Bundles**.
2. Untuk setiap item, pilih **SKU**-nya.
3. Atur **Units per sale**: 1 untuk produk satuan, 2 untuk paket isi 2 dari produk yang sama.

**One SKU per item** mengerjakannya untuk seluruh menu berisi produk satuan dalam satu klik (setiap item mendapat SKU dengan kode item itu). Item yang dibiarkan *Not counted* tetap bisa dijual walaupun raknya kosong, jadi setiap produk kemasan harus dihubungkan. Filter *Not counted only* di **SKUs** menunjukkan item yang terlewat.

#### 2.2.4 Tambahkan merek di WMS

<!--screen:brand-form-->

1. **Merek → Tambah merek.** Ops HQ atau superadmin. Nama, kode singkat, dan perusahaan pemilik merek.
2. **Model listing di Grab**: *Grab minta Ninja jadi 3PL* (Grab yang membawa mereknya, seperti Kahf dan Labore) atau *Ninja daftar merchant sendiri* (Ninja sendiri yang mendaftarkan merek itu di Grab). Stok selalu milik merek.
3. **Kontak restock**: siapa di pihak merek yang menerima permintaan restock.
4. **Dijual di hub**: hub mana saja yang menjual merek ini.

#### 2.2.5 Di WMS: daftarkan setiap SKU dengan kode Hiryu-nya

<!--screen:sku-form-->

1. **Produk → Daftarkan SKU.** Ketik **Kode SKU di Hiryu** lebih dulu. Setelah menu di-upload (§2.2.6), WMS menampilkan nama SKU Hiryu yang cocok, jadi kamu bisa memastikan SKU-nya benar.
2. Merek, kode SKU milik merek, nama, **barcode** (scan kemasannya; satu SKU bisa punya lebih dari satu; biarkan kosong jika merek belum punya), serta ukuran kemasan dan berat jika diketahui.
3. **Ukuran bin**: WMS menyarankan kecil (JX-2) atau besar (JX-4), yaitu bin terkecil yang muat 15 unit dengan satu sekat.
4. **Angka-angka stok.** Masing-masing punya nama sederhana dan contoh di layar. Angka yang bertanda *unit atau %* bisa diisi jumlah unit atau persentase:

| Di layar | Artinya | Diisi dengan | Contoh |
|---|---|---|---|
| **Isi sampai** | Restock mengisi stok hub sampai angka ini | Unit | 15 |
| **Pesan ulang saat sisa** | Jika stok hub turun sampai angka ini, WMS membuat draf permintaan restock ke merek | Unit atau % dari *isi sampai* | 25% = 4 unit |
| **Batas kritis** | Pada angka ini atau di bawahnya, SKU ditandai merah: hampir habis | Unit atau % dari *isi sampai* | 1 unit |
| **Cadangan Grab** | Unit yang ditahan dari jumlah yang boleh dijual Grab, untuk jaga-jaga jika ada salah hitung (§9.5) | Unit atau % dari stok yang tersedia (dibulatkan ke atas) | 1 unit (bawaan) |
| **Isi maks. per bin** | Berapa unit yang muat di satu bin sebelum bin berikutnya dipakai. Boleh kosong: WMS mempelajarinya dari SPV (§4.2) | Unit | 12 |

*Isi sampai* wajib diisi. *Pesan ulang saat sisa* otomatis terisi 25% kecuali kamu mengubahnya.

#### 2.2.6 Di WMS: upload menu Hiryu

<!--screen:hiryu-map-->

1. Di Hiryu, buka **Menus → menu tersebut → Export CSV**. Di WMS, buka **Menu Hiryu → Unggah CSV menu**, satu file per merek. Ulangi setiap kali menu di Hiryu berubah.
2. Item yang barcode-nya cocok akan terhubung sendiri dengan 1 unit per penjualan. Sisanya menunggu di **Perlu dihubungkan**: pilih SKU WMS dan jumlah unit per penjualan, sama seperti di Bundles Hiryu.
3. **Toko Hiryu**: isi setiap nomor toko Hiryu satu kali, beserta hub dan mereknya (setelah §2.4.1).

Pesanan Grab yang berisi item belum terhubung tidak bisa di-paste, jadi pastikan *Perlu dihubungkan* selalu kosong.

### 2.3 Nanti: produk baru, perubahan harga, produk dihentikan

| Perubahan | Di Hiryu | Di WMS |
|---|---|---|
| **Produk baru** | New SKU (§2.2.1), tambahkan item ke menu lalu Save menu (§2.2.2), hubungkan di Bundles (§2.2.3) | Daftarkan SKU (§2.2.5), upload menu lagi (§2.2.6), SPV memberinya bin (§3.3) |
| **Perubahan harga** | Ubah harga item, Save menu, cek statusnya *Synced* (§2.4.5) | Tidak ada |
| **Berhenti menjual produk** | Ubah item ke UNAVAILABLE atau SOLD OUT, Save menu | Hentikan restock: ubah *Isi sampai* ke 0 |
| **Kemasan berubah** (misalnya produk satuan menjadi paket isi 2) | Ubah *Units per sale* item itu di Bundles | Upload menu lagi di hari yang sama dan atur jumlah unit yang sama di *Perlu dihubungkan* |

Hubungan dari item menu ke SKU-nya (dan berapa unit yang dipakai satu penjualan) disimpan di **dua tempat**: *Bundles* di Hiryu dan daftar item di WMS. Hiryu memakai datanya untuk mengurangi stoknya. WMS memakai datanya untuk tahu barang apa yang harus diambil. Jika satu diubah dan yang lain tidak, kedua hitungan akan makin berbeda. Jadi buat setiap perubahan **di Hiryu dulu, lalu di WMS, pada hari yang sama**. Sebulan sekali, Ops HQ membandingkan daftar item WMS (*Menu Hiryu → Unduh daftar item*) dengan halaman Bundles di Hiryu.

**Tips:** File menu Hiryu punya kolom **barcode**. Isi barcode setiap item di Hiryu (lewat CSV), supaya WMS bisa menghubungkan item satuan ke SKU-nya sendiri.

### 2.4 Ops HQ: hubungkan setiap toko Grab ke Hiryu

Satu toko Grab per merek per hub: pilot ini punya empat toko (Kahf dan Labore di MA5 dan KJ5). **Sebelum mulai** kamu butuh: toko Grab yang sudah dibuat oleh Grab dengan alamat hub; **login manajer Grab milik outlet** (dari Grab atau dari merek); menu merek dengan SKU yang sudah terhubung (§2.2); stok di rak dan di WMS (§5).

#### 2.4.1 Buat toko

**Stores → New store.** Beri nama persis seperti yang akan dibaca pelanggan, yaitu merek dan hub: *Labore - Cawang*. Toko mulai dengan status INACTIVE, tanpa koneksi ke Grab.

#### 2.4.2 Beri hub

**Dark stores → hub tersebut → Stores → centang tokonya → Assign.** Kerjakan ini **sebelum** aktivasi: pesanan untuk toko tanpa hub tidak akan muncul di papan Live Orders mana pun.

#### 2.4.3 Beri menu dan stok awal

1. **Toko tersebut → Overview → Menu**: pilih menu merek.
2. **Toko tersebut → Stock**: SPV mengetik stok awal dari WMS (§9.3).

#### 2.4.4 Aktifkan di Grab

<!--screen:hiryu-store-activate-->

1. Di **Overview** toko, cek menu sudah dipilih. *Start activation* tetap abu-abu sampai menu punya paling sedikit satu item yang tersimpan, karena Grab menolak menu kosong.
2. Tekan **Start activation** (hanya ADMIN). Hiryu memberi kamu sebuah link.
3. **Open link.** Halaman milik Grab akan terbuka:

<!--screen:grab-activate-->

4. **Masuk dengan login manajer Grab milik outlet** (misalnya `labore.cawang.manager`).
5. **Pilih toko** yang akan dihubungkan (cek alamatnya sama dengan alamat hub), lalu hubungkan.
6. **Aktifkan integrasi.** Grab memberi peringatan bahwa menu POS menjadi menu utama dan perubahan yang dibuat di aplikasi GrabMerchant akan dibatalkan. Itu memang seharusnya: mulai sekarang menu, harga, dan stok datang dari Hiryu.
7. Kembali ke Hiryu, muat ulang halaman toko. Statusnya **ACTIVE** dan **Grab merchant ID** sudah terisi.

#### 2.4.5 Cek menu sudah sampai di Grab

**Menus → menu tersebut → Stores using this menu**: setiap toko harus menunjukkan **Synced**. *Syncing…* berarti tunggu. *Not sent* menunjukkan alasan dari Grab: perbaiki lalu tekan *Retry*. Jika muncul pesan bahwa sinkronisasi terlalu sering, tunggu sesuai jumlah menit yang disebutkan sebelum mencoba lagi.

#### 2.4.6 Pesanan uji, lalu buka

Buat satu pesanan uji di Grab untuk toko ini, jalankan dari awal sampai akhir sesuai §6 (paste, ambil, kemas, *Mark ready*, serah terima), lalu batalkan atau selesaikan sesuai kesepakatan dengan Grab.

### 2.5 Lokasi

- **2.5.1** Versi pertama **hanya untuk dark store**. Tipe lokasi gudang pusat, transfer, dan pengiriman tote tetap ada di kode tapi disembunyikan (§19).
- **2.5.2** **Bin inbound sementara dan baki karantina** *(direvisi 28 Sep)*. **Baki karantina** (`HUB-KARANTINA`) dibuat otomatis saat Ops HQ mendaftarkan dark store dan tidak bisa dimatikan: baki ini satu-satunya tempat untuk unit yang tidak boleh dijual (rusak, bocor, kedaluwarsa, meragukan), jadi unit itu tidak pernah berada di bin yang bisa dijangkau picker. **SPV** mengatur **bin inbound sementara** (§3.1): berapa banyak dan ukurannya. WMS memberi setiap bin lokasi dan labelnya sendiri, mulai dari `HUB-IN-01`, satu SKU per bin, dipakai saat kiriman dihitung; WMS menentukan bin mana yang dipakai untuk tiap SKU. Keduanya tidak pernah menyimpan stok yang bisa dijual. Jumlah bin sementara bisa diubah kapan saja; kiriman dengan SKU lebih banyak dari jumlah bin sementara diterima bertahap (§5.3.2).

### 2.6 Mendaftarkan SKU **[diperbarui 25 Sep]**

Ops HQ mendaftarkan setiap SKU **sekali untuk semua hub** (§2.2.5), **setelah SKU itu ada di Hiryu** *(diputuskan 28 Sep)*: SKU dibuat dulu di Hiryu (§2.2.1 sampai §2.2.3), jadi kode Hiryu-nya sudah diketahui dan diketik paling awal di WMS. Setelah menu Hiryu diunggah (§2.12), WMS menampilkan nama SKU Hiryu yang cocok dengan kode itu, sebagai pengecekan.

| Kolom | Wajib | Catatan |
|---|---|---|
| Merek, kode SKU merek, nama, ukuran, kategori | Ya | Kode milik merek sendiri |
| **Kode SKU di Hiryu** | Ya | Kode SKU yang sesuai di Hiryu (Hiryu *SKUs*). Otomatis terisi dengan kode merek; ubah hanya jika Hiryu memakai kode lain. Lembar stok mengurutkan baris berdasarkan kode ini agar sejajar dengan tab Stock di Hiryu *(diputuskan 25 Sep)* |
| Item menu Hiryu | Ditampilkan, tidak diketik | Dari unggahan menu (§2.12): setiap ID item yang menjual SKU ini, dan jumlah unit per penjualan |
| **Barcode** | Jika kemasan punya | Satu barcode hanya untuk satu SKU, selamanya. Satu SKU boleh punya beberapa |
| Kemasan L × W × H mm, berat g | Opsional | Menentukan ukuran bin dan kemasan pengiriman. Lampiran B |
| Cairan dalam botol; botol besar (150 ml atau lebih) | Opsional | Menentukan aturan karton (§6.10) |
| **Ukuran bin** | Ya | Disarankan dari ukuran kemasan; jika tidak ada, dari kategori |
| **Isi maks. per bin** | Opsional | Hanya jika diketahui dari SKU serupa dengan ukuran bin yang sama (§4.6) |
| *Isi sampai* | Ya | Unit (§4.5) |
| *Pesan ulang saat sisa*, *Batas kritis* | *Pesan ulang* otomatis terisi | Unit atau persentase dari *Isi sampai* (§4.5) |
| *Cadangan Grab* (buffer Grab) | Opsional | Unit atau persentase dari stok yang tersedia. Default 0 (§9.5) |
| Foto | Opsional | 1:1, minimal 800 × 800, latar putih |

- **2.6.1** **Impor massal**: lembar master SKU (Lampiran B) diimpor sebagai CSV dengan kolom yang sama, dengan pratinjau sebelum ada yang disimpan.
- **2.6.2** SKU yang didaftarkan di HQ muncul di daftar *Perlu rak* setiap hub **beserta ukuran bin-nya**. SPV memilih bin kosong dengan ukuran itu; WMS menyarankan ketinggian paling nyaman lebih dulu (level 3, lalu 2, 4, 1, 5).
- **2.6.3** SKU yang belum punya bin di suatu hub bisa diterima di sana (staf diberi bin saat inbound), tapi belum bisa diambil untuk pesanan.

### 2.7 Merek **[DIPUTUSKAN 28 Sep]**

Merek baru ditambahkan oleh **Ops HQ atau superadmin** (§2.2.4), sebelum SKU-nya didaftarkan: nama, kode singkat, perusahaan, model listing (§2.11), kontak restock merek, hub mana saja yang menjualnya, dan apakah kemasannya punya barcode. SPV tidak bisa menambahkan merek.

### 2.8 Barcode

- **2.8.1** Barcode bisa dimasukkan saat pendaftaran, atau diikat saat unit pertama kali tiba: staf mencari di daftar produk, memilih produk yang sedang dipegang, dan barcode terikat permanen.
- **2.8.2** Produk tak dikenal saat inbound dikirim ke Ops HQ dengan foto dan jumlahnya (§5); produk itu belum menjadi stok sampai HQ menjawab.
- **2.8.3** Label unit milik Ninja (untuk merek tanpa barcode) tetap ada tapi disembunyikan. Kahf dan Labore sudah punya barcode.

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
| Item Hiryu | ID item Hiryu → SKU dan unit per penjualan | Unggah CSV menu Hiryu (kolom yang dipakai: `item_id`, `item_name`, `barcode`, `available_status`); barcode yang cocok dipetakan ke 1 unit; sisanya manual |
| Toko Hiryu | Nomor toko → hub dan merek | Diketik sekali per toko |
| Kode SKU Hiryu | Di setiap SKU WMS (§2.6) | Diketik Ops HQ dari *SKUs* di Hiryu; terisi dengan kode merek. Dicocokkan tanpa melihat huruf besar atau kecil, karena Hiryu mengubah kode menjadi huruf besar |
| Harga item Hiryu | ID item → harga, dengan tanggal setiap unggahan | Kolom `price` dari CSV menu yang sama; hanya dipakai untuk nilai sell-out (§15.1) |

### 2.13 Hal terbuka

- **Listing Grab yang sudah ada.** Listing Official Store Kahf dan Labore pindah ke toko hub (§17, putaran keempat). Belum ditulis: siapa yang memindahkan dan kapan, bagaimana rating dan ulasan, dan apakah listing lama ditutup. *Yang memutuskan:* Grab bersama merek.
- **Isi menu.** Siapa yang menyediakan nama, deskripsi, 4 foto persegi dan harga tiap barang, dan siapa yang menyetujui perubahan harga dari merek. *Usulan:* merek menyediakan; Ops HQ memasukkannya ke Hiryu dalam 2 hari kerja.
- **Bundel.** 41 bundel marketplace disisihkan saat cek ulang. Apakah ada yang dijual di Grab sebagai paket isi 2 (unit per jual 2)? Putuskan per merek sebelum menu dibuat.
- **Jam buka dan hari libur.** Jam dark store di Hiryu berlaku untuk semua toko yang dilayaninya (§2.1.1). Jam buka pilot, dan siapa yang mengubahnya saat libur nasional, belum ditetapkan.
- **Menutup.** Belum ada langkah untuk menutup toko Grab, menghapus barang menu untuk seterusnya, atau menutup hub.
- **Cek hubungan barang bulanan** (§2.3): unduhan WMS *Unduh daftar item* belum dibuat.

## 3. Pengaturan rak

**Siapa**: SPV, Ops HQ · **Sistem**: WMS · **Di dev**: rak dan bin dengan satu bay. Gambar rak, bay dan bin inbound sementara: belum

### 3.1 Bin sementara barang masuk dan baki karantina

<!--screen:inbound-area-->

1. **Rak & bin → Area barang masuk.** Isi berapa banyak **bin sementara barang masuk** yang dimiliki hub dan ukurannya. Setiap bin mendapat label sendiri: 10 bin menjadi `MA5-IN-01` sampai `MA5-IN-10`. Kiriman dihitung ke bin ini, satu SKU per bin, sebelum masuk ke rak. Jumlahnya bisa diubah nanti. Kiriman yang jumlah SKU-nya lebih banyak dari bin sementara cukup diterima bertahap per batch (§5).
2. **Baki karantina** sudah ada. Baki ini berupa satu kotak atau krat berlabel untuk unit yang tidak boleh dijual: rusak, bocor, kedaluwarsa, atau meragukan. Baki ini menjauhkan unit tersebut dari jalur picker sampai kamu memutuskan apa yang dilakukan dengannya (§11.2). Taruh baki jauh dari rak picking.
3. **Cetak labelnya** (lembar stiker A4) lalu tempel di bin sementara dan di baki. Taruh bin sementara di rak atau palet di sebelah meja penerimaan.

### 3.2 Buat rak

<!--screen:rack-builder-->

Pembuat rak adalah **gambar rak dari depan, sesuai skala**. Gambar di atas bisa dipakai: silakan coba.

1. **Pilih jenis rak**: rak katalog 1 m atau rak long-span 206 cm dari inventaris.
2. **Pilih berapa bay** (bagian di antara tiang) **dan berapa level.**
3. **Klik satu level**, lalu pilih bin-nya: **kecil**, **besar**, atau **kosong**. Satu ukuran bin per level. Gambar langsung diperbarui dan menunjukkan berapa bin berjajar ke samping, berapa yang bertumpuk, dan alasannya.
4. **Arahkan kursor ke bin mana saja** untuk membaca kodenya. `MA5-A1-3-05T` artinya rak A, bay 1, level 3, posisi 5, bin atas. Bin yang bertumpuk diberi kode B (bawah), M (tengah), dan T (atas).
5. **Simpan**, lalu cetak label bin.

### 3.3 Beri setiap SKU satu bin

Setelah Ops HQ mendaftarkan SKU (§2.2.5), SKU itu muncul di **Rak & bin → Perlu rak** lengkap dengan ukuran bin-nya. Pilih bin kosong dengan ukuran itu. WMS menyarankan ketinggian yang paling nyaman lebih dulu.

### 3.4 Tata letak bisa diatur **[DIPUTUSKAN 25 Sep]**

Tata letak hub adalah **rak → bay → level → posisi → tumpukan**.

| Bagian | Diatur oleh | Aturan |
|---|---|---|
| **Rak** | Ops HQ atau SPV | Satu huruf per hub, dan tipe rak (ukuran luar, jumlah level, lebar bersih per bay) |
| **Bay** | Tipe rak, bisa diubah | Bagian di antara tiang. Rak katalog 1 m punya 1; rak long-span 206 cm bisa diatur 1 atau 2 |
| **Level** | Per bay | Tinggi bersih, dan **satu ukuran bin** per level |
| **Posisi** | Dihitung sistem | ⌊lebar bersih bay ÷ lebar bin⌋, boleh dikurangi |
| **Tumpukan** | Dihitung sistem | min(⌊tinggi bersih level ÷ tinggi bin⌋, batas tumpuk tipe bin), boleh dikurangi |

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
- **3.4.7** **Pembuat rak berupa gambar lebih dulu** *(diputuskan 25 Sep)*: tampak depan sesuai skala, level dipilih dengan mengkliknya, ukuran bin dipilih dengan satu ketukan, dan angka ditampilkan beserta alasannya dalam kata-kata sederhana (§3.2). Tabel dengan angka yang sama tersedia untuk Ops HQ, di bawah gambar.

### 3.5 Peta hub (Ops HQ)

Semua hub dalam satu tabel: bin terpakai dan kosong, SKU tanpa bin, unit yang disimpan, SKU yang menipis, habis, atau belum punya angka pesan ulang, kiriman dalam perjalanan, selisih yang masih terbuka, masalah yang masih terbuka. Klik satu hub untuk membuka peta tata letaknya, satu kotak per bin, diwarnai berdasarkan stok atau ketersediaan.

### 3.6 Hal terbuka

- **Rak yang sebenarnya.** Rak mana, berapa bay dan level, dan denah MA5 serta KJ5 belum ditulis. SPV butuh ini sebelum membuat rak di WMS.
- **Mencetak label.** Label bin dan label bin sementara dicetak di lembar stiker A4 (§3.1), tapi tidak ada printer lembar di daftar perangkat (§12.1). *Usulan:* cetak di kantor lalu dibawa ke hub.
- **Letak tiap SKU.** WMS menyarankan ketinggian, tapi belum ada aturan pengelompokan. *Usulan:* satu merek berdekatan, barang laris di level 2 sampai 4 paling dekat meja kemas.
- **Memindahkan SKU ke bin lain** (bin rusak, tempat lebih baik): saat ini hanya jawaban bin kedua *Pindah bin*. Langkahnya belum ditulis.

## 4. Restock dan batas stok

**Siapa**: SPV, Ops HQ · **Sistem**: WMS, plus WhatsApp atau email ke merek · **Di dev**: permintaan restock, persetujuan selisih, pengingat. Kolom *Catat pengiriman*, unit atau %, isi maks. per bin yang dipelajari: belum

### 4.1 Restock dari merek, dan mencatat AWB

1. **Pengingat** menampilkan **draf restock** saat stok SKU turun ke angka *pesan ulang saat sisa*. WMS mengumpulkan setiap SKU yang perlu restock ke dalam satu draf per merek untuk hub kamu.
2. Buka **Restock ke merek → drafnya.** Periksa jumlahnya (terisi sampai angka *isi sampai*), ubah yang perlu, dan tambahkan SKU secara manual jika perlu.
3. Tekan **Salin teks** lalu kirim ke kontak restock merek lewat WhatsApp atau email, lalu tekan **Tandai terkirim**. Jumlahnya dikunci.
4. Saat merek membalas dengan info pengiriman, buka permintaannya lalu tekan **Catat pengiriman**:

<!--screen:restock-awb-->

5. Isi **nomor AWB**, **nomor Surat Jalan**, perkiraan tanggal tiba, dan **jumlah setiap SKU yang benar-benar dikirim merek** (bisa lebih sedikit dari yang kamu minta).
6. Tekan **Simpan pengiriman.** Sekarang staf bisa menerima kiriman itu dengan AWB tersebut (§5.1). Kamu bisa memperbaiki data ini sampai barangnya datang.

Jika barang datang sebelum kamu mencatat AWB, staf menjalankan §5.2 dan kamu atau Ops HQ menghubungkan AWB-nya di sana.

### 4.2 Pertanyaan bin kedua

<!--screen:second-bin-->

Setiap kali satu SKU mendapat bin kedua di hub, baik karena staf menekan *Bin penuh* atau karena kamu menambahkannya di *Rak & bin*, WMS menanyakan alasannya.

1. Pilih alasannya. **Bin pertama penuh** adalah alasan yang penting.
2. Jika penuh: WMS mengusulkan jumlah yang sekarang ada di bin pertama sebagai **isi maks. per bin** untuk SKU itu di ukuran bin itu. Angka ini berlaku untuk hub ini, dan untuk semua hub lain yang belum punya angka. Ops HQ bisa mengubahnya.
3. Alasan lain (kiriman promo, bin dipindah, batalkan) tidak mengubah apa pun.

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

Layar memakai nama bahasa Indonesia yang sederhana, dengan contoh satu baris di bawah setiap kolom (§2.2.5). Huruf R, P dan S hanya dipakai di kode dan database.

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

Merek mengirim langsung ke hub dengan Surat Jalan.

1. **Barang masuk → scan atau ketik AWB** yang ada di Surat Jalan. WMS menampilkan barang yang menurut merek sudah dikirim.
2. Scan setiap unit. WMS menunjuk satu **bin sementara barang masuk** untuk setiap SKU (`MA5-IN-01`, `MA5-IN-02`, dan seterusnya) dan menampilkan *cocok*, *kurang N*, atau *lebih N* per SKU selama kamu scan.
3. **Tanggal kedaluwarsa (ED).** Saat kamu scan unit pertama dari setiap SKU, WMS meminta **ED yang tercetak di kemasan**: bulan dan tahun. Jika Surat Jalan dari merek sudah mencantumkannya, WMS menampilkannya: cukup periksa. Jika tidak ada tanggal di kemasan, atau tanggalnya tidak terbaca: pilih *Tidak ada ED*. Jika satu SKU punya dua tanggal dalam kiriman yang sama: tambahkan tanggal kedua, lalu scan unit-unit itu di bawah tanggal tersebut. Tulis ED di sekat putih seperti biasa.
4. Jika bin sementara sudah penuh, selesaikan batch ini dan simpan ke rak dulu sebelum menghitung sisanya (*Selesai batch ini*).
5. **Simpan ke rak**: bawa setiap SKU dari bin sementaranya ke bin rak yang tampil di layar.

<!--screen:putaway-full-->

6. **Jika bin rak penuh, tekan Bin penuh.** WMS memberimu bin kosong dengan ukuran sama, sedekat mungkin. Taruh sisanya di sana.
7. Setelah itu SPV akan ditanya apakah bin pertama benar-benar penuh (§4.2). Kamu tidak perlu menunggu jawabannya.
8. **Selesai.** Tekan *Semua barang AWB sudah diterima* jika semua barang sudah masuk. Selisih diteruskan ke SPV.

Barcode tidak dikenal: cari nama produk di daftar produk lalu pilih yang sama dengan barang di tanganmu. Jika tidak ada di daftar: foto barangnya, hitung, kirim ke Ops HQ, dan biarkan di bin sementaranya.

### 5.2 Jika AWB tidak ada di WMS

<!--screen:inbound-noawb-->

1. WMS menampilkan *AWB ini belum dicatat Ops HQ*. Jangan suruh driver pergi.
2. Foto Surat Jalan, pilih mereknya, isi jumlah karton, lalu tekan **Kirim ke Ops HQ, lalu hitung**. Ops HQ langsung mendapat tanda.
3. **Hitung selagi driver masih ada**: scan setiap unit ke bin sementara yang ditunjuk WMS. Tanda tangani Surat Jalan untuk jumlah karton yang diterima. Unit yang sudah dihitung **belum menjadi stok**.
4. Setelah Ops HQ menghubungkan AWB-nya, tombol **Taruh di rak** muncul dan kamu simpan ke rak seperti di §5.1. Jika Ops HQ menolak kiriman itu, barang tetap di bin sementara sampai dikembalikan ke merek.

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

### 5.5 Tanggal kedaluwarsa saat penerimaan **[DIPUTUSKAN 28 Sep]**

- **5.5.1** **Asal tanggalnya.** Merek diminta mencantumkan ED (tanggal kedaluwarsa) setiap SKU di Surat Jalan; SPV atau Ops HQ mengetiknya di *Catat pengiriman* (§4.1). Jika tidak ada, staf membacanya dari kemasan saat men-scan unit pertama setiap SKU ketika menerima barang (§5.1). Bulan dan tahun sudah cukup; *Tidak ada ED* boleh dipilih.
- **5.5.2** **Disimpan per batch**: satu batch adalah satu SKU dalam satu kiriman dengan satu ED. Kiriman dengan dua ED untuk satu SKU dihitung dua batch. Saldo menyimpan batch-nya, jadi WMS tahu bin mana berisi tanggal yang mana.
- **5.5.3** **Dipakai untuk**: mengarahkan picker ke ED paling awal lebih dulu; menampilkan ED di layar putaway, pick, dan hitung stok; dan tanda **ED dekat** beberapa hari sebelum kedaluwarsa (default 90 hari, bisa diatur sampai syarat konsinyasi menentukan lain), agar SPV bisa meminta merek menariknya kembali.
- **5.5.4** ED tetap ditulis di sekat putih di dalam bin.

### 5.6 Hal terbuka

- **Jam terima barang.** Kapan merek boleh mengirim, dan siapa yang menerima saat SPV libur.
- **Sisa umur minimal saat diterima.** Belum ada aturan menolak barang yang segera kedaluwarsa (misalnya sisa kurang dari 6 bulan). Terkait tanda *ED dekat* (90 hari, §5.5.3), Q5 dan Q15.
- **Kerusakan saat diterima.** Aturan klaim 24 jam sudah ada (§5.3.7), tapi langkah staf belum: foto, hitung sebagai kurang, dan unitnya ditaruh di mana.
- **Kiriman pertama yang besar** diterima sebagai risiko yang disadari (§17). Perkiraan waktu per 100 unit akan membantu merencanakan staf di hari pertama.

## 6. Ambil dan kemas

**Siapa**: packer di laptop, picker dengan HP · **Sistem**: Hiryu dulu, lalu WMS · **Di dev**: *Tempel pesanan Grab* (layar 20), ambil terpandu, batas siap 10 menit, 28 Sep. Aturan kemasan dan jalur terjadwal: belum

### 6.1 Salin pesanan dari Hiryu

Sekitar 20 detik untuk menyalin, lalu ambil barang. Hiryu menganggap pesanan **terlambat setelah 10 menit**, jadi targetnya *Mark ready* dalam **10 menit** sejak pesanan masuk.

<!--screen:hiryu-copy-->

1. Hiryu membunyikan suara pesanan baru dan mencetak slip kemas. Buka pesanannya. Jika muncul tombol **Accept** (toko memakai penerimaan manual), tekan **Accept** dulu. **Biarkan Raw payload tertutup**: tombolnya harus bertuliskan *Show*.
2. Klik satu kali pada judul **Order GM-…**. Judul ini hanya teks biasa, jadi mengkliknya tidak mengubah apa pun di Hiryu. Jangan klik di dekat tombol.
3. Tekan **Ctrl + A**, lalu **Ctrl + C**.

### 6.2 Tempel ke WMS

<!--screen:paste-->

1. Di WMS buka **Tempel pesanan Grab**, klik kotak abu-abu, lalu tekan **Ctrl + V**.
2. Pastikan nomor GM sama dengan slip dan centang hijau muncul. Centang itu berarti jumlah baris dan unit sama dengan hitungan Hiryu.
3. Tekan **Mulai ambil**.

| Kata WMS | Lakukan ini |
|---|---|
| *Salinan tidak lengkap* | Kembali ke Hiryu, klik judulnya, Ctrl + A, Ctrl + C lagi |
| *Tutup "Raw payload" dulu* | Di Hiryu tekan *Hide* pada Raw payload, lalu salin lagi |
| *Barang belum dihubungkan* | Beri tahu SPV. Ops HQ menghubungkan itemnya (§2.2.6), lalu paste lagi |
| *Pesanan sudah ada* | Pesanan ini sudah pernah di-paste. WMS membuka daftar ambilnya |
| *Toko ini milik hub lain* | Salah hub. Beri tahu SPV |
| *Tekan Accept di Hiryu dulu* | Toko memakai penerimaan manual dan pesanan ini belum diterima. Tekan **Accept** di Hiryu, lalu salin lagi |
| *Pesanan terjadwal* | Pesanan ini terjadwal dan masuk antrean sesuai waktunya. Ambil barangnya saat WMS memindahkannya ke paling atas |

### 6.3 Ambil barang

<!--screen:pick-->

1. Pergi ke bin yang tampil di layar. Rak dan level-nya ditandai.
2. Ambil sejumlah angka yang tampil, dari **sekat paling lama** dulu.
3. **Scan setiap unit.** Produk yang salah menghentikan pengambilan. Kembalikan barang itu dan ambil yang benar. Jika produk yang salah itu memang ada di bin ini, tekan *Barang ini salah tempat*.
4. Barang tidak ada, atau kurang: tekan **Barang tidak ada** (§8.1).

### 6.4 Kemas

<!--screen:pack-->

1. Setelah semua unit di-scan, ambil kemasan yang disebut WMS: **tas kertas** atau **karton**. Jika benar-benar tidak muat, tekan *Ganti kemasan* dan pilih alasannya.
2. Kemas. Masukkan slip Hiryu ke dalam kemasan atau tempel di luar, dengan nomor GM terlihat.
3. **Hiryu dulu**: tekan **Mark ready** untuk nomor GM yang sama. Hiryu memberi tahu Grab bahwa kemasan siap dan mengurangi unit itu dari hitungan stoknya sendiri. (Nanti Hiryu akan menambahkan foto tas yang sudah dikemas. Jika fitur itu sudah ada, ambil fotonya di Hiryu, sebelum *Mark ready*. WMS tidak menyimpan foto.)
4. **Lalu WMS**: tekan **Sudah Mark ready di Hiryu**. Slip ini desain Grab dan tidak punya kode untuk di-scan, jadi ketukan ini adalah catatan WMS bahwa pesanan sudah dikemas. Taruh tasnya di rak siap ambil.

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

*Diperbarui 25 September.*

**Hanya dua kemasan: tas kertas dan karton.** Tidak ada ziplock, tidak ada bubble wrap dalam logika ini.

| Kemasan | Ukuran dalam | Volume terpakai | Beban maks. (asumsi) |
|---|---|---|---|
| Tas kertas, kraft 70 gsm bertali (Berkah PBG15) | 18 × 10 × 33 cm | 18 × 10 × 27 cm × 80% = **3,9 L** | **3,0 kg** |
| Karton, dinding tunggal (Maxellpack CCM-36) | 25 × 20 × 10 cm | 25 × 20 × 10 cm × 80% = **4,0 L** | **5,0 kg** |

#### 6.10.1 Aturannya

Untuk setiap pesanan, WMS menjumlahkan:

- **V** = jumlah dari unit × volume kemasan;
- **G** = jumlah dari unit × berat;
- **L** = kemasan terpanjang dalam pesanan;
- **N** = jumlah botol besar (150 ml atau lebih).

1. **Tas kertas** jika V ≤ 3,9 L, G ≤ 3,0 kg, L ≤ 27 cm, dan N < 2.
2. Jika tidak, **karton** jika V ≤ 4,0 L, G ≤ 5,0 kg, dan L ≤ 25 cm.
3. Jika tidak juga, **dua kemasan**: WMS membagi baris pesanan, barang berat dan besar masuk karton lebih dulu, lalu menandai pesanan *2 kemasan*.

#### 6.10.2 Alasan angka-angka ini

Grab tidak punya spesifikasi tas atau karton, jadi setiap angka adalah asumsi yang perlu diuji:

- **Volume terpakai.** Tas kehilangan 6 cm di bagian atas untuk dilipat tertutup. Kedua kemasan dihitung terisi 80%, karena kotak kaku dan botol tidak pernah mengisi ruang sepenuhnya; sekitar seperlima tetap berisi udara.
- **Tas kertas 3,0 kg.** Tas kraft kecil dengan tali pilin biasanya dijual untuk membawa 3 sampai 5 kg. Kami ambil batas bawahnya karena tas juga berayun di dalam box rider.
- **Karton 5,0 kg.** Karton dinding tunggal seukuran ini sanggup membawa jauh lebih berat dari itu. Batasnya adalah beban yang masih nyaman ditahan selotip bawah dan box rider.
- **Dua botol besar berarti karton.** Dua botol berat di tas kertas menekan satu titik, merobek dasar tas, dan menghancurkan barang kecil di sebelahnya. Dalam simulasi pesanan sebelumnya, aturan ini mengirim sekitar 13% pesanan ke karton.
- **Barang terpanjang.** Tas menampung barang berdiri sampai setinggi lipatannya (27 cm); karton sampai sepanjang ukurannya (25 cm).

Jika data kemasan tidak ada: volume diambil dari perkiraan di daftar SKU; berat = isi (ml atau g) × 1,0 ditambah 20% untuk kemasan (plastik) atau 60% (kaca); bawaan kategori jika keduanya tidak diketahui. Saran kemasan lalu menampilkan *perkiraan*.

#### 6.10.3 Uji sebelum go-live, lalu tetapkan

1. Isi tas sampai 3,0 kg dengan produk asli (misalnya 2 pembersih Labore 225 ml dan sisanya tube kecil).
2. Angkat dari talinya, goyangkan 10 kali, gantung selama satu menit, lalu jatuhkan dari ketinggian 30 cm ke lantai keras.
3. Jika tahan, coba 4,0 kg dengan cara yang sama. Batasnya menjadi berat terakhir yang lolos, dikurangi 20%.
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

<!--screen:handover-->

1. **Serah ke driver** menampilkan daftar tas yang menunggu. Warna kuning berarti sudah menunggu lebih dari 20 menit.
2. Tanyakan nomor pesanan ke driver. Jika sama dengan nomor GM di slip, tekan **Ya, sudah diambil driver**. Hiryu diperbarui sendiri saat Grab mencatat pengambilan.

Jika Hiryu menampilkan pesanan itu sebagai dibatalkan, jangan serahkan: tekan **Dibatalkan di Hiryu** pada pesanan itu (§8.2) lalu bongkar kemasannya.

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

1. Tekan **Barang tidak ada**, lalu isi apa yang kamu temukan: *Tidak ada sama sekali*, atau atur jumlahnya dengan − dan +.
2. WMS menghentikan pesanan dan menampilkan **tempat lain yang mungkin menyimpan SKU itu**: bin kedua, atau bin sementara barang masuk yang menunggu disimpan ke rak. Cari di sana. Jika ketemu: tekan **Ketemu, lanjut ambil**.
3. Jika masih tidak ada: **panggil SPV**. SPV membatalkan **di Hiryu dulu**: *Cancel order* dengan alasan **2001 Item out of stock**. Lalu SPV menekan **Sudah dibatalkan di Hiryu** di layarmu.
4. Barang yang sudah diambil dikembalikan ke bin-nya (*Kembalikan ke rak*).
5. SPV langsung mengetik stok SKU itu ke Hiryu (§9.2), supaya Grab berhenti menjualnya.

### 8.2 Pesanan dibatalkan

<!--screen:cancel-->

1. Jika Hiryu menampilkan pesanan sebagai **CANCELLED**, buka pesanan itu di WMS (dari antrean, daftar ambil, kemas, atau daftar serah ke driver) lalu tekan **Dibatalkan di Hiryu**.
2. Periksa nomor GM lalu konfirmasi.
3. Barang yang sudah diambil masuk ke **Kembalikan ke rak**: scan setiap unit kembali ke bin-nya. Bongkar dulu tas yang sudah dikemas.
4. Beri tahu SPV: Hiryu tidak mengembalikan unit pesanan yang dibatalkan ke stoknya, jadi SPV mengetik ulang stok SKU itu (§9).

Jika tombol batal tertekan tanpa sengaja: SPV bisa membuka lagi pesanan itu.

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

<!--screen:eod-->

1. **Pilih saat sepi jika bisa.** Paling baik jika di **Live Orders** Hiryu, *Pending accept* dan *Pending packing* sama-sama **0**: dengan begitu Grab langsung menampilkan angka yang benar. Jika tidak bisa menunggu, tetap ketik: angka WMS sudah memperhitungkan pesanan yang sedang berjalan, jadi angka Hiryu akan benar setelah pesanan itu ditandai siap.

<!--screen:hiryu-live-->

2. Untuk setiap toko (dua per hub di pilot ini): di Hiryu buka *Stores → toko tersebut → Stock*. Untuk setiap baris berwarna di tab WMS *Stok untuk Hiryu*, cari **Kode SKU di Hiryu** yang sama (kode ini tercetak di bawah nama SKU di Hiryu) lalu ketik angka WMS dari **Ketik di Hiryu** ke **Units on hand**. Tekan **Save stock** di Hiryu.

<!--screen:hiryu-stock-->

3. **Lalu WMS**: tekan **Sudah disimpan di Hiryu**.

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

Selisih yang ditemukan saat hitung stok harus disetujui **SPV, lalu Ops HQ, lalu Ops Head** sebelum WMS mengubah stok. Unit yang ternyata **kurang** langsung dikeluarkan dari stok yang bisa dijual selama persetujuan berjalan, supaya Grab berhenti menjualnya. Unit yang ternyata **lebih** baru ditambahkan setelah Ops Head menandatangani. Setelah Ops Head menandatangani, ketik SKU-nya ke Hiryu (§9.2).

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
3. **Taruh di MA5-KARANTINA.** Masukkan unitnya ke baki karantina. Unit itu langsung keluar dari stok yang bisa dijual dan menunggu SPV (§11.2). *Salah tempat* dan *Barang ditemukan* tidak masuk baki: WMS menunjuk bin yang benar.

### 11.2 Masalah dan karantina

<!--screen:exceptions-->

**Siapa melakukan apa**: siapa saja boleh melapor dan menaruh unit di baki. **SPV yang memutuskan**. **Staf** yang memindahkan barangnya. **Penghapusan stok** juga harus disetujui **Ops HQ** dan ditandatangani **Ops Head**, setiap kali.

1. **Tanggungan** menunjukkan siapa yang menanggung biaya sesuai alasan yang dipilih (§11.6). Ubah alasannya jika laporannya salah.
2. Putuskan setiap laporan dalam 24 jam:

| Keputusan | Persetujuan | Apa yang terjadi selanjutnya | Bisa dijual lagi |
|---|---|---|---|
| **Kembali ke rak** | SPV | Tugas *Kembalikan dari karantina* muncul untuk staf: ambil unit dari baki, scan, taruh di bin yang ditunjuk WMS, scan bin-nya | Setelah bin di-scan |
| **Retur ke merek** | SPV | Unit tetap di baki dengan tanda *Menunggu retur* dan dikembalikan bersama kiriman merek berikutnya. Staf scan keluar unit itu sesuai **nota retur** yang dicetak WMS (*Surat Jalan retur*), yang ditandatangani driver merek | Tidak, unit keluar dari hub |
| **Hapus stok** (penghapusan stok) | SPV mengusulkan, Ops HQ menyetujui, Ops Head menandatangani | Setelah Ops Head menandatangani, staf scan keluar unit sebagai barang dibuang | Tidak |

3. Barang yang ada di baki lebih dari 24 jam tanpa keputusan akan ditandai ke kamu. Lebih dari 7 hari, ditandai ke Ops HQ.

<!--screen:karantina-task-->

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

### 12.1 Perangkat dan siapa bekerja di mana

Hub pilot mengambil dan mengemas barang di **lantai 2**, lalu menyerahkannya di **meja di lantai bawah**. Setiap perangkat punya satu tugas, dan **setiap orang masuk dengan akunnya sendiri** di perangkat mana pun yang dipakai (login Hiryu miliknya sendiri dan login Google WMS miliknya sendiri). Masuk saat shift mulai dan keluar saat shift selesai.

<!--screen:hub-devices-->

| Perangkat | Di mana | Dipakai untuk | Siapa |
|---|---|---|---|
| **Laptop kemas** (dari kit) dengan **printer struk** | Meja kemas, lantai atas | Live Orders Hiryu dengan cetak slip otomatis, copy dan paste ke WMS, *Mark ready*, SPV mengetik stok | Pengemas yang sedang bertugas; SPV untuk stok |
| **Ponsel hub** dengan WMS terpasang, plus **scanner 2D nirkabel** dari kit yang terhubung ke ponsel itu | Dibawa | Picking, putaway, penerimaan, hitung stok, *Laporkan masalah* | Picker yang sedang bertugas |
| **Ponsel hub kedua** (atau tablet) | Meja serah terima, lantai bawah | *Serah ke driver*, rak siap | Siapa pun yang membawa tas ke bawah |

- **Satu laptop, banyak orang.** Pengaturan printer di laptop tetap tersimpan, siapa pun yang masuk, karena Hiryu menyimpan printer per browser, bukan per orang. Hanya orang yang sedang memakai laptop yang masuk. Orang berikutnya mengeluarkan akun orang sebelumnya, lalu masuk dengan akunnya sendiri.
- **Dua orang bertugas** (target 5 menit): satu orang mengambil barang dengan ponsel, satu orang lagi paste, mengemas, dan menekan Mark ready di laptop. Orang yang mengemas membawa tas ke bawah. **Satu orang bertugas**: dia mengerjakan keduanya, dengan urutan yang sama.
- **Rak siap ada di lantai bawah**, di sebelah meja serah terima, supaya driver tidak pernah menunggu orang yang sedang di tangga.
- **Wi-Fi harus sampai ke kedua lantai.** Data seluler ponsel hub menjadi internet cadangan (§14).
- **Untuk pengadaan:** kit berisi satu laptop dan satu scanner per hub. Rencana ini menambah **dua ponsel Android per hub** (untuk picking dan serah terima), masing-masing dengan lanyard atau holder dan charger. Sesi pengadaan perlu menindaklanjuti ini; file pengadaan tidak diubah di sini.

### 12.2 Hal terbuka

- **Bahan habis pakai.** Tas kertas, kardus, lakban, gulungan kertas struk, lembar label A4, stiker warna hari, sekat, bin (JX-2, JX-4), baki karantina dan formulir catatan kertas. Belum ditulis: berapa banyak di tiap hub, siapa yang memesan ulang, disimpan di mana. *Usulan:* jumlah minimal per barang per hub, dicek di rutinitas mingguan SPV; WMS bisa menghitung tas dan kardus yang terpakai dari aturan kemasan.
- **Cek infrastruktur sebelum go-live.** Wi-Fi di kedua lantai, stop kontak di meja kemas dan meja serah terima, pakai UPS atau tidak, pengisian daya printer dan scanner, rak terpasang.
- **Perawatan perangkat.** Siapa pemilik HP, pengisian daya di malam hari, kunci layar, dan apa yang dilakukan kalau perangkat hilang atau rusak.
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
| WMS atau internet mati lebih dari 15 menit (§14) | 1 jam, lalu cek lagi |
| Orang di shift tidak cukup, atau ada keadaan darurat di hub (listrik, banjir, keselamatan) | 1 jam atau 24 jam |

1. **Hiryu dulu**: *Dark stores → hub tersebut → Pause this hub on Grab*, pilih waktunya, lalu tekan **Pause**. SPV yang melakukannya (atau Ops HQ jika SPV tidak bisa).
2. **Lalu WMS**: catat jeda itu dan alasannya di laporan akhir hari (*Masalah hari ini*).
3. Jeda untuk **satu merek saja** tidak bisa dilakukan di sini. Untuk menghentikan satu merek, atur stok SKU merek itu ke 0 saat mengetik stok (§9).

### 13.3 Akhir hari

1. **Cek pesanan.** Di Hiryu buka **Orders**, atur *Dark store* ke hub ini, lalu *From* dan *To* ke hari ini. Klik judul *Orders*, tekan Ctrl + A, Ctrl + C, lalu paste ke tab WMS *Cek pesanan*. Perbaiki setiap baris yang ditampilkan WMS: pesanan yang belum pernah di-paste, pembatalan yang belum ditekan siapa pun, atau pesanan yang ada di WMS tapi tidak ada di Hiryu.

<!--screen:hiryu-orders-->

2. **Ketik stoknya** (§9.3).
3. Putuskan masalah yang masih terbuka, catat jeda hub jika ada, atau tinggalkan catatan untuk SPV besok.

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
| **Internet di hub** | Hiryu dan WMS sama-sama tidak bisa dibuka | Sambungkan laptop ke **data seluler HP hub**. Jika itu juga gagal, telepon Ops HQ: mereka menjeda hub dari kantor |
| **Hiryu** | Hiryu tidak bisa dibuka dan tidak ada pesanan baru | Tidak ada yang perlu diambil. Telepon Ops HQ, yang akan menghubungi tim Hiryu |
| **Listrik** | Laptop memakai baterai, printer mati | Tulis nomor GM di setiap tas dengan tangan. Lanjutkan kerja dengan baterai. Jeda hub jika listrik tidak menyala lagi dalam 30 menit |
| **Printer struk** | Slip tidak keluar | Tulis nomor GM di tas. Pesan gulungan kertas baru atau laporkan printernya |

**Setelah WMS menyala lagi:**

1. Paste setiap pesanan dari catatan kertas dengan **Catat pesanan terlewat**: WMS mengurangi stok tanpa scan ambil dan menandainya *unscanned*.
2. Paste pembatalan yang ada, lalu tekan *Dibatalkan di Hiryu*.
3. Lakukan **hitung khusus** untuk setiap bin yang tertulis di catatan kertas (§10.1).
4. Ketik stok ke Hiryu (§9.3).

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

Per 29 September 2026. **Dev** = sudah di wms-test--dev untuk diuji (build pertama, 28 Sep). **Sudah dibuat** = ada di aplikasi dari build sebelumnya. Belum ada yang di produksi.

| Proses | Di dev atau sudah dibuat | Belum |
|---|---|---|
| 1. Login dan akses pengguna | Login Google, daftar pengguna | Peran Ops Head; SPV hanya menambah staf |
| 2. Pendaftaran dan pengaturan toko | Dev: *Menu & toko Hiryu* (unggah CSV menu, hubungkan barang, peta toko, harga tersimpan) | Form merek; form SKU dengan kode Hiryu di depan, unit atau %, ukuran bin; impor data induk SKU |
| 3. Pengaturan rak | Rak dan bin, satu bay; peta hub | Gambar rak, bay, tumpukan dari ukuran bin; bin inbound sementara; baki karantina sebagai lokasi |
| 4. Restock dan batas stok | Permintaan restock, persetujuan selisih, pengingat, draf otomatis | Kolom *Catat pengiriman*; unit atau %; isi maks. per bin yang dipelajari dan pertanyaan bin kedua; selisih tiga langkah |
| 5. Barang masuk dan penyimpanan | Terima per AWB dalam batch, daftar penyimpanan, produk tak dikenal ke HQ | ED per batch; kiriman tanpa AWB tercatat |
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

**Deploy berikutnya ke dev**: (2) pendaftaran dan peran, form merek, form SKU; (3) karantina dan persetujuan, ED per batch, gambar rak, kemasan, laporan akhir hari. Tombol satu klik menyusul setelah fitur tempel berjalan di hub.

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
