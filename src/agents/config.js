// SWEET AI Agent Office — karyawan, ruangan, furnitur, dan tata letak kantor.
// Foto wajah karakter diambil otomatis dari models/foto/<key>.jpg (jpg/jpeg/png/webp).
// Prinsip: 1 Agent = 1 Kerjaan.

const AGENTS = [
  // ---------- Tim Produk & Engineering (agent #1 - #10) ----------
  { no: 1, key: 'kamala', job: 'pm', dept: 'dev', name: 'Kamala', role: 'Product Manager', color: '#f2a65a',
    specialty: 'Memecah ide menjadi daftar fitur: Login, Chat, Payment, Profile, Notif.',
    furniture: 'kanban', tools: ['read'],
    routine: ['Merapikan backlog fitur', 'Menulis user story Login & Chat', 'Menentukan prioritas P0/P1/P2', 'Menyusun acceptance criteria Payment'] },
  { no: 2, key: 'indra', job: 'arch', dept: 'dev', name: 'Indra', role: 'Product Architect', color: '#7aa6d6',
    specialty: 'Merancang struktur proyek: data/, domain/, presentation/, lib/.',
    furniture: 'blueprint', tools: [],
    routine: ['Menggambar diagram lapisan data/domain/presentation', 'Mengecek aturan dependensi antar lapisan', 'Merapikan folder lib/ bersama', 'Menulis ADR arsitektur'] },
  { no: 3, key: 'nadine', job: 'design', dept: 'dev', name: 'Nadine', role: 'UI/UX Designer', color: '#e58fb5',
    specialty: 'Membuat alur dan tampilan tiap alur (screen flow, komponen, state).',
    furniture: 'easel', tools: [],
    routine: ['Membuat wireframe alur Login', 'Menyusun komponen UI (button, card, input)', 'Mendesain state loading/empty/error', 'Memilih palet warna & tipografi'] },
  { no: 4, key: 'felix', job: 'mobile', dept: 'dev', name: 'Felix', role: 'Mobile Developer', color: '#6bc1a1',
    specialty: 'Membangun aplikasi mobile dengan mengikuti kontrak API yang sama dengan backend.',
    furniture: 'phone', tools: [],
    routine: ['Membuat layar Login sesuai desain', 'Menghubungkan Chat ke endpoint kontrak API', 'Menulis repository di lapisan data/', 'Menguji build di emulator'] },
  { no: 5, key: 'norman', job: 'backend', dept: 'dev', name: 'Norman', role: 'Backend Developer', color: '#8a7fd1',
    specialty: 'Membuat kontrak API dan servernya; mobile mengikuti kontrak yang sama.',
    furniture: 'rack', tools: [],
    routine: ['Memperbarui kontrak API (OpenAPI)', 'Menulis endpoint /auth/login', 'Menambah validasi request', 'Mengoptimalkan query endpoint chat'] },
  { no: 6, key: 'nola', job: 'db', dept: 'dev', name: 'Nola', role: 'Database Engineer', color: '#5aa9c9',
    specialty: 'Mengatur tabel dan relasi agar tidak ada data dobel (normalisasi, index, migrasi).',
    furniture: 'dbstack', tools: ['db'],
    routine: ['Mengecek data dobel di tabel', 'Menambah index & constraint UNIQUE', 'Menulis migrasi skema', 'Normalisasi tabel pesanan'] },
  { no: 7, key: 'wucing', job: 'qa', dept: 'dev', name: 'Wucing', role: 'QA Engineer', color: '#e9a24b',
    specialty: 'Mencari bug sampai ketemu: skenario uji, edge case, laporan bug.',
    furniture: 'bugboard', tools: [],
    routine: ['Menjalankan skenario uji Login', 'Mencari edge case Payment', 'Menulis laporan bug', 'Regression test fitur Chat'] },
  { no: 8, key: 'raka', job: 'sec', dept: 'dev', name: 'Raka', role: 'Security Engineer', color: '#d96c6c',
    specialty: 'Mengecek celah keamanan sebelum orang lain menemukannya.',
    furniture: 'vault', tools: [],
    routine: ['Memindai celah injeksi', 'Mengecek penyimpanan token & password', 'Audit rate limit login', 'Review izin akses API'] },
  { no: 9, key: 'robot', job: 'devops', dept: 'dev', name: 'Robo', role: 'DevOps Engineer', color: '#9aa8b5',
    specialty: 'Mengurus build, CI/CD, dan deploy.',
    furniture: 'rocket', tools: ['system'],
    routine: ['Menjalankan pipeline build', 'Memantau server & log', 'Menyiapkan rilis staging', 'Memeriksa backup database'] },
  { no: 10, key: 'chelsea', job: 'lead', dept: 'dev', name: 'Chelsea', role: 'Tech Lead', color: '#c9a227',
    specialty: 'Mereview semua pekerjaan; yang jelek dikembalikan untuk diperbaiki.',
    furniture: 'review', tools: ['read'],
    routine: ['Mereview pull request tim', 'Mengecek konsistensi kontrak API', 'Mengembalikan pekerjaan yang kurang', 'Menyusun standar kode'] },

  // ---------- Tim Toko Lazada ----------
  { no: 11, key: 'sari', job: 'cs', dept: 'toko', name: 'Sari', role: 'Customer Service', color: '#f08fa0',
    specialty: 'Membalas chat pembeli Lazada dengan ramah dan cepat.',
    furniture: 'headset', tools: ['chat'],
    routine: ['Mengecek chat pembeli', 'Menyiapkan template balasan', 'Merangkum pertanyaan pembeli'] },
  { no: 12, key: 'dimas', job: 'order', dept: 'toko', name: 'Dimas', role: 'Order & Resi', color: '#d9a066',
    specialty: 'Memantau pesanan baru, pack, siap kirim, dan nomor resi.',
    furniture: 'parcels', tools: ['order'],
    routine: ['Memeriksa pesanan baru', 'Mencocokkan nomor resi', 'Menyiapkan paket untuk kurir'] },
  { no: 13, key: 'bayu', job: 'stock', dept: 'toko', name: 'Bayu', role: 'Stok & Harga', color: '#78b38a',
    specialty: 'Update stok dan harga SKU, cek produk yang menipis.',
    furniture: 'shelves', tools: ['product'],
    routine: ['Mengecek stok menipis', 'Membandingkan harga kompetitor', 'Memperbarui katalog produk'] },
  { no: 14, key: 'mira', job: 'ads', dept: 'toko', name: 'Mira', role: 'Iklan & Promo', color: '#e8754a',
    specialty: 'Membuat proposal iklan/promo per produk; berjalan setelah Kevin menekan Terima.',
    furniture: 'billboard', tools: ['ads', 'product'],
    routine: ['Mencari produk yang layak diiklankan', 'Menulis copy iklan', 'Memantau iklan yang berjalan'] },
  { no: 15, key: 'tomi', job: 'analis', dept: 'toko', name: 'Tomi', role: 'Analis Penjualan', color: '#5b8fd9',
    specialty: 'Laporan omzet, produk terlaris, dan tren pesanan.',
    furniture: 'charts', tools: ['sales', 'read'],
    routine: ['Menghitung omzet hari ini', 'Mencari produk terlaris', 'Menyusun laporan mingguan'] },

  // ---------- Tim Trading (tambang emas, kerja 24 jam) ----------
  { no: 16, key: 'aurel', job: 'xau', dept: 'trading', type: 'trader', name: 'Aurel', role: 'XAUUSD Trader', color: '#d6b26e',
    specialty: 'Trading emas XAUUSD 24 jam di akun HFM MetaTrader 5: analisa tren, pasang Buy Limit / Sell Limit dengan SL & TP, menjaga batas risiko harian.',
    furniture: 'mine', tools: ['read'],
    routine: ['Analisa tren XAUUSD M15', 'Memasang Buy Limit / Sell Limit', 'Mengawal posisi terbuka', 'Menghitung PnL harian'] }
];

const BOSS = { key: 'kevin', name: 'Kevin', role: 'Bos SWEET', color: '#2b2b2b', room: 'boss', boss: true };
const NPCS = [{ key: 'juan', name: 'Juan', role: 'Resepsionis', color: '#6a8caf', npc: true }];

// ---------- Tata letak (satuan meter, dipakai Office 3D & Ruang Agen) ----------
const GRID = [
  ['pm', 'arch', 'design', 'mobile', 'backend'],
  ['db', 'qa', 'sec', 'devops', 'lead'],
  ['cs', 'order', 'stock', 'ads', 'analis']
];
const FLOOR = {
  pm: '#f6dca8', arch: '#bcd6ee', design: '#f3c6dc', mobile: '#c5e8d6', backend: '#d3cdf2',
  db: '#bfe3ee', qa: '#f7d9b0', sec: '#f2c4c4', devops: '#d4dbe3', lead: '#efe3b0',
  cs: '#f6cdd5', order: '#ecd7bd', stock: '#cfe6cf', ads: '#f7cdb8', analis: '#c7d8f2'
};
const RW = 14, RD = 11, GX = 16, GZ = 13.5, Z0 = 8;
// Area tambang emas: x 46..90, z -14..52 (kantor x -41..41)
const MINE = { x: 68, z: 19, w: 44, d: 66, x0: 46, x1: 90, z0: -14, z1: 52,
  cave: { x: 72, z: -6 }, desk: { x: 57, z: 12 }, flag: { x: 59.9, z: 12.6 }, board: { x: 57, z: 3.5 }, pile: { x: 76.5, z: 24 }, railEnd: 21, gate: { x: 48, z: 0.9 } };

function buildLayout() {
  const rooms = [];
  GRID.forEach((row, r) => row.forEach((job, c) => {
    const a = AGENTS.find((x) => x.job === job);
    rooms.push({ id: `room_${job}`, label: a.role.toUpperCase(), job, agent: a.key, no: a.no, x: (c - 2) * GX, z: Z0 + r * GZ, w: RW, d: RD, level: 0, theme: a.furniture, floor: FLOOR[job], color: a.color });
  }));
  // Tambang emas (agent #16 Aurel) di sebelah timur kantor, terhubung lewat pintu samping
  const a16 = AGENTS.find((x) => x.job === 'xau');
  rooms.push({ id: 'room_xau', label: 'TAMBANG EMAS · XAUUSD', job: 'xau', agent: a16.key, no: a16.no, x: MINE.x, z: MINE.z, w: MINE.w, d: MINE.d, level: 0, theme: 'mine', floor: '#7a6247', color: a16.color, outdoor: true });
  rooms.push({ id: 'bullpen', label: 'TIM BARU (REKRUTAN)', x: 0, z: Z0 + 3 * GZ, w: 4 * GX + RW, d: RD, level: 0, theme: 'bullpen', floor: '#e9e2d3' });
  rooms.push({ id: 'lounge', label: 'LOUNGE', x: -26, z: -10.5, w: 24, d: 8, level: 1, theme: 'lounge', floor: '#f1ddc4' });
  rooms.push({ id: 'meeting', label: 'RUANG RAPAT', x: 0, z: -10.5, w: 24, d: 8, level: 1, theme: 'meeting', floor: '#dfe6ee' });
  rooms.push({ id: 'boss', label: 'RUANG KEVIN', x: 26, z: -10.5, w: 24, d: 8, level: 1, theme: 'boss', floor: '#e6d3b8' });
  return { rooms, deck: { x0: -39, x1: 39, z0: -15, z1: -4, h: 2.6, walkZ: -5.25 }, stair: { x: 36, top: -4.2, bottom: 2.2 }, northZ: 0.9, aisles: [-24, -8, 8, 24], corridorOffset: RD / 2 + (GZ - RD) / 2, floor: { x0: -41, x1: 41, z0: -16, z1: Z0 + 3 * GZ + RD / 2 + 2 },
    mine: MINE, yard: { x0: -50, x1: 96, z0: -24, z1: 62 }, perimeter: [[-45, -20], [93, -20], [93, 58], [-45, 58]] };
}

module.exports = { AGENTS, BOSS, NPCS, LAYOUT: buildLayout() };
