const crypto = require("crypto");
const { queryMitra, querySpk } = require("../config/db");

function getLaravelKey() {
  const rawKey = process.env.LARAVEL_APP_KEY_BASE64 || process.env.APP_KEY || "";
  const keyValue = rawKey.startsWith("base64:") ? rawKey.slice(7) : rawKey;
  if (!keyValue) return null;
  return Buffer.from(keyValue, "base64");
}

function decryptLaravelNik(nik) {
  if (!nik) return null;

  const value = String(nik);
  if (!value.startsWith("eyJ")) {
    return value;
  }

  const key = getLaravelKey();
  if (!key) return value;

  try {
    const payload = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
    const iv = Buffer.from(payload.iv, "base64");
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(payload.value, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (_) {
    return value;
  }
}

async function insertAuditLog({ userId, username, action, entityName, details, ipAddress, userAgent }) {
  await querySpk(
    `INSERT INTO audit_logs(UserId, Username, Action, EntityName, Details, IpAddress, UserAgent)
     VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [userId || 0, username || "System", action, entityName, JSON.stringify(details || {}), ipAddress || null, userAgent || null]
  );
}

async function getPeriodes() {
  return querySpk(
    `SELECT Id, NamaPeriode, Tahun, DivisiId, TanggalMulai, TanggalSelesai, Status
     FROM periodes
     ORDER BY Id DESC`
  );
}

async function getPeriodesByDivision(divisiId) {
  return querySpk(
    `SELECT Id, NamaPeriode, Tahun, DivisiId, TanggalMulai, TanggalSelesai, Status
     FROM periodes
     WHERE DivisiId = ? OR DivisiId IS NULL
     ORDER BY Id DESC`,
    [divisiId]
  );
}

async function getPeriodeById(id) {
  const rows = await querySpk(
    `SELECT Id, NamaPeriode, Tahun, DivisiId, TanggalMulai, TanggalSelesai, Status
     FROM periodes
     WHERE Id = ?
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function createPeriode(data) {
  const result = await querySpk(
    `INSERT INTO periodes(NamaPeriode, Tahun, DivisiId, TanggalMulai, TanggalSelesai, Status)
     VALUES(?, ?, ?, ?, ?, ?)`,
    [
      data.NamaPeriode,
      data.Tahun ?? null,
      data.DivisiId ?? null,
      data.TanggalMulai,
      data.TanggalSelesai,
      data.Status ?? "Draft"
    ]
  );
  return result.insertId;
}

async function updatePeriode(id, data) {
  await querySpk(
    `UPDATE periodes
     SET NamaPeriode = ?,
         Tahun = ?,
         DivisiId = ?,
         TanggalMulai = ?,
         TanggalSelesai = ?,
         Status = ?
     WHERE Id = ?`,
    [
      data.NamaPeriode,
      data.Tahun ?? null,
      data.DivisiId ?? null,
      data.TanggalMulai,
      data.TanggalSelesai,
      data.Status ?? "Draft",
      id
    ]
  );
}

async function deletePeriode(id) {
  await querySpk("DELETE FROM periodes WHERE Id = ?", [id]);
}

async function getKpis(periodeId) {
  if (periodeId) {
    return querySpk(
      `SELECT k.Id, k.NamaKpi, k.Tipe, k.BobotAhp, k.PeriodeId, k.attributeId,
              ms.nama AS nama_satuan, ms.simbol AS simbol
       FROM kpis k
       LEFT JOIN attribute ms ON ms.id = k.attributeId
       WHERE k.PeriodeId = ?
       ORDER BY k.Id ASC`,
      [periodeId]
    );
  }
  return querySpk(
    `SELECT k.Id, k.NamaKpi, k.Tipe, k.BobotAhp, k.PeriodeId, k.attributeId,
            ms.nama AS nama_satuan, ms.simbol AS simbol
     FROM kpis k
     LEFT JOIN attribute ms ON ms.id = k.attributeId
     ORDER BY k.Id ASC`
  );
}

async function getKpisByDivision(divisiId, periodeId) {
  let sql =
    `SELECT k.Id, k.NamaKpi, k.Tipe, k.BobotAhp, k.PeriodeId, k.attributeId,
            ms.nama AS nama_satuan, ms.simbol AS simbol
     FROM kpis k
     JOIN periodes p ON p.Id = k.PeriodeId
     LEFT JOIN attribute ms ON ms.id = k.attributeId
     WHERE (p.DivisiId = ? OR p.DivisiId IS NULL)`;
  const params = [divisiId];

  if (periodeId) {
    sql += " AND k.PeriodeId = ?";
    params.push(periodeId);
  }

  sql += " ORDER BY k.Id ASC";
  return querySpk(sql, params);
}

async function createKpi(data) {
  const result = await querySpk(
    `INSERT INTO kpis(NamaKpi, Tipe, PeriodeId, BobotAhp, attributeId)
     VALUES(?, ?, ?, ?, ?)`,
    [data.NamaKpi, data.Tipe, data.PeriodeId, data.BobotAhp || 0, data.attributeId || null]
  );
  return result.insertId;
}

async function updateKpi(id, data) {
  await querySpk(
    `UPDATE kpis
     SET NamaKpi = ?,
         Tipe = ?,
         PeriodeId = ?,
         attributeId = ?,
         BobotAhp = ?
     WHERE Id = ?`,
    [data.NamaKpi, data.Tipe, data.PeriodeId, data.attributeId || null, data.BobotAhp || 0, id]
  );
}

async function deleteKpi(id) {
  await querySpk("DELETE FROM kpis WHERE Id = ?", [id]);
}

async function getComparisons(periodeId) {
  return querySpk(
    `SELECT ac.Id, ac.PeriodeId, ac.KpiAId, ac.KpiBId, ac.Nilai,
            ka.NamaKpi AS KpiAName, kb.NamaKpi AS KpiBName
     FROM ahp_comparisons ac
     LEFT JOIN kpis ka ON ka.Id = ac.KpiAId
     LEFT JOIN kpis kb ON kb.Id = ac.KpiBId
     WHERE ac.PeriodeId = ?
     ORDER BY ac.Id ASC`,
    [periodeId]
  );
}

async function replaceComparisons(periodeId, items) {
  await querySpk("DELETE FROM ahp_comparisons WHERE PeriodeId = ?", [periodeId]);
  if (!items.length) return;

  const valuesSql = items.map(() => "(?, ?, ?, ?)").join(",");
  const params = items.flatMap((item) => [item.PeriodeId, item.KpiAId, item.KpiBId, item.Nilai]);
  await querySpk(
    `INSERT INTO ahp_comparisons(PeriodeId, KpiAId, KpiBId, Nilai) VALUES ${valuesSql}`,
    params
  );
}

async function updateKpiWeights(periodeId, weightByKpiId) {
  const entries = Object.entries(weightByKpiId);
  if (entries.length === 0) return;

  const promises = entries.map(([kpiId, bobot]) =>
    querySpk("UPDATE kpis SET BobotAhp = ? WHERE Id = ? AND PeriodeId = ?", [bobot, Number(kpiId), periodeId])
  );
  await Promise.all(promises);
}

async function replaceEvaluations(periodeId, evals, createdBy = null) {
  const employeeIds = [...new Set(evals.map((x) => x.KaryawanId))];
  if (employeeIds.length > 0) {
    const placeholders = employeeIds.map(() => "?").join(",");
    await querySpk(
      `DELETE FROM penilaians WHERE PeriodeId = ? AND KaryawanId IN (${placeholders})`,
      [periodeId, ...employeeIds]
    );
  }

  if (!evals.length) return;
  const valuesSql = evals.map(() => "(?, ?, ?, ?, ?)").join(",");
  const params = evals.flatMap((ev) => [ev.KaryawanId, ev.KpiId, ev.PeriodeId, ev.Nilai, createdBy]);
  await querySpk(`INSERT INTO penilaians(KaryawanId, KpiId, PeriodeId, Nilai, created_by) VALUES ${valuesSql}`, params);
}

async function getEvaluationsByPeriode(periodeId) {
  return querySpk("SELECT Id, KaryawanId, KpiId, PeriodeId, Nilai, created_at, created_by FROM penilaians WHERE PeriodeId = ?", [periodeId]);
}

async function clearHasilAkhir(periodeId) {
  await querySpk("DELETE FROM hasil_akhir WHERE PeriodeId = ?", [periodeId]);
}

async function insertHasilAkhirBatch(rows) {
  if (!rows.length) return;
  const valuesSql = rows.map(() => "(?, ?, ?, ?, ?)").join(",");
  const params = rows.flatMap((row) => [row.KaryawanId, row.PeriodeId, row.NilaiOptimasi, row.NilaiSkala, row.Ranking]);
  await querySpk(
    `INSERT INTO hasil_akhir(KaryawanId, PeriodeId, NilaiOptimasi, NilaiSkala, Ranking) VALUES ${valuesSql}`,
    params
  );
}

async function getHasilAkhirByPeriode(periodeId) {
  return querySpk(
    `SELECT h.Id, h.KaryawanId, h.PeriodeId, h.NilaiOptimasi, h.NilaiSkala, h.Ranking
     FROM hasil_akhir h
     WHERE h.PeriodeId = ?
     ORDER BY h.Ranking ASC`,
    [periodeId]
  );
}

async function getEmployeesByIds(employeeIds) {
  if (!employeeIds.length) return [];
  const placeholders = employeeIds.map(() => "?").join(",");
  const rows = await queryMitra(
    `SELECT e.id, e.name, e.email, e.nik, e.departemen_id, e.lokasikerja,
            j.nama AS jabatan_nama
     FROM employees e
     LEFT JOIN jabatans j ON j.id = e.jabatan_id
     WHERE e.id IN (${placeholders})`,
    employeeIds
  );
  return rows.map((row) => ({
    ...row,
    nik: decryptLaravelNik(row.nik)
  }));
}

async function getDepartments() {
  try {
    return await queryMitra("SELECT id, name FROM departments ORDER BY id ASC");
  } catch (_) {
    return queryMitra("SELECT id, name FROM departemens ORDER BY id ASC");
  }
}

async function getDepartmentById(id) {
  try {
    const rows = await queryMitra("SELECT id, name FROM departments WHERE id = ? LIMIT 1", [id]);
    return rows[0] || null;
  } catch (_) {
    const rows = await queryMitra("SELECT id, name FROM departemens WHERE id = ? LIMIT 1", [id]);
    return rows[0] || null;
  }
}

async function getEmployees({ deptId, lokasiKerja }) {
  let sql = `SELECT e.id, e.name, e.email, e.nik, e.departemen_id, e.lokasikerja,
                    d.name AS department_name, wl.id AS work_location_id,
                    wl.name AS work_location_name, u.id AS user_id, u.role,
                    j.nama AS jabatan_nama
             FROM employees e
             LEFT JOIN users u ON u.email = e.email
             LEFT JOIN departemens d ON d.id = e.departemen_id
             LEFT JOIN work_locations wl ON wl.name = e.lokasikerja
             LEFT JOIN jabatans j ON j.id = e.jabatan_id
             WHERE e.status_kerja = 'aktif'`;
  const params = [];
  if (deptId) {
    sql += " AND e.departemen_id = ?";
    params.push(deptId);
  }
  if (lokasiKerja) {
    sql += " AND e.lokasikerja = ?";
    params.push(lokasiKerja);
  }
  sql += " ORDER BY e.id ASC";
  const rows = await queryMitra(sql, params);
  return rows.map((row) => ({
    ...row,
    nik: decryptLaravelNik(row.nik)
  }));
}

async function getWorkLocations({ status }) {
  let sql = "SELECT id, name, status, berlaku, tanggalawal, tanggal_mulai FROM work_locations";
  const params = [];
  if (status) {
    sql += " WHERE status = ?";
    params.push(status);
  }
  sql += " ORDER BY name ASC";
  return queryMitra(sql, params);
}

async function getEmployeeByUserId(userId) {
  const rows = await queryMitra(
    `SELECT u.id AS user_id, u.role, e.id AS employee_id, e.name, e.email, e.lokasikerja,
            j.nama AS jabatan_nama
     FROM users u
     LEFT JOIN employees e ON e.email = u.email
     LEFT JOIN jabatans j ON j.id = e.jabatan_id
     WHERE u.id = ?
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function getEmployeeLocationsByIds(employeeIds) {
  if (!employeeIds.length) return [];
  const placeholders = employeeIds.map(() => "?").join(",");
  return queryMitra(
    `SELECT e.id, e.lokasikerja, u.role
     FROM employees e
     LEFT JOIN users u ON u.email = e.email
     WHERE e.id IN (${placeholders})`,
    employeeIds
  );
}

async function getAuditLogs({ limit, offset }) {
  const rows = await querySpk(
    `SELECT Id, UserId, Username, Action, EntityName, Details, IpAddress, UserAgent, CreatedAt
     FROM audit_logs
     ORDER BY Id DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  const totalRows = await querySpk("SELECT COUNT(*) AS total FROM audit_logs");
  return {
    rows,
    total: Number(totalRows[0]?.total || 0)
  };
}

async function getDistinctKaryawanIdsByPeriode(periodeId) {
  const rows = await querySpk(
    "SELECT DISTINCT KaryawanId FROM penilaians WHERE PeriodeId = ? ORDER BY KaryawanId ASC",
    [periodeId]
  );
  return rows.map((r) => r.KaryawanId);
}

async function getEvaluationChunk(periodeId, employeeIds) {
  if (!employeeIds.length) return [];
  const placeholders = employeeIds.map(() => "?").join(",");
  return querySpk(
    `SELECT KaryawanId, KpiId, Nilai FROM penilaians
     WHERE PeriodeId = ? AND KaryawanId IN (${placeholders})`,
    [periodeId, ...employeeIds]
  );
}

module.exports = {
  insertAuditLog,
  getPeriodes,
  getPeriodesByDivision,
  getPeriodeById,
  createPeriode,
  updatePeriode,
  deletePeriode,
  getKpis,
  getKpisByDivision,
  createKpi,
  updateKpi,
  deleteKpi,
  getComparisons,
  replaceComparisons,
  updateKpiWeights,
  replaceEvaluations,
  getEvaluationsByPeriode,
  clearHasilAkhir,
  insertHasilAkhirBatch,
  getHasilAkhirByPeriode,
  getEmployeesByIds,
  getDepartments,
  getDepartmentById,
  getEmployees,
  getWorkLocations,
  getEmployeeByUserId,
  getEmployeeLocationsByIds,
  getDistinctKaryawanIdsByPeriode,
  getEvaluationChunk,
  getAuditLogs
};
