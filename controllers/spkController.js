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
  updateHasilAkhirApproval,
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
  getEvaluationsByPeriode,
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
const ExcelJS = require("exceljs");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");

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
    // If periode.DivisiId is null, it means it's for all divisions
    if (periode.DivisiId === null) return true;
    return Number(user?.dept_id || 0) === Number(periode.DivisiId || 0);
  }

  return true;
}

async function getPeriodeHandler(req, res) {
  const role = req.user?.role;
  let periodes = [];
  const departments = await getDepartments();
  const divisionNameById = new Map(departments.map((d) => [Number(d.id), d.name]));

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
      Tahun: p.Tahun,
      DivisiId: p.DivisiId,
      NamaDivisi: divisionNameById.get(Number(p.DivisiId)) || null,
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

  const raw = req.body || {};
  const data = {
    NamaPeriode: raw.NamaPeriode ?? raw.nama_periode ?? raw.namaPeriode ?? null,
    Tahun: raw.Tahun ?? raw.tahun ?? null,
    DivisiId: raw.DivisiId ?? raw.divisi_id ?? raw.divisiId ?? null,
    TanggalMulai: raw.TanggalMulai ?? raw.tanggal_mulai ?? raw.tanggalMulai ?? null,
    TanggalSelesai: raw.TanggalSelesai ?? raw.tanggal_selesai ?? raw.tanggalSelesai ?? null,
    Status: raw.Status ?? raw.status ?? "Draft"
  };

  if (data.Tahun !== null && data.Tahun !== "") {
    const tahunNumber = Number(data.Tahun);
    data.Tahun = Number.isFinite(tahunNumber) ? tahunNumber : null;
  } else {
    data.Tahun = null;
  }

  if (data.DivisiId !== null && data.DivisiId !== "") {
    const divisiNumber = Number(data.DivisiId);
    data.DivisiId = Number.isFinite(divisiNumber) ? divisiNumber : null;
  } else {
    data.DivisiId = null;
  }

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

  const raw = req.body || {};
  const payload = {
    NamaPeriode: raw.NamaPeriode ?? raw.nama_periode ?? raw.namaPeriode,
    Tahun: raw.Tahun ?? raw.tahun,
    DivisiId: raw.DivisiId ?? raw.divisi_id ?? raw.divisiId,
    TanggalMulai: raw.TanggalMulai ?? raw.tanggal_mulai ?? raw.tanggalMulai,
    TanggalSelesai: raw.TanggalSelesai ?? raw.tanggal_selesai ?? raw.tanggalSelesai,
    Status: raw.Status ?? raw.status
  };

  if (payload.Tahun !== undefined && payload.Tahun !== null && payload.Tahun !== "") {
    const tahunNumber = Number(payload.Tahun);
    payload.Tahun = Number.isFinite(tahunNumber) ? tahunNumber : existing.Tahun;
  } else if (payload.Tahun === "") {
    payload.Tahun = existing.Tahun;
  }

  if (payload.DivisiId !== undefined && payload.DivisiId !== null && payload.DivisiId !== "") {
    const divisiNumber = Number(payload.DivisiId);
    payload.DivisiId = Number.isFinite(divisiNumber) ? divisiNumber : existing.DivisiId;
  } else if (payload.DivisiId === "") {
    payload.DivisiId = existing.DivisiId;
  }

  if (req.user?.role === "Kadiv") {
    payload.DivisiId = Number(req.user?.dept_id || 0) || existing.DivisiId;
  }

  // Konsep Approval: Jika status berubah menjadi 'final', atur approved_by
  if (payload.Status === "final" && existing.Status !== "final") {
    const managerId = Number(req.user?.sub || 0);
    await updateHasilAkhirApproval(periodeId, managerId);
  } else if (payload.Status === "Draft") {
    // Reset approved_by jika dikembalikan ke Draft
    await updateHasilAkhirApproval(periodeId, null);
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

  try {
    await deletePeriode(periodeId);
  } catch (error) {
    if (error?.code === "ER_ROW_IS_REFERENCED_2" || error?.code === "ER_ROW_IS_REFERENCED") {
      return res.status(409).json({
        success: false,
        message: "Periode tidak bisa dihapus karena masih dipakai oleh data turunan (misalnya KPI/penilaian/hasil)."
      });
    }
    throw error;
  }

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
      PeriodeId: k.PeriodeId,
      attributeId: k.attributeId || null,
      nama_satuan: k.nama_satuan || null,
      simbol: k.simbol || null
    }))
  );
}

async function createKpiHandler(req, res) {
  if (canOnlyViewOwnDivision(req.user?.role) || canOnlyViewSelfEmployee(req.user?.role)) {
    return res.status(403).json({ success: false, message: "Role hanya memiliki akses view KPI" });
  }

  const data = req.body || {};
  data.attributeId = data.id_satuan ?? data.attributeId ?? null;
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

async function getAttributesHandler(req, res) {
  const rows = await querySpk(
    `SELECT id, nama, simbol
     FROM attribute
     ORDER BY id ASC`
  );

  return res.json(
    rows.map((row) => ({
      id: row.id,
      nama: row.nama,
      simbol: row.simbol
    }))
  );
}

async function createAttributeHandler(req, res) {
  const { nama, simbol } = req.body || {};

  if (!nama || !simbol) {
    return res.status(400).json({ success: false, message: "nama dan simbol wajib diisi" });
  }

  const result = await querySpk(
    `INSERT INTO attribute(nama, simbol)
     VALUES(?, ?)`,
    [nama, simbol]
  );

  return res.json({ success: true, Id: result.insertId, message: "Attribute berhasil disimpan" });
}

async function deleteAttributeHandler(req, res) {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ success: false, message: "ID attribute tidak valid" });
  }

  const result = await querySpk("DELETE FROM attribute WHERE id = ?", [id]);
  if (!result.affectedRows) {
    return res.status(404).json({ success: false, message: "Attribute tidak ditemukan" });
  }

  return res.json({ success: true, message: "Attribute berhasil dihapus" });
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
  const targetAttributeId = Number(payload.attributeId ?? payload.id_satuan ?? existing.attributeId ?? 0);
  const targetPeriode = await getPeriodeById(targetPeriodeId);
  if (!canAccessPeriodeForUser(req.user, targetPeriode)) {
    return res.status(403).json({ success: false, message: "Tidak boleh memindahkan KPI ke periode lintas divisi" });
  }

  await updateKpi(kpiId, {
    NamaKpi: payload.NamaKpi || existing.NamaKpi,
    Tipe: payload.Tipe || existing.Tipe,
    PeriodeId: targetPeriodeId,
    attributeId: targetAttributeId,
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
  const createdBy = Number(req.user?.sub || 0);
  for (const resultChunk of insertChunks) {
    await insertHasilAkhirBatch(resultChunk, createdBy);
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

  // Tambahkan pimpinanId dari baris pertama (karena periode yang sama pimpinannya sama)
  const managerId = rows.length > 0 ? rows[0].approved_by : null;
  const createdById = rows.length > 0 ? rows[0].created_by : null;

  if (managerId) {
    employeeIds.push(managerId);
  }
  if (createdById) {
    employeeIds.push(createdById);
  }

  const employees = await getEmployeesByIds([...new Set(employeeIds)]);
  const employeeMap = new Map(employees.map((emp) => [Number(emp.id), emp]));

  const managerEmp = managerId ? employeeMap.get(managerId) : null;
  const creatorEmp = createdById ? employeeMap.get(createdById) : null;

  let data = rows.map((row) => {
    const employee = employeeMap.get(Number(row.KaryawanId));
    return {
      Id: row.Id,
      KaryawanId: row.KaryawanId,
      PeriodeId: row.PeriodeId,
      NilaiOptimasi: row.NilaiOptimasi,
      NilaiSkala: row.NilaiSkala,
      Ranking: row.Ranking,
      created_by: row.created_by,
      approved_by: row.approved_by,
      Karyawan: employee
        ? {
            id: employee.id,
            name: employee.name,
            email: employee.email,
            nik: employee.nik,
            departemen_id: employee.departemen_id,
            lokasi_kerja: employee.lokasikerja || null
          }
        : null
    };
  });

  if (canOnlyViewOwnDivision(req.user?.role) || canOnlyViewSelfEmployee(req.user?.role)) {
    const deptId = Number(req.user?.dept_id || 0);
    data = data.filter((row) => Number(row.Karyawan?.departemen_id || 0) === deptId);
  }

  if (req.query.lokasi_kerja) {
    const lokasiKerja = String(req.query.lokasi_kerja);
    data = data.filter((row) => String(row.Karyawan?.lokasi_kerja || "") === lokasiKerja);
  }

  await logActivity(req, "VIEW", "MooraResult", { PeriodeId: periodeId, Count: data.length });

  return res.json({
    success: true,
    pimpinan: managerEmp
      ? {
          id: managerEmp.id,
          nama: managerEmp.name,
          jabatan: managerEmp.jabatan_nama || "Manager"
        }
      : null,
    pembuat: creatorEmp
      ? {
          id: creatorEmp.id,
          nama: creatorEmp.name,
          jabatan: creatorEmp.jabatan_nama || "Kadiv"
        }
      : null,
    data
  });
}

async function getDepartmentsHandler(req, res) {
  let rows = await getDepartments();

  if (canOnlyViewSelfEmployee(req.user?.role)) {
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

  const mapped = filteredRows.map((u) => ({
    id: u.id,
    name: u.name,
    nik: u.nik,
    email: u.email,
    departemen_id: u.departemen_id,
    department_name: u.department_name,
    lokasi_kerja: u.lokasikerja || null,
    work_location_id: u.work_location_id || null,
    work_location_name: u.work_location_name || null,
    user_id: u.user_id,
    role: u.role,
    role_group: classifyRoleGroup(u.role)
  }));

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

async function getIndividualReportHandler(req, res) {
  const { periode_id, karyawan_id } = req.params;
  const format = req.query.format || "json";

  try {
    const periode = await getPeriodeById(Number(periode_id));
    if (!canAccessPeriodeForUser(req.user, periode)) {
      return res.status(403).json({ success: false, message: "Tidak boleh akses laporan lintas divisi" });
    }

    const kpis = await getKpis(Number(periode_id));
    const rawEvals = await getEvaluationsByPeriode(Number(periode_id));
    const userEvals = rawEvals.filter((e) => Number(e.KaryawanId) === Number(karyawan_id));

    const employees = await getEmployeesByIds([Number(karyawan_id)]);
    const employee = employees[0] || null;

    const data = kpis.map((k) => {
      const ev = userEvals.find((e) => Number(e.KpiId) === Number(k.Id));
      return {
        Kriteria: k.NamaKpi,
        Nilai: ev ? ev.Nilai : 0,
        Satuan: k.simbol || ""
      };
    });

    const summary = await getHasilAkhirByPeriode(Number(periode_id));
    const result = summary.find((s) => Number(s.KaryawanId) === Number(karyawan_id));

    // Get Approval data
    let bypassPimpinan = null;
    if (periode.Status === "final" && result?.approved_by) {
      const pimpinanUser = await getEmployeeByUserId(result.approved_by);
      if (pimpinanUser) {
        bypassPimpinan = {
          nama: pimpinanUser.name || "N/A",
          jabatan: pimpinanUser.jabatan_nama || pimpinanUser.role || "Pimpinan",
          tanggal: toIso(periode.UpdatedAt || new Date())
        };
      }
    }

    if (format === "pdf") {
      const pdfDoc = await PDFDocument.create();
      // Use StandardFonts without embedding to avoid potential path issues in some environments
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
      let page = pdfDoc.addPage([595.28, 841.89]); // A4
      const { width, height } = page.getSize();

      page.drawText("FORM PENILAIAN KARYAWAN", { x: 50, y: height - 50, size: 16, font: fontBold });
      page.drawText(`Nama: ${employee?.name || "N/A"}`, { x: 50, y: height - 80, size: 12, font });
      page.drawText(`NIK: ${employee?.nik || "N/A"}`, { x: 50, y: height - 100, size: 12, font });
      page.drawText(`Periode: ${periode?.NamaPeriode || "N/A"} ${periode?.Tahun || ""}`, { x: 50, y: height - 120, size: 12, font });

      let yPos = height - 160;
      page.drawText("No", { x: 50, y: yPos, size: 11, font: fontBold });
      page.drawText("Kriteria", { x: 80, y: yPos, size: 11, font: fontBold });
      page.drawText("Nilai", { x: 450, y: yPos, size: 11, font: fontBold });
      page.drawLine({ start: { x: 50, y: yPos - 5 }, end: { x: 545, y: yPos - 5 }, thickness: 1 });

      yPos -= 25;
      data.forEach((item, idx) => {
        // Ensure values are strings
        const kriteria = String(item.Kriteria || "");
        const nilai = String(item.Nilai || 0);
        const satuan = String(item.Satuan || "");

        page.drawText(`${idx + 1}`, { x: 50, y: yPos, size: 10, font });
        page.drawText(kriteria, { x: 80, y: yPos, size: 10, font });
        page.drawText(`${nilai} ${satuan}`, { x: 450, y: yPos, size: 10, font });
        yPos -= 20;

        // Add new page if needed
        if (yPos < 150) {
          page = pdfDoc.addPage([595.28, 841.89]);
          yPos = height - 50;
        }
      });

      page.drawLine({ start: { x: 50, y: yPos + 10 }, end: { x: 545, y: yPos + 10 }, thickness: 1 });
      yPos -= 20;
      if (result) {
        const score = typeof result.NilaiOptimasi === "number" ? result.NilaiOptimasi.toFixed(4) : "0";
        page.drawText(`Hasil Akhir: ${score}`, { x: 50, y: yPos, size: 11, font: fontBold });
        page.drawText(`Ranking: ${result.Ranking || "-"}`, { x: 450, y: yPos, size: 11, font: fontBold });
      }

      yPos -= 80;
      // Protection for footer position
      if (yPos < 100) {
        page = pdfDoc.addPage([595.28, 841.89]);
        yPos = height - 100;
      }

      page.drawText("Mengetahui,", { x: 50, y: yPos, size: 11, font });
      page.drawText("Disetujui Oleh,", { x: 380, y: yPos, size: 11, font });
      yPos -= 50;

      if (bypassPimpinan) {
        page.drawText("Digitally Signed", { x: 380, y: yPos + 15, size: 8, font: fontItalic, color: rgb(0.5, 0.5, 0.5) });
        page.drawText(bypassPimpinan.nama, { x: 380, y: yPos, size: 11, font: fontBold });
        page.drawText(bypassPimpinan.jabatan, { x: 380, y: yPos - 15, size: 9, font });
      } else {
        page.drawText("(.................................)", { x: 380, y: yPos, size: 11, font });
      }

      page.drawText("(.................................)", { x: 50, y: yPos, size: 11, font });
      page.drawText("Kepala Divisi", { x: 85, y: yPos - 15, size: 10, font });
      page.drawText("Pimpinan", { x: 425, y: yPos - 15, size: 10, font });

      const pdfBytes = await pdfDoc.save();
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="Report_${employee?.name || "User"}.pdf"`);
      return res.end(Buffer.from(pdfBytes));
    }

    return res.json({
      success: true,
      metadata: {
        Nama: employee?.name || "N/A",
        NIK: employee?.nik || "N/A",
        Periode: periode?.NamaPeriode || "N/A",
        Tahun: periode?.Tahun || "N/A",
        Status: periode?.Status
      },
      pimpinan: bypassPimpinan,
      rincian: data,
      kesimpulan: result
        ? {
            Ranking: result.Ranking,
            Skor: result.Value || result.NilaiOptimasi
          }
        : null
    });
  } catch (err) {
    console.error("DEBUG REPORT ERROR:", err.message);
    console.error(err.stack);
    return res.status(500).json({ success: false, message: "Internal Server Error", error_detail: err.message });
  }
}

async function getSummaryReportHandler(req, res) {
  const periodeId = Number(req.params.periode_id);
  const format = req.query.format || "json";

  try {
    const periode = await getPeriodeById(periodeId);
    if (!canAccessPeriodeForUser(req.user, periode)) {
      return res.status(403).json({ success: false, message: "Tidak boleh akses laporan lintas divisi" });
    }

    const kpis = await getKpis(periodeId);
    const results = await getHasilAkhirByPeriode(periodeId);
    const evaluations = await getEvaluationsByPeriode(periodeId);

    const employeeIds = results.map((r) => Number(r.KaryawanId));
    const employees = await getEmployeesByIds(employeeIds);
    const empMap = new Map(employees.map((e) => [Number(e.id), e]));

    const evalMap = {};
    evaluations.forEach((ev) => {
      const kId = Number(ev.KaryawanId);
      if (!evalMap[kId]) evalMap[kId] = {};
      evalMap[kId][Number(ev.KpiId)] = ev.Nilai;
    });

    const data = results.map((res) => {
      const emp = empMap.get(Number(res.KaryawanId));
      const row = {
        NIK: emp?.nik || "N/A",
        Nama: emp?.name || "N/A",
        Ranking: res.Ranking,
        Skor: res.NilaiOptimasi
      };

      kpis.forEach((k) => {
        row[k.NamaKpi] = evalMap[Number(res.KaryawanId)]?.[Number(k.Id)] || 0;
      });

      return row;
    });

    if (format === "excel") {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Rekapitulasi");

      const columns = [
        { header: "No", key: "no", width: 5 },
        { header: "NIK", key: "NIK", width: 15 },
        { header: "Nama", key: "Nama", width: 30 },
        ...kpis.map((k) => ({ header: k.NamaKpi, key: k.NamaKpi, width: 15 })),
        { header: "Skor", key: "Skor", width: 12 },
        { header: "Ranking", key: "Ranking", width: 10 }
      ];

      worksheet.columns = columns;

      data.forEach((row, idx) => {
        worksheet.addRow({ no: idx + 1, ...row });
      });

      // Styling
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="Rekap_${periode?.NamaPeriode || "Periode"}.xlsx"`);

      await workbook.xlsx.write(res);
      return res.end();
    }

    return res.json({
      success: true,
      title: `Laporan Rekapitulasi - ${periode?.NamaPeriode || ""}`,
      columns: ["NIK", "Nama", ...kpis.map((k) => k.NamaKpi), "Skor", "Ranking"],
      data
    });
  } catch (err) {
    console.error("DEBUG SUMMARY ERROR:", err.message);
    console.error(err.stack);
    return res.status(500).json({ success: false, message: "Internal Server Error", error_detail: err.message });
  }
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
  getAttributesHandler,
  createAttributeHandler,
  deleteAttributeHandler,
  getComparisonsHandler,
  inputComparisonHandler,
  calculateWeightsHandler,
  inputPenilaianHandler,
  calculateMooraHandler,
  getMooraResultHandler,
  getIndividualReportHandler,
  getSummaryReportHandler,
  getDepartmentsHandler,
  getEmployeesHandler,
  getWorkLocationsHandler,
  getAuditLogsHandler
};
