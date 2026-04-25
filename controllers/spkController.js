const {
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
} = require("../models/spkModel");
const { querySpk } = require("../config/db");
const { calculateAHP, buildMooraCoeffMap, scoreMooraChunk } = require("../services/spkMath");
const {
  isAdminAdmViewOnlyRole,
  isEmployeeRole,
  isFullAccessRole,
  isDevRole,
  isManagementRoleForGrouping
} = require("../config/accessPolicy");
const crypto = require("crypto");

async function logActivity(req, action, entity, details) {
  await insertAuditLog({
    userId: Number(req.user?.sub || 0),
    username: req.user?.name || "System",
    action,
    entityName: entity,
    details,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] || null
  });
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getLaravelKey() {
  const rawKey = process.env.LARAVEL_APP_KEY_BASE64 || process.env.APP_KEY || "";
  const keyValue = rawKey.startsWith("base64:") ? rawKey.slice(7) : rawKey;
  if (!keyValue) return null;
  return Buffer.from(keyValue, "base64");
}

async function decryptNikValue(nik) {
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

function canOnlyViewOwnDivision(role) {
  return isAdminAdmViewOnlyRole(role);
}

function canOnlyViewSelfEmployee(role) {
  return isEmployeeRole(role);
}

function classifyRoleGroup(role) {
  return isManagementRoleForGrouping(role) ? "management" : "staff";
}

function canAccessPeriodeForUser(user, periode) {
  if (!periode) return false;
  const role = user?.role;
  if (isFullAccessRole(role) || isDevRole(role)) return true;

  if (canOnlyViewOwnDivision(role) || canOnlyViewSelfEmployee(role)) {
    return Number(user?.dept_id || 0) === Number(periode.DivisiId || 0);
  }

  return true;
}

async function getPeriodeHandler(req, res) {
  const role = req.user?.role;
  let periodes = [];

  if (canOnlyViewOwnDivision(role) || canOnlyViewSelfEmployee(role)) {
    const deptId = Number(req.user?.dept_id || 0);
    periodes = deptId ? await getPeriodesByDivision(deptId) : [];
  } else {
    periodes = await getPeriodes();
  }

  return res.json(
    periodes.map((p) => ({
      Id: p.Id,
      NamaPeriode: p.NamaPeriode,
      TanggalMulai: toIso(p.TanggalMulai),
      TanggalSelesai: toIso(p.TanggalSelesai),
      Status: p.Status
    }))
  );
}

async function createPeriodeHandler(req, res) {
  if (canOnlyViewOwnDivision(req.user?.role) || canOnlyViewSelfEmployee(req.user?.role)) {
    return res.status(403).json({ success: false, message: "Role hanya memiliki akses view periode" });
  }

  const data = req.body || {};

  if (req.user?.role === "Kadiv") {
    data.DivisiId = Number(req.user?.dept_id || 0) || data.DivisiId;
  }

  const insertId = await createPeriode(data);
  await logActivity(req, "CREATE", "Periode", { Id: insertId, Nama: data.NamaPeriode });
  return res.json({ success: true, Id: insertId });
}

async function updatePeriodeHandler(req, res) {
  const periodeId = Number(req.params.id);
  const existing = await getPeriodeById(periodeId);
  if (!existing) {
    return res.status(404).json({ success: false, message: "Periode tidak ditemukan" });
  }

  if (!canAccessPeriodeForUser(req.user, existing)) {
    return res.status(403).json({ success: false, message: "Tidak boleh mengubah periode lintas divisi" });
  }

  const payload = { ...req.body };
  if (req.user?.role === "Kadiv") {
    payload.DivisiId = Number(req.user?.dept_id || 0) || existing.DivisiId;
  }

  await updatePeriode(periodeId, {
    NamaPeriode: payload.NamaPeriode || existing.NamaPeriode,
    Tahun: payload.Tahun ?? existing.Tahun,
    DivisiId: payload.DivisiId ?? existing.DivisiId,
    TanggalMulai: payload.TanggalMulai || existing.TanggalMulai,
    TanggalSelesai: payload.TanggalSelesai || existing.TanggalSelesai,
    Status: payload.Status || existing.Status
  });

  await logActivity(req, "UPDATE", "Periode", { Id: periodeId });
  return res.json({ success: true, message: "Periode berhasil diperbarui" });
}

async function deletePeriodeHandler(req, res) {
  const periodeId = Number(req.params.id);
  const existing = await getPeriodeById(periodeId);
  if (!existing) {
    return res.status(404).json({ success: false, message: "Periode tidak ditemukan" });
  }

  if (!canAccessPeriodeForUser(req.user, existing)) {
    return res.status(403).json({ success: false, message: "Tidak boleh menghapus periode lintas divisi" });
  }

  await deletePeriode(periodeId);
  await logActivity(req, "DELETE", "Periode", { Id: periodeId });
  return res.json({ success: true, message: "Periode berhasil dihapus" });
}

async function getKpiHandler(req, res) {
  const periodeId = req.query.periode_id;
  let rows = [];

  if (canOnlyViewOwnDivision(req.user?.role) || canOnlyViewSelfEmployee(req.user?.role)) {
    const deptId = Number(req.user?.dept_id || 0);
    rows = deptId ? await getKpisByDivision(deptId, periodeId || null) : [];
  } else {
    rows = await getKpis(periodeId);
  }

  return res.json(
    rows.map((k) => ({
      Id: k.Id,
      NamaKpi: k.NamaKpi,
      Tipe: k.Tipe,
      BobotAhp: k.BobotAhp,
      PeriodeId: k.PeriodeId
    }))
  );
}

async function createKpiHandler(req, res) {
  if (canOnlyViewOwnDivision(req.user?.role) || canOnlyViewSelfEmployee(req.user?.role)) {
    return res.status(403).json({ success: false, message: "Role hanya memiliki akses view KPI" });
  }

  const data = req.body || {};
  if (req.user?.role === "Kadiv") {
    const periode = await getPeriodeById(Number(data.PeriodeId || 0));
    if (!canAccessPeriodeForUser(req.user, periode)) {
      return res.status(403).json({ success: false, message: "Kadiv hanya boleh membuat KPI untuk divisinya" });
    }
  }

  const insertId = await createKpi(data);
  await logActivity(req, "CREATE", "Criterion", { Id: insertId, Nama: data.NamaKpi });
  return res.json({ success: true, Id: insertId });
}

async function updateKpiHandler(req, res) {
  const kpiId = Number(req.params.id);
  const existingRows = await querySpk("SELECT Id, NamaKpi, Tipe, PeriodeId, BobotAhp FROM kpis WHERE Id = ? LIMIT 1", [kpiId]);
  const existing = existingRows[0] || null;
  if (!existing) {
    return res.status(404).json({ success: false, message: "KPI tidak ditemukan" });
  }

  const existingPeriode = await getPeriodeById(Number(existing.PeriodeId));
  if (!canAccessPeriodeForUser(req.user, existingPeriode)) {
    return res.status(403).json({ success: false, message: "Tidak boleh mengubah KPI lintas divisi" });
  }

  const payload = req.body || {};
  const targetPeriodeId = Number(payload.PeriodeId || existing.PeriodeId);
  const targetPeriode = await getPeriodeById(targetPeriodeId);
  if (!canAccessPeriodeForUser(req.user, targetPeriode)) {
    return res.status(403).json({ success: false, message: "Tidak boleh memindahkan KPI ke periode lintas divisi" });
  }

  await updateKpi(kpiId, {
    NamaKpi: payload.NamaKpi || existing.NamaKpi,
    Tipe: payload.Tipe || existing.Tipe,
    PeriodeId: targetPeriodeId,
    BobotAhp: payload.BobotAhp ?? existing.BobotAhp
  });

  await logActivity(req, "UPDATE", "Criterion", { Id: kpiId });
  return res.json({ success: true, message: "KPI berhasil diperbarui" });
}

async function deleteKpiHandler(req, res) {
  const kpiId = Number(req.params.id);
  const existingRows = await querySpk("SELECT Id, PeriodeId FROM kpis WHERE Id = ? LIMIT 1", [kpiId]);
  const existing = existingRows[0] || null;
  if (!existing) {
    return res.status(404).json({ success: false, message: "KPI tidak ditemukan" });
  }

  const existingPeriode = await getPeriodeById(Number(existing.PeriodeId));
  if (!canAccessPeriodeForUser(req.user, existingPeriode)) {
    return res.status(403).json({ success: false, message: "Tidak boleh menghapus KPI lintas divisi" });
  }

  await deleteKpi(kpiId);
  await logActivity(req, "DELETE", "Criterion", { Id: kpiId });
  return res.json({ success: true, message: "KPI berhasil dihapus" });
}

async function getComparisonsHandler(req, res) {
  const periodeId = Number(req.params.periode_id);
  const periode = await getPeriodeById(periodeId);
  if (!canAccessPeriodeForUser(req.user, periode)) {
    return res.status(403).json({ success: false, message: "Tidak boleh mengakses perbandingan lintas divisi" });
  }

  const data = await getComparisons(periodeId);
  const results = data.map((c) => ({
    Id: c.Id,
    PeriodeId: c.PeriodeId,
    KpiAId: c.KpiAId,
    KpiA: c.KpiAName ? { Id: c.KpiAId, NamaKpi: c.KpiAName } : null,
    KpiBId: c.KpiBId,
    KpiB: c.KpiBName ? { Id: c.KpiBId, NamaKpi: c.KpiBName } : null,
    Nilai: c.Nilai
  }));

  await logActivity(req, "VIEW", "AhpComparison", { periodeId: periodeId, count: results.length });
  return res.json({ success: true, data: results });
}

async function inputComparisonHandler(req, res) {
  const dataList = req.body;
  if (!Array.isArray(dataList) || dataList.length === 0) {
    return res.status(400).json({ success: false, message: "Data tidak valid atau kosong" });
  }

  const periodeId = dataList[0].PeriodeId;
  if (!periodeId) {
    return res.status(400).json({ success: false, message: "PeriodeId diperlukan" });
  }

  const periode = await getPeriodeById(Number(periodeId));
  if (!canAccessPeriodeForUser(req.user, periode)) {
    return res.status(403).json({ success: false, message: "Tidak boleh input perbandingan lintas divisi" });
  }

  await replaceComparisons(periodeId, dataList);
  await logActivity(req, "CREATE/UPDATE", "AhpComparison", { PeriodeId: periodeId, Count: dataList.length });
  return res.json({ success: true, message: "Matriks perbandingan AHP berhasil disimpan" });
}

async function calculateWeightsHandler(req, res) {
  const periodeId = Number(req.params.periode_id);
  const periode = await getPeriodeById(periodeId);
  if (!canAccessPeriodeForUser(req.user, periode)) {
    return res.status(403).json({ success: false, message: "Tidak boleh menghitung bobot lintas divisi" });
  }

  const kpis = await getKpis(periodeId);
  const comps = await getComparisons(periodeId);

  if (kpis.length === 0) {
    return res.status(400).json({ success: false, message: "KPI tidak ditemukan" });
  }

  const ahp = calculateAHP(kpis, comps);
  const weightByKpiId = {};
  kpis.forEach((kpi, idx) => {
    weightByKpiId[kpi.Id] = Number(ahp.weights[idx]);
  });

  await updateKpiWeights(periodeId, weightByKpiId);
  await logActivity(req, "CALCULATE", "AhpWeights", {
    PeriodeId: periodeId,
    Weights: ahp.weights,
    Consistency: ahp.consistency
  });

  return res.json({ success: true, data: ahp.weights, consistency: ahp.consistency });
}

async function inputPenilaianHandler(req, res) {
  const evals = req.body;
  if (!Array.isArray(evals) || evals.length === 0) {
    return res.status(400).json({ success: false, message: "Data tidak boleh kosong" });
  }

  const periodeId = evals[0].PeriodeId;

  const periode = await getPeriodeById(Number(periodeId));
  if (!canAccessPeriodeForUser(req.user, periode)) {
    return res.status(403).json({ success: false, message: "Tidak boleh input penilaian lintas divisi" });
  }

  if (req.user?.role === "Kadiv") {
    const uniqueEmployeeIds = [...new Set(evals.map((item) => Number(item.KaryawanId)).filter(Boolean))];
    const targetEmployees = await getEmployeeLocationsByIds(uniqueEmployeeIds);
    const blocked = targetEmployees
      .filter((emp) => String(emp.role || "").toLowerCase() === "manager")
      .map((emp) => Number(emp.id));

    if (blocked.length > 0) {
      return res.status(403).json({
        success: false,
        message: "Kadiv tidak boleh menilai role di atasnya (Manager)",
        blocked_karyawan_ids: blocked
      });
    }
  }

  await replaceEvaluations(periodeId, evals);
  await logActivity(req, "CREATE/UPDATE", "MooraPenilaian", { PeriodeId: periodeId, Count: evals.length });
  return res.json({ success: true, message: "Data penilaian MOORA berhasil disimpan" });
}

function chunkArray(items, chunkSize) {
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

async function calculateMooraHandler(req, res) {
  const periodeId = Number(req.params.periode_id);
  const periode = await getPeriodeById(periodeId);
  if (!canAccessPeriodeForUser(req.user, periode)) {
    return res.status(403).json({ success: false, message: "Tidak boleh menghitung ranking lintas divisi" });
  }

  const kpis = await getKpis(periodeId);
  const employeeIds = await getDistinctKaryawanIdsByPeriode(periodeId);

  if (kpis.length === 0 || employeeIds.length === 0) {
    return res.status(400).json({ success: false, message: "Data tidak mencukupi" });
  }

  const denominatorRows = await querySpk(
    `SELECT KpiId, SQRT(SUM(Nilai * Nilai)) AS denominator
     FROM penilaians
     WHERE PeriodeId = ?
     GROUP BY KpiId`,
    [periodeId]
  );

  const denominatorMap = {};
  denominatorRows.forEach((row) => {
    denominatorMap[row.KpiId] = Number(row.denominator) || 1;
  });

  const coeffMap = buildMooraCoeffMap(kpis, denominatorMap);
  const yiMap = {};

  const chunks = chunkArray(employeeIds, Number(process.env.MOORA_BATCH_SIZE || 500));
  for (const employeeChunk of chunks) {
    const evaluations = await getEvaluationChunk(periodeId, employeeChunk);
    const partial = scoreMooraChunk(evaluations, coeffMap);
    for (const [employeeId, yi] of Object.entries(partial)) {
      yiMap[employeeId] = (yiMap[employeeId] || 0) + yi;
    }
  }

  const ranked = Object.entries(yiMap)
    .map(([employeeId, yi]) => ({ employeeId: Number(employeeId), yi: Number(yi) }))
    .sort((a, b) => b.yi - a.yi);

  await clearHasilAkhir(periodeId);

  const resultRows = ranked.map((row, index) => ({
    KaryawanId: row.employeeId,
    PeriodeId: periodeId,
    NilaiOptimasi: row.yi,
    NilaiSkala: Math.round(row.yi * 10000) / 100,
    Ranking: index + 1
  }));

  const insertChunks = chunkArray(resultRows, Number(process.env.INSERT_BATCH_SIZE || 500));
  for (const resultChunk of insertChunks) {
    await insertHasilAkhirBatch(resultChunk);
  }

  await logActivity(req, "CALCULATE", "MooraResult", { PeriodeId: periodeId, Count: resultRows.length });
  return res.json({ success: true, message: "Perangkingan MOORA selesai" });
}

async function getMooraResultHandler(req, res) {
  const periodeId = Number(req.params.periode_id);
  const periode = await getPeriodeById(periodeId);
  if (!canAccessPeriodeForUser(req.user, periode)) {
    return res.status(403).json({ success: false, message: "Tidak boleh melihat hasil lintas divisi" });
  }

  const rows = await getHasilAkhirByPeriode(periodeId);
  const employeeIds = [...new Set(rows.map((row) => row.KaryawanId))];
  const employees = await getEmployeesByIds(employeeIds);
  const employeeMap = new Map(employees.map((emp) => [Number(emp.id), emp]));

  let data = await Promise.all(rows.map(async (row) => {
    const employee = employeeMap.get(Number(row.KaryawanId));
    const decryptedNik = employee ? await decryptNikValue(employee.nik) : null;
    return {
      Id: row.Id,
      KaryawanId: row.KaryawanId,
      PeriodeId: row.PeriodeId,
      NilaiOptimasi: row.NilaiOptimasi,
      NilaiSkala: row.NilaiSkala,
      Ranking: row.Ranking,
      Karyawan: employee
        ? {
            id: employee.id,
            name: employee.name,
            email: employee.email,
            nik: decryptedNik,
            departemen_id: employee.departemen_id,
            lokasi_kerja: employee.lokasikerja || null
          }
        : null
    };
  }));

  if (canOnlyViewOwnDivision(req.user?.role) || canOnlyViewSelfEmployee(req.user?.role)) {
    const deptId = Number(req.user?.dept_id || 0);
    data = data.filter((row) => Number(row.Karyawan?.departemen_id || 0) === deptId);
  }

  if (req.query.lokasi_kerja) {
    const lokasiKerja = String(req.query.lokasi_kerja);
    data = data.filter((row) => String(row.Karyawan?.lokasi_kerja || "") === lokasiKerja);
  }

  await logActivity(req, "VIEW", "MooraResult", { PeriodeId: periodeId, Count: data.length });
  return res.json({ success: true, data });
}

async function getDepartmentsHandler(req, res) {
  let rows = await getDepartments();

  if (canOnlyViewOwnDivision(req.user?.role) || canOnlyViewSelfEmployee(req.user?.role)) {
    const deptId = Number(req.user?.dept_id || 0);
    const ownDept = deptId ? await getDepartmentById(deptId) : null;
    rows = ownDept ? [ownDept] : [];
  }

  return res.json(rows.map((d) => ({ id: d.id, name: d.name })));
}

async function getEmployeesHandler(req, res) {
  const rows = await getEmployees({
    deptId: req.query.dept_id || null,
    lokasiKerja: req.query.lokasi_kerja || null
  });

  let filteredRows = [...rows];
  if (canOnlyViewOwnDivision(req.user?.role)) {
    const deptId = Number(req.user?.dept_id || 0);
    filteredRows = filteredRows.filter((u) => Number(u.departemen_id || 0) === deptId);
  }

  if (canOnlyViewSelfEmployee(req.user?.role)) {
    const actor = await getEmployeeByUserId(Number(req.user?.sub || 0));
    const actorEmployeeId = Number(actor?.employee_id || req.user?.employee_id || 0);
    filteredRows = filteredRows.filter((u) => Number(u.id) === actorEmployeeId);
  }

  const includeManagementRoles = String(req.query.include_management_roles || "false").toLowerCase() === "true";
  if (!includeManagementRoles) {
    filteredRows = filteredRows.filter((u) => classifyRoleGroup(u.role) !== "management");
  }

  if (req.query.role_group) {
    const roleGroup = String(req.query.role_group).toLowerCase();
    filteredRows = filteredRows.filter((u) => classifyRoleGroup(u.role) === roleGroup);
  }

  const mapped = await Promise.all(
    filteredRows.map(async (u) => ({
      id: u.id,
      name: u.name,
      nik: await decryptNikValue(u.nik),
      email: u.email,
      departemen_id: u.departemen_id,
      department_name: u.department_name,
      lokasi_kerja: u.lokasikerja || null,
      work_location_id: u.work_location_id || null,
      work_location_name: u.work_location_name || null,
      user_id: u.user_id,
      role: u.role,
      role_group: classifyRoleGroup(u.role)
    }))
  );

  return res.json(mapped);
}

async function getWorkLocationsHandler(req, res) {
  const rows = await getWorkLocations({ status: req.query.status || null });
  return res.json(
    rows.map((w) => ({
      id: w.id,
      name: w.name,
      status: w.status,
      berlaku: toIso(w.berlaku),
      tanggalawal: toIso(w.tanggalawal),
      tanggal_mulai: toIso(w.tanggal_mulai)
    }))
  );
}

async function getAuditLogsHandler(req, res) {
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
  const page = Math.max(Number(req.query.page || 1), 1);
  const offset = (page - 1) * limit;

  const result = await getAuditLogs({ limit, offset });
  return res.json({
    success: true,
    page,
    limit,
    total: result.total,
    data: result.rows.map((row) => ({
      Id: row.Id,
      UserId: row.UserId,
      Username: row.Username,
      Action: row.Action,
      EntityName: row.EntityName,
      Details: row.Details,
      IpAddress: row.IpAddress,
      UserAgent: row.UserAgent,
      CreatedAt: toIso(row.CreatedAt)
    }))
  });
}

module.exports = {
  getPeriodeHandler,
  createPeriodeHandler,
  updatePeriodeHandler,
  deletePeriodeHandler,
  getKpiHandler,
  createKpiHandler,
  updateKpiHandler,
  deleteKpiHandler,
  getComparisonsHandler,
  inputComparisonHandler,
  calculateWeightsHandler,
  inputPenilaianHandler,
  calculateMooraHandler,
  getMooraResultHandler,
  getDepartmentsHandler,
  getEmployeesHandler,
  getWorkLocationsHandler,
  getAuditLogsHandler
};
