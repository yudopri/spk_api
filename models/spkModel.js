const crypto = require("crypto");
const { queryMitra, querySpk, applyQueryMeta } = require("../config/db");

function getLaravelKey() {
  const rawKey = process.env.LARAVEL_APP_KEY_BASE64 || process.env.APP_KEY || "";
  const keyValue = rawKey.startsWith("base64:") ? rawKey.slice(7) : rawKey;
  if (!keyValue) return null;
  return Buffer.from(keyValue, "base64");
}

function decryptLaravelNik(nik_ktp) {
  if (!nik_ktp) return null;

  const value = String(nik_ktp);
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

async function getPeriodes(options = {}) {
  const baseSql = `SELECT Id, NamaPeriode, Tahun, DivisiId, TanggalMulai, TanggalSelesai, Status
     FROM periodes`;
  const { sql, params, countSql, countParams } = applyQueryMeta(baseSql, [], options, ["NamaPeriode", "Tahun", "Status"]);
  
  const [rows, totalRes] = await Promise.all([
    querySpk(sql, params),
    querySpk(countSql, countParams)
  ]);
  return { rows, total: totalRes[0]?.total || 0 };
}

async function getPeriodesByDivision(divisiId, options = {}) {
  const baseSql = `SELECT Id, NamaPeriode, Tahun, DivisiId, TanggalMulai, TanggalSelesai, Status
     FROM periodes
     WHERE DivisiId = ? OR DivisiId IS NULL`;
  const { sql, params, countSql, countParams } = applyQueryMeta(baseSql, [divisiId], options, ["NamaPeriode", "Tahun", "Status"]);

  const [rows, totalRes] = await Promise.all([
    querySpk(sql, params),
    querySpk(countSql, countParams)
  ]);
  return { rows, total: totalRes[0]?.total || 0 };
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
async function getKpisByPeriode(periodeId) {
  return await querySpk(
    `SELECT Id, Target, Tipe
     FROM kpis
     WHERE PeriodeId = ? AND IsActive = 1`,
    [periodeId]
  );
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

// KPI Groups
async function getKpiGroups(periodeId, options = {}) {
  let baseSql = "SELECT id, nama_grup, periode_id, bobot_grup FROM kpi_groups";
  const baseParams = [];
  if (periodeId) {
    baseSql += " WHERE periode_id = ?";
    baseParams.push(periodeId);
  }

  const { sql, params, countSql, countParams } = applyQueryMeta(baseSql, baseParams, options, ["nama_grup"]);
  const [rows, totalRes] = await Promise.all([
    querySpk(sql, params),
    querySpk(countSql, countParams)
  ]);
  return { rows, total: totalRes[0]?.total || 0 };
}

async function createKpiGroup(data) {
  const result = await querySpk(
    "INSERT INTO kpi_groups (nama_grup, periode_id, bobot_grup) VALUES (?, ?, ?)",
    [data.nama_grup, data.periode_id, data.bobot_grup || 0]
  );
  return result.insertId;
}

async function updateKpiGroup(id, data) {
  await querySpk(
    "UPDATE kpi_groups SET nama_grup = ?, bobot_grup = ? WHERE id = ?",
    [data.nama_grup, data.bobot_grup || 0, id]
  );
}

async function deleteKpiGroup(id) {
  await querySpk("DELETE FROM kpi_groups WHERE id = ?", [id]);
}

async function getGroupComparisons(periodeId) {
  return querySpk(
    `SELECT gc.id, gc.periode_id, gc.group_a_id, gc.group_b_id, gc.nilai,
            ga.nama_grup AS group_a_name, gb.nama_grup AS group_b_name
     FROM kpi_group_comparisons gc
     LEFT JOIN kpi_groups ga ON ga.id = gc.group_a_id
     LEFT JOIN kpi_groups gb ON gb.id = gc.group_b_id
     WHERE gc.periode_id = ?
     ORDER BY gc.id ASC`,
    [periodeId]
  );
}

async function replaceGroupComparisons(periodeId, items) {
  await querySpk("DELETE FROM kpi_group_comparisons WHERE periode_id = ?", [periodeId]);
  if (!items.length) return;

  const valuesSql = items.map(() => "(?, ?, ?, ?)").join(",");
  const params = items.flatMap((item) => [item.periode_id, item.group_a_id, item.group_b_id, item.nilai]);
  await querySpk(
    `INSERT INTO kpi_group_comparisons(periode_id, group_a_id, group_b_id, nilai) VALUES ${valuesSql}`,
    params
  );
}

async function updateGroupWeights(periodeId, weightByGroupId) {
  const entries = Object.entries(weightByGroupId);
  if (entries.length === 0) return;

  const promises = entries.map(([groupId, bobot]) =>
    querySpk("UPDATE kpi_groups SET bobot_grup = ? WHERE id = ? AND periode_id = ?", [bobot, Number(groupId), periodeId])
  );
  await Promise.all(promises);
}

async function getKpis(periodeId, options = {}, groupId = null) {
  let baseSql = `
    SELECT k.Id, k.NamaKpi, k.Tipe, k.Target, k.IsActive, k.BobotAhp, k.PeriodeId, k.attributeId, k.group_id,
           ms.nama AS nama_satuan, ms.simbol AS simbol,
           kg.nama_grup AS nama_grup, kg.bobot_grup AS bobot_grup
    FROM kpis k
    LEFT JOIN attribute ms ON ms.id = k.attributeId
    LEFT JOIN kpi_groups kg ON kg.id = k.group_id
  `;
  const baseParams = [];
  const conditions = [];
  
  if (periodeId) {
    conditions.push("k.PeriodeId = ?");
    baseParams.push(periodeId);
  }
  if (groupId) {
    conditions.push("k.group_id = ?");
    baseParams.push(groupId);
  }
  
  if (conditions.length > 0) {
    baseSql += " WHERE " + conditions.join(" AND ");
  }

  const { sql, params, countSql, countParams } = applyQueryMeta(baseSql, baseParams, options, ["k.NamaKpi", "k.Tipe"]);
  const [rows, totalRes] = await Promise.all([
    querySpk(sql, params),
    querySpk(countSql, countParams)
  ]);
  return { rows, total: totalRes[0]?.total || 0 };
}

async function getKpiMetadata(periodeId) {
  const rows = await querySpk(
    `SELECT k.Id, k.PeriodeId, k.NamaKpi, k.Deskripsi, k.Tipe, k.Target, k.IsActive, k.BobotAhp, k.attributeId, k.group_id,
            kg.bobot_grup AS bobot_grup
     FROM kpis k
     LEFT JOIN kpi_groups kg ON kg.id = k.group_id
     WHERE k.PeriodeId = ?`,
    [periodeId]
  );
  return rows;
}

async function getTargetByKpi(periodeId, kpiId) {
  const rows = await querySpk(
    `SELECT Id, Target, Tipe
     FROM kpis
     WHERE PeriodeId = ? AND Id = ?
     LIMIT 1`,
    [periodeId, kpiId]
  );
  return rows[0] || null;
}

async function getKpisByDivision(divisiId, periodeId, options = {}) {
  let baseSql =
    `SELECT k.Id, k.NamaKpi, k.Tipe, k.Target, k.IsActive, k.BobotAhp, k.PeriodeId, k.attributeId, k.group_id,
            ms.nama AS nama_satuan, ms.simbol AS simbol,
            kg.nama_grup AS nama_grup, kg.bobot_grup AS bobot_grup
     FROM kpis k
     JOIN periodes p ON p.Id = k.PeriodeId
     LEFT JOIN attribute ms ON ms.id = k.attributeId
     LEFT JOIN kpi_groups kg ON kg.id = k.group_id
     WHERE (p.DivisiId = ? OR p.DivisiId IS NULL)`;
  const baseParams = [divisiId];

  if (periodeId) {
    baseSql += " AND k.PeriodeId = ?";
    baseParams.push(periodeId);
  }

  const { sql, params, countSql, countParams } = applyQueryMeta(baseSql, baseParams, options, ["k.NamaKpi", "k.Tipe"]);
  const [rows, totalRes] = await Promise.all([
    querySpk(sql, params),
    querySpk(countSql, countParams)
  ]);
  return { rows, total: totalRes[0]?.total || 0 };
}

async function getAttributes(options = {}) {
  const baseSql = "SELECT id, nama, simbol FROM attribute";
  const { sql, params, countSql, countParams } = applyQueryMeta(baseSql, [], options, ["nama", "simbol"]);
  const [rows, totalRes] = await Promise.all([
    querySpk(sql, params),
    querySpk(countSql, countParams)
  ]);
  return { rows, total: totalRes[0]?.total || 0 };
}

async function createKpi(data) {
  const result = await querySpk(
    `INSERT INTO kpis(
  NamaKpi,
  Tipe,
  Target,
  IsActive,
  PeriodeId,
  BobotAhp,
  attributeId,
  group_id
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.NamaKpi,
      data.Tipe,
      data.Target || 0,
      data.IsActive === undefined ? 1 : Number(Boolean(data.IsActive)),
      data.PeriodeId,
      data.BobotAhp || 0,
      data.attributeId || null,
      data.group_id || null
    ]
  );
  return result.insertId;
}

async function updateKpi(id, data) {
  await querySpk(
    `UPDATE kpis
     SET NamaKpi = ?,
         Tipe = ?,
         Target = ?,
         IsActive = ?,
         PeriodeId = ?,
         attributeId = ?,
         BobotAhp = ?,
         group_id = ?
     WHERE Id = ?`,
    [
      data.NamaKpi,
      data.Tipe,
      data.Target ?? 0,
      data.IsActive === undefined ? 1 : Number(Boolean(data.IsActive)),
      data.PeriodeId,
      data.attributeId || null,
      data.BobotAhp || 0,
      data.group_id || null,
      id
    ]
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

async function replaceEvaluations(periodeId, evals) {
  const employeeIds = [...new Set(evals.map((x) => Number(x.KaryawanId)))];

  if (employeeIds.length > 0) {
    const placeholders = employeeIds.map(() => "?").join(",");
    await querySpk(
      `DELETE FROM penilaians 
       WHERE PeriodeId = ? 
       AND KaryawanId IN (${placeholders})`,
      [Number(periodeId), ...employeeIds]
    );
  }

  if (!evals.length) return;

  const valuesSql = evals.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(",");

  const params = evals.flatMap((ev) => [
    Number(ev.KaryawanId),
    Number(ev.KpiId),
    Number(ev.PeriodeId),
    Number(ev.Realisasi ?? ev.Nilai ?? 0),
    Number(ev.Achievement ?? 0),
    Number(ev.Nilai ?? ev.Realisasi ?? 0),
    Number(ev.created_by ?? 0)
  ]);

  await querySpk(
    `INSERT INTO penilaians
     (KaryawanId, KpiId, PeriodeId, Realisasi, Achievement, Nilai, created_by)
     VALUES ${valuesSql}`,
    params
  );
}

async function getEvaluationsByPeriode(periodeId, groupId = null) {
  try {
    let baseSql = `
      SELECT p.Id, p.KaryawanId, p.KpiId, p.PeriodeId, p.Realisasi, p.Achievement, p.Nilai, p.created_by
      FROM penilaians p
      INNER JOIN kpis k ON k.Id = p.KpiId
    `;
    const baseParams = [];
    const conditions = ["p.PeriodeId = ?"];
    baseParams.push(periodeId);
    
    if (groupId) {
      conditions.push("k.group_id = ?");
      baseParams.push(groupId);
    }
    
    baseSql += " WHERE " + conditions.join(" AND ");

    const rows = await querySpk(baseSql, baseParams);

    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.error("MOORA getEvaluationsByPeriode error:", err);
    return [];
  }
}

async function saveAchievement(periodeId, karyawanId, kpiId, achievement) {
  await querySpk(
    `UPDATE penilaians
     SET Achievement = ?
     WHERE PeriodeId = ? AND KaryawanId = ? AND KpiId = ?`,
    [achievement, periodeId, karyawanId, kpiId]
  );
}

async function clearHasilAkhir(periodeId) {
  await querySpk("DELETE FROM hasil_akhir WHERE PeriodeId = ?", [periodeId]);
}
async function bulkInsertPenilaian(data) {
  if (!data.length) return;

  const periodeId = Number(data[0].PeriodeId);
  const employeeIds = [...new Set(data.map((x) => Number(x.KaryawanId)))];

  if (employeeIds.length > 0) {
    const placeholders = employeeIds.map(() => "?").join(",");
    await querySpk(
      `DELETE FROM penilaians WHERE PeriodeId = ? AND KaryawanId IN (${placeholders})`,
      [periodeId, ...employeeIds]
    );
  }

  const values = data.map(d => [
    d.KaryawanId,
    d.KpiId,
    d.PeriodeId,
    d.Realisasi,
    d.Achievement,
    d.CreatedBy
  ]);

  return await querySpk(
    `INSERT INTO penilaians (KaryawanId, KpiId, PeriodeId, Realisasi, Achievement, created_by) VALUES ?`,
    [values]
  );
}
async function insertHasilAkhirBatch(rows) {
  if (!rows.length) return;
  const valuesSql = rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(",");
  const params = rows.flatMap((row) => [
    row.KaryawanId,
    row.PeriodeId,
    row.NilaiOptimasi,
    row.NilaiSkala,
    row.Ranking,
    row.created_by || null,
    row.status || "Draft",
    row.catatan || null
  ]);
  await querySpk(
    `INSERT INTO hasil_akhir(KaryawanId, PeriodeId, NilaiOptimasi, NilaiSkala, Ranking, created_by, status, catatan) VALUES ${valuesSql}`,
    params
  );
}

async function saveMooraSnapshot(periodeId, employeeId, snapshotJson) {
  await querySpk(
    `UPDATE hasil_akhir
     SET catatan = ?
     WHERE PeriodeId = ? AND KaryawanId = ?`,
    [snapshotJson, periodeId, employeeId]
  );
}

async function validateAssessmentCompleteness(periodeId) {
  const rows = await querySpk(
    `SELECT p.KaryawanId, COUNT(DISTINCT p.KpiId) AS kpi_count, COUNT(*) AS total_rows
     FROM penilaians p
     WHERE p.PeriodeId = ?
     GROUP BY p.KaryawanId`,
    [periodeId]
  );
  return rows;
}

async function getHasilAkhirByPeriode(periodeId, options = {}) {
  const baseSql = `SELECT h.Id, h.KaryawanId, h.PeriodeId, h.NilaiOptimasi, h.NilaiSkala, h.Ranking, h.created_by, h.approved_by, h.status, h.catatan
     FROM hasil_akhir h
     WHERE h.PeriodeId = ?`;
  
  const { sql, params, countSql, countParams } = applyQueryMeta(baseSql, [periodeId], options, ["status"]);
  const [rows, totalRes] = await Promise.all([
    querySpk(sql, params),
    querySpk(countSql, countParams)
  ]);
  return { rows, total: totalRes[0]?.total || 0 };
}

async function updateHasilAkhirStatus(id, { status, catatan, approved_by }) {
  const fields = [];
  const params = [];

  if (status !== undefined) {
    fields.push("status = ?");
    params.push(status);
  }
  if (catatan !== undefined) {
    // Handle both object and string for catatan
    const catatanValue = typeof catatan === "object" ? JSON.stringify(catatan) : catatan;
    fields.push("catatan = ?");
    params.push(catatanValue);
  }
  if (approved_by !== undefined) {
    fields.push("approved_by = ?");
    params.push(approved_by);
  }

  if (fields.length === 0) return;

  params.push(id);
  await querySpk(
    `UPDATE hasil_akhir SET ${fields.join(", ")} WHERE Id = ?`,
    params
  );
}

async function getEmployeesByIds(employeeIds) {
  if (!employeeIds.length) return [];
  const placeholders = employeeIds.map(() => "?").join(",");
  const rows = await queryMitra(
    `SELECT id, name, email, nik_ktp, departemen_id, lokasikerja
     FROM employees
     WHERE id IN (${placeholders})`,
    employeeIds
  );
  return rows.map((row) => ({
    ...row,
    nik: decryptLaravelNik(row.nik_ktp)
  }));
}

async function getDepartments(options = {}) {
  let table = "departments";
  try {
    // Check if departments table exists by running a quick select
    await queryMitra("SELECT 1 FROM departments LIMIT 1");
  } catch (_) {
    table = "departemens";
  }

  const baseSql = `SELECT id, name FROM ${table}`;
  const { sql, params, countSql, countParams } = applyQueryMeta(baseSql, [], options, ["name"]);

  const [rows, totalRes] = await Promise.all([
    queryMitra(sql, params),
    queryMitra(countSql, countParams)
  ]);
  return { rows, total: totalRes[0]?.total || 0 };
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

async function getEmployees({ deptId, lokasiKerja, ...options }) {
  let baseSql = `SELECT e.id, e.name, e.email, e.nik_ktp, e.departemen_id, e.lokasikerja,
                    d.name AS department_name, wl.id AS work_location_id,
                    wl.name AS work_location_name, u.id AS user_id, u.role
             FROM employees e
             LEFT JOIN users u ON u.email = e.email
             LEFT JOIN departemens d ON d.id = e.departemen_id
             LEFT JOIN work_locations wl ON wl.name = e.lokasikerja`;
  const baseParams = [];
  let hasWhere = false;
  if (deptId) {
    baseSql += " WHERE e.departemen_id = ?";
    baseParams.push(deptId);
    hasWhere = true;
  }
  if (lokasiKerja) {
    baseSql += hasWhere ? " AND e.lokasikerja = ?" : " WHERE e.lokasikerja = ?";
    baseParams.push(lokasiKerja);
  }

  const { sql, params, countSql, countParams } = applyQueryMeta(baseSql, baseParams, options, ["e.name", "e.email", "e.nik_ktp"]);
  const [rows, totalRes] = await Promise.all([
    queryMitra(sql, params),
    queryMitra(countSql, countParams)
  ]);

  return {
    rows: rows.map((row) => ({
      ...row,
      nik: decryptLaravelNik(row.nik_ktp)
    })),
    total: totalRes[0]?.total || 0
  };
}

async function getWorkLocations({ status, ...options }) {
  let baseSql = "SELECT id, name, status, berlaku, tanggalawal, tanggal_mulai FROM work_locations";
  const baseParams = [];
  if (status) {
    baseSql += " WHERE status = ?";
    baseParams.push(status);
  }

  const { sql, params, countSql, countParams } = applyQueryMeta(baseSql, baseParams, options, ["name"]);
  const [rows, totalRes] = await Promise.all([
    queryMitra(sql, params),
    queryMitra(countSql, countParams)
  ]);
  return { rows, total: totalRes[0]?.total || 0 };
}

async function getEmployeeByUserId(userId) {
  const rows = await queryMitra(
    `SELECT u.id AS user_id, u.role, e.id AS employee_id, e.name, e.email, e.lokasikerja
     FROM users u
     LEFT JOIN employees e ON e.email = u.email
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

async function getAuditLogs(options = {}) {
  const baseSql = `SELECT Id, UserId, Username, Action, EntityName, Details, IpAddress, UserAgent, CreatedAt
     FROM audit_logs`;
  const { sql, params, countSql, countParams } = applyQueryMeta(baseSql, [], options, ["Username", "Action", "EntityName"]);

  const [rows, totalRes] = await Promise.all([
    querySpk(sql, params),
    querySpk(countSql, countParams)
  ]);
  return {
    rows,
    total: Number(totalRes[0]?.total || 0)
  };
}

async function getDistinctKaryawanIdsByPeriode(periodeId) {
  const rows = await querySpk(
    "SELECT DISTINCT KaryawanId FROM penilaians WHERE PeriodeId = ? ORDER BY KaryawanId ASC",
    [periodeId]
  );
  return rows.map((r) => r.KaryawanId);
}

async function getPenilaianSummaryByPeriode(periodeId) {
  const rows = await querySpk(
    `SELECT KaryawanId, COUNT(DISTINCT KpiId) AS kpi_count
     FROM penilaians
     WHERE PeriodeId = ?
     GROUP BY KaryawanId`,
    [periodeId]
  );
  return rows;
}

async function getDistinctKpiIdsByPeriode(periodeId) {
  const rows = await querySpk(
    `SELECT DISTINCT KpiId
     FROM penilaians
     WHERE PeriodeId = ?
     ORDER BY KpiId ASC`,
    [periodeId]
  );
  return rows.map((r) => r.KpiId);
}

async function getEvaluationChunk(periodeId, employeeIds) {
  if (!employeeIds.length) return [];
  const placeholders = employeeIds.map(() => "?").join(",");
  return querySpk(
    `SELECT p.KaryawanId, p.KpiId, p.Realisasi, p.Achievement, p.Nilai,
            k.group_id, kg.nama_grup, kg.bobot_grup
     FROM penilaians p
     LEFT JOIN kpis k ON k.Id = p.KpiId
     LEFT JOIN kpi_groups kg ON kg.id = k.group_id
     WHERE p.PeriodeId = ? AND p.KaryawanId IN (${placeholders})`,
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
  getKpisByPeriode,
  createKpi,
  updateKpi,
  deleteKpi,
  getKpiMetadata,
  getTargetByKpi,
  getComparisons,
  replaceComparisons,
  updateKpiWeights,
  replaceEvaluations,
  bulkInsertPenilaian,
  getEvaluationsByPeriode,
  saveAchievement,
  clearHasilAkhir,
  insertHasilAkhirBatch,
  saveMooraSnapshot,
  getHasilAkhirByPeriode,
  getEmployeesByIds,
  getDepartments,
  getDepartmentById,
  getEmployees,
  getWorkLocations,
  getAttributes,
  getEmployeeByUserId,
  getEmployeeLocationsByIds,
  getDistinctKaryawanIdsByPeriode,
  getPenilaianSummaryByPeriode,
  getDistinctKpiIdsByPeriode,
  validateAssessmentCompleteness,
  getEvaluationChunk,
  getEvaluationsByPeriode,
  getAuditLogs,
  getKpiGroups,
  createKpiGroup,
  updateKpiGroup,
  deleteKpiGroup,
  getGroupComparisons,
  replaceGroupComparisons,
  updateGroupWeights,
  updateHasilAkhirStatus,
  queryMitra,
  querySpk
};
