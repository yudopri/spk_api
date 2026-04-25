# SPK API Express Migration

Migrasi backend Flask ke Express.js dengan arsitektur dual database tanpa mengubah alur bisnis SPK (AHP-MOORA).

## Arsitektur

- DB Lama (Read-Only): `u321107642_wbaweb`
- DB Baru SPK (Read/Write): `db_spk_yudo`
- Relasi login user-employee: berdasarkan `email`

## Struktur Folder

- `controllers/`
- `routes/`
- `middlewares/`
- `config/`
- `models/`
- `services/`
- `tests/`

## Endpoint Utama (dipertahankan)

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/permissions`
- `POST /api/auth/permissions`
- `GET /api/auth/mitra-roles/:role_name/permissions`
- `POST /api/auth/mitra-roles/:role_name/permissions`
- `GET /api/auth/roles-mitra`
- `POST /api/auth/seed-permissions`
- `GET /api/auth/audit-logs` (role `Manager` dan `Dev`)
- `GET /api/spk/periode`
- `POST /api/spk/periode`
- `PUT /api/spk/periode/:id`
- `DELETE /api/spk/periode/:id`
- `GET /api/spk/kpi`
- `POST /api/spk/kpi`
- `PUT /api/spk/kpi/:id`
- `DELETE /api/spk/kpi/:id`
- `GET /api/spk/ahp/perbandingan/:periode_id`
- `POST /api/spk/ahp/perbandingan`
- `POST /api/spk/ahp/calculate-weight/:periode_id`
- `POST /api/spk/moora/penilaian`
- `POST /api/spk/moora/calculate/:periode_id`
- `GET /api/spk/moora/hasil/:periode_id`
- `GET /api/departments`
- `GET /api/employees`
- Alias lama tetap ada: `GET /api/spk/mitra/departments`, `GET /api/spk/mitra/karyawan`

## Aturan Akses Role (Ringkas)

- `Manager`: akses keseluruhan data dan proses SPK.
- `Kadiv`: akses data/proses SPK, tetapi tidak boleh menilai karyawan dengan role `Manager`.
- `Admin` dan semua `Adm ...`: hanya view data divisi, karyawan, dan hasil ranking sesuai divisi user.
- `Karyawan`: hanya view data diri sendiri (karyawan) dan hasil ranking divisinya sendiri.
- `Dev`: akses menu developer tools audit log.

## Filter API Tambahan

- `GET /api/employees`
	- `dept_id`: filter divisi
	- `lokasi_kerja`: filter lokasi kerja
	- `include_management_roles` (default `false`): include role manajerial (`Admin`, `Manager`, `Adm*`, `Kadiv`, `Dev`)
	- `role_group`: `management` atau `staff`
- `GET /api/spk/moora/hasil/:periode_id`
	- `lokasi_kerja`: filter hasil ranking berdasarkan lokasi kerja

## OpenAPI

- Spec OpenAPI versi Express tersedia di `docs/swagger.yaml`

## Optional Startup Migration

- Set `AUTO_SEED_PERMISSIONS=true` agar server melakukan seed permissions otomatis saat startup.
- Default `false` agar migration tetap manual lewat endpoint `POST /api/auth/seed-permissions`.

## Menjalankan

```bash
npm install
cp .env.example .env
npm run start
```

## Smoke Test

```bash
npm run smoke
```

Smoke test memverifikasi fungsi matematika AHP dan MOORA (tanpa koneksi database).
