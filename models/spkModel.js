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

async function insertAuditLog({ userId, email, name, action, entityName, details, ipAddress, userAgent, url, method, lastLogin }) {
  await querySpk(
    `INSERT INTO audit_logs(Userid, Email, Name, Action, EntityName, Details, IpAddress, UserAgent, url, method, last_login)
     VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [userId || 0, email || "-", name || "-", action, entityName, JSON.stringify(details || {}), ipAddress || null, userAgent || null, url || null, method || null, lastLogin || null]
  );
}

async function updateLastLogin(userId, email) {
  await querySpk(
    `UPDATE audit_logs SET last_login = NOW() WHERE UserId = $1 AND Action = 'LOGIN' ORDER BY Id DESC LIMIT 1`,
    [userId]
  );
}

async function getLastLoginByEmail(email) {
  const rows = await querySpk(
    `SELECT last_login FROM audit_logs WHERE Email = $1 AND Action = 'LOGIN' ORDER BY Id DESC LIMIT 1`,
    [email]
  );
  return rows[0]?.last_login || null;
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
     WHERE DivisiId = $1 OR DivisiId IS NULL`;
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
     WHERE Id = $1
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}
async function getKpisByPeriode(periodeId) {
  return await querySpk(
    `SELECT Id, Target, Tipe
     FROM kpis
     WHERE PeriodeId = $1 AND IsActive = 1`,
    [periodeId]
  );
}
async function createPeriode(data) {
  const result = await querySpk(
    `INSERT INTO periodes(NamaPeriode, Tahun, DivisiId, TanggalMulai, TanggalSelesai, Status)
     VALUES($1, $2, $3, $4, $5, $6) RETURNING Id`,
    [
      data.NamaPeriode,
      data.Tahun ?? null,
      data.DivisiId ?? null,
      data.TanggalMulai,
      data.TanggalSelesai,
      data.Status ?? "Draft"
    ]
  );
  return result[0]?.Id;
}

async function updatePeriode(id, data) {
  await querySpk(
    `UPDATE periodes
     SET NamaPeriode = $1,
         Tahun = $2,
         DivisiId = $3,
         TanggalMulai = $4,
         TanggalSelesai = $5,
         Status = $6
     WHERE Id = $7`,
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
  await querySpk("DELETE FROM periodes WHERE Id = $1", [id]);
}

// KPI Groups
async function getKpiGroups(periodeId, options = {}) {
  let baseSql = "SELECT id, nama_grup, periode_id, bobot_grup FROM kpi_groups";
  const baseParams = [];
  if (periodeId) {
    baseSql += " WHERE periode_id = $1";
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
    "INSERT INTO kpi_groups (nama_grup, periode_id, bobot_grup) VALUES ($1, $2, $3) RETURNING id",
    [data.nama_grup, data.periode_id, data.bobot_grup || 0]
  );
  return result[0]?.id;
}

async function updateKpiGroup(id, data) {
  await querySpk(
    "UPDATE kpi_groups SET nama_grup = $1, bobot_grup = $2 WHERE id = $3",
    [data.nama_grup, data.bobot_grup || 0, id]
  );
}

async function deleteKpiGroup(id) {
  await querySpk("DELETE FROM kpi_groups WHERE id = $1", [id]);
}

async function getGroupComparisons(periodeId) {
  return querySpk(
    `SELECT gc.id, gc.periode_id, gc.group_a_id, gc.group_b_id, gc.nilai,
            ga.nama_grup AS group_a_name, gb.nama_grup AS group_b_name
     FROM kpi_group_comparisons gc
     LEFT JOIN kpi_groups ga ON ga.id = gc.group_a_id
     LEFT JOIN kpi_groups gb ON gb.id = gc.group_b_id
     WHERE gc.periode_id = $1
     ORDER BY gc.id ASC`,
    [periodeId]
  );
}

async function replaceGroupComparisons(periodeId, items) {
  await querySpk("DELETE FROM kpi_group_comparisons WHERE periode_id = $1", [periodeId]);
  if (!items.length) return;

  const valuesSql = items.map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`).join(",");
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
    querySpk("UPDATE kpi_groups SET bobot_grup = $1 WHERE id = $2 AND periode_id = $3", [bobot, Number(groupId), periodeId])
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
  let paramIndex = 1;
  
  if (periodeId) {
    conditions.push(`k.PeriodeId = $${paramIndex++}`);
    baseParams.push(periodeId);
  }
  if (groupId) {
    conditions.push(`k.group_id = $${paramIndex++}`);
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
     WHERE k.PeriodeId = $1`,
    [periodeId]
  );
  return rows;
}

async function getTargetByKpi(periodeId, kpiId) {
  const rows = await querySpk(
    `SELECT Id, Target, Tipe
     FROM kpis
     WHERE PeriodeId = $1 AND Id = $2
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
     WHERE (p.DivisiId = $1 OR p.DivisiId IS NULL)`;
  const baseParams = [divisiId];
  let paramIndex = 2;

  if (periodeId) {
    baseSql += ` AND k.PeriodeId = $${paramIndex++}`;
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
VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING Id`,
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
  return result[0]?.Id;
}

async function updateKpi(id, data) {
  await querySpk(
    `UPDATE kpis
     SET NamaKpi = $1,
         Tipe = $2,
         Target = $3,
         IsActive = $4,
         PeriodeId = $5,
         attributeId = $6,
         BobotAhp = $7,
         group_id = $8
     WHERE Id = $9`,
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
  await querySpk("DELETE FROM kpis WHERE Id = $1", [id]);
}

async function getComparisons(periodeId) {
  return querySpk(
    `SELECT ac.Id, ac.PeriodeId, ac.KpiAId, ac.KpiBId, ac.Nilai,
            ka.NamaKpi AS KpiAName, kb.NamaKpi AS KpiBName
     FROM ahp_comparisons ac
     LEFT JOIN kpis ka ON ka.Id = ac.KpiAId
     LEFT JOIN kpis kb ON kb.Id = ac.KpiBId
     WHERE ac.PeriodeId = $1
     ORDER BY ac.Id ASC`,
    [periodeId]
  );
}

async function replaceComparisons(periodeId, items) {
  await querySpk("DELETE FROM ahp_comparisons WHERE PeriodeId = $1", [periodeId]);
  if (!items.length) return;

  const valuesSql = items.map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`).join(",");
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
    querySpk("UPDATE kpis SET BobotAhp = $1 WHERE Id = $2 AND PeriodeId = $3", [bobot, Number(kpiId), periodeId])
  );
  await Promise.all(promises);
}

async function replaceEvaluations(periodeId, evals) {
  const employeeIds = [...new Set(evals.map((x) => Number(x.KaryawanId)))];

  if (employeeIds.length > 0) {
    const placeholders = employeeIds.map((_, i) => `$${i + 2}`).join(",");
    await querySpk(
      `DELETE FROM penilaians 
       WHERE PeriodeId = $1 
       AND KaryawanId IN (${placeholders})`,
      [Number(periodeId), ...employeeIds]
    );
  }

  if (!evals.length) return;

  const valuesSql = evals.map((_, i) => {
    const base = i * 7;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
  }).join(",");

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
    const conditions = ["p.PeriodeId = $1"];
    let paramIndex = 2;
    baseParams.push(periodeId);
    
    if (groupId) {
      conditions.push(`k.group_id = $${paramIndex++}`);
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
     SET Achievement = $1
     WHERE PeriodeId = $2 AND KaryawanId = $3 AND KpiId = $4`,
    [achievement, periodeId, karyawanId, kpiId]
  );
}

async function clearHasilAkhir(periodeId) {
  await querySpk("DELETE FROM hasil_akhir WHERE PeriodeId = $1", [periodeId]);
}
async function bulkInsertPenilaian(data) {
  if (!data.length) return;

  const periodeId = Number(data[0].PeriodeId);
  const employeeIds = [...new Set(data.map((x) => Number(x.KaryawanId)))];

  if (employeeIds.length > 0) {
    const placeholders = employeeIds.map((_, i) => `$${i + 2}`).join(",");
    await querySpk(
      `DELETE FROM penilaians WHERE PeriodeId = $1 AND KaryawanId IN (${placeholders})`,
      [periodeId, ...employeeIds]
    );
  }

  const valuesSql = data.map((_, i) => {
    const base = i * 6;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
  }).join(",");

  const params = data.flatMap(d => [
    d.KaryawanId,
    d.KpiId,
    d.PeriodeId,
    d.Realisasi,
    d.Achievement,
    d.CreatedBy
  ]);

  return await querySpk(
    `INSERT INTO penilaians (KaryawanId, KpiId, PeriodeId, Realisasi, Achievement, created_by) VALUES ${valuesSql}`,
    params
  );
}
async function insertHasilAkhirBatch(rows) {
  if (!rows.length) return;
  const valuesSql = rows.map((_, i) => {
    const base = i * 8;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
  }).join(",");
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
     SET catatan = $1
     WHERE PeriodeId = $2 AND KaryawanId = $3`,
    [snapshotJson, periodeId, employeeId]
  );
}

async function validateAssessmentCompleteness(periodeId) {
  const rows = await querySpk(
    `SELECT p.KaryawanId, COUNT(DISTINCT p.KpiId) AS kpi_count, COUNT(*) AS total_rows
     FROM penilaians p
     WHERE p.PeriodeId = $1
     GROUP BY p.KaryawanId`,
    [periodeId]
  );
  return rows;
}

async function getHasilAkhirByPeriode(periodeId, options = {}, employeeIds = null) {
  let baseSql = `SELECT h.Id, h.KaryawanId, h.PeriodeId, h.NilaiOptimasi, h.NilaiSkala, h.Ranking, h.created_by, h.approved_by, h.status, h.catatan
     FROM hasil_akhir h
     WHERE h.PeriodeId = $1`;
  const baseParams = [periodeId];
  let paramIndex = 2;

  if (employeeIds !== null) {
    if (employeeIds.length === 0) {
      // No matching employees - return empty result
      return { rows: [], total: 0 };
    }
    const placeholders = employeeIds.map((_, i) => `$${paramIndex + i}`).join(",");
    paramIndex += employeeIds.length;
    baseSql += ` AND h.KaryawanId IN (${placeholders})`;
    baseParams.push(...employeeIds);
  }

  const normalizedOptions = { ...options };
  if (!String(normalizedOptions.sort || "").trim()) {
    normalizedOptions.sort = "h.Ranking:asc,h.Id:asc";
  }

  const { sql, params, countSql, countParams } = applyQueryMeta(baseSql, baseParams, normalizedOptions, ["status"]);
  const [rows, totalRes] = await Promise.all([
    querySpk(sql, params),
    querySpk(countSql, countParams)
  ]);
  return { rows, total: totalRes[0]?.total || 0 };
}

async function updateHasilAkhirStatus(id, { status, catatan, approved_by }) {
  const fields = [];
  const params = [];
  let paramIndex = 1;

  if (status !== undefined) {
    fields.push(`status = $${paramIndex++}`);
    params.push(status);
  }
  if (catatan !== undefined) {
    // Handle both object and string for catatan
    const catatanValue = typeof catatan === "object" ? JSON.stringify(catatan) : catatan;
    fields.push(`catatan = $${paramIndex++}`);
    params.push(catatanValue);
  }
  if (approved_by !== undefined) {
    fields.push(`approved_by = $${paramIndex++}`);
    params.push(approved_by);
  }

  if (fields.length === 0) return;

  params.push(id);
  await querySpk(
    `UPDATE hasil_akhir SET ${fields.join(", ")} WHERE Id = $${paramIndex}`,
    params
  );
}

async function getEmployeesByIds(employeeIds) {
  if (!employeeIds.length) return [];
  const placeholders = employeeIds.map((_, i) => `$${i + 1}`).join(",");
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
    const rows = await queryMitra("SELECT id, name FROM departments WHERE id = $1 LIMIT 1", [id]);
    return rows[0] || null;
  } catch (_) {
    const rows = await queryMitra("SELECT id, name FROM departemens WHERE id = $1 LIMIT 1", [id]);
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
  let paramIndex = 1;
  if (deptId) {
    baseSql += ` WHERE e.departemen_id = $${paramIndex++}`;
    baseParams.push(deptId);
    hasWhere = true;
  }
  if (lokasiKerja) {
    baseSql += hasWhere ? ` AND e.lokasikerja = $${paramIndex++}` : ` WHERE e.lokasikerja = $${paramIndex++}`;
    baseParams.push(lokasiKerja);
  }

  const { sql, params, countSql, countParams } = applyQueryMeta(baseSql, baseParams, options, ["e.name", "e.email"]);
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
  let paramIndex = 1;
  if (status) {
    baseSql += ` WHERE status = $${paramIndex++}`;
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
     WHERE u.id = $1
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function getEmployeeLocationsByIds(employeeIds) {
  if (!employeeIds.length) return [];
  const placeholders = employeeIds.map((_, i) => `$${i + 1}`).join(",");
  return queryMitra(
    `SELECT e.id, e.lokasikerja, u.role
     FROM employees e
     LEFT JOIN users u ON u.email = e.email
     WHERE e.id IN (${placeholders})`,
    employeeIds
  );
}

async function getAuditLogs(options = {}) {
  const baseSql = `SELECT Id, UserId, Email, Name, Action, EntityName, Details, IpAddress, UserAgent, CreatedAt, url, method, last_login
     FROM audit_logs`;
  // Default sort: CreatedAt DESC (terbaru di atas) jika user tidak specify sort
  const opts = { sort: "CreatedAt:desc", ...options };
  const { sql, params, countSql, countParams } = applyQueryMeta(baseSql, [], opts, ["Email", "Action", "EntityName"]);

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
    "SELECT DISTINCT KaryawanId FROM penilaians WHERE PeriodeId = $1 ORDER BY KaryawanId ASC",
    [periodeId]
  );
  return rows.map((r) => r.KaryawanId);
}

async function getPenilaianSummaryByPeriode(periodeId) {
  const rows = await querySpk(
    `SELECT KaryawanId, COUNT(DISTINCT KpiId) AS kpi_count
     FROM penilaians
     WHERE PeriodeId = $1
     GROUP BY KaryawanId`,
    [periodeId]
  );
  return rows;
}

async function getDistinctKpiIdsByPeriode(periodeId) {
  const rows = await querySpk(
    `SELECT DISTINCT KpiId
     FROM penilaians
     WHERE PeriodeId = $1
     ORDER BY KpiId ASC`,
    [periodeId]
  );
  return rows.map((r) => r.KpiId);
}

async function getEvaluationChunk(periodeId, employeeIds) {
  if (!employeeIds.length) return [];
  const placeholders = employeeIds.map((_, i) => `$${i + 2}`).join(",");
  return querySpk(
    `SELECT p.KaryawanId, p.KpiId, p.Realisasi, p.Achievement, p.Nilai,
            k.group_id, kg.nama_grup, kg.bobot_grup
     FROM penilaians p
     LEFT JOIN kpis k ON k.Id = p.KpiId
     LEFT JOIN kpi_groups kg ON kg.id = k.group_id
     WHERE p.PeriodeId = $1 AND p.KaryawanId IN (${placeholders})`,
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
  getLastLoginByEmail,
  updateLastLogin,
  queryMitra,
  querySpk
};
