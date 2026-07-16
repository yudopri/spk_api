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
  getKpisByPeriode,
  bulkInsertPenilaian,
  createKpi,
  updateKpi,
  deleteKpi,
  getKpiMetadata,
  getTargetByKpi,
  getComparisons,
  replaceComparisons,
  updateKpiWeights,
  replaceEvaluations,
  clearHasilAkhir,
  insertHasilAkhirBatch,
  saveAchievement,
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
  updateHasilAkhirStatus,
  getGroupComparisons,
  replaceGroupComparisons,
  updateGroupWeights,
  queryMitra
} = require("../models/spkModel");
const { querySpk } = require("../config/db");
const {
  calculateAHP,
  calculateAchievement,
  buildMooraCoeffMap,
  scoreMooraChunk,
  solveAhpMatrix,
  validatePairwiseComparisons
} = require("../services/spkMath");
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
    email: req.user?.email || "-",
    name: req.user?.name || "-",
    action,
    entityName: entity,
    details,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] || null,
    url: req.originalUrl,
    method: req.method
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

function getQueryOptions(req) {
  return {
    search: req.query.search,
    filter: req.query.filter,
    page: req.query.page,
    pageSize: req.query.pageSize || req.query.limit, // handle both pageSize and limit
    sort: req.query.sort
  };
}

function formatMeta(options, total) {
  const page = parseInt(options.page || 1);
  const pageSize = parseInt(options.pageSize || total || 1);
  return {
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / (pageSize || 1))
  };
}

function normalizeKpiType(value) {
  return String(value || "benefit").toLowerCase() === "cost" ? "cost" : "benefit";
}

function buildAssessmentSnapshotRow({ periodeId, employeeId, kpiMeta, realisasi, achievement, rank, yi }) {
  return {
    kpi_id: Number(kpiMeta.Id),
    nama_kpi: kpiMeta.NamaKpi,
    target: Number(kpiMeta.Target || 0),
    realisasi: Number(realisasi || 0),
    achievement: Number(achievement || 0),
    weight_ahp: Number(kpiMeta.BobotAhp || 0),
    weight_group: Number(kpiMeta.bobot_grup || 0),
    jenis: normalizeKpiType(kpiMeta.Tipe),
    periode_id: Number(periodeId),
    karyawan_id: Number(employeeId),
    yi: Number(yi || 0),
    rank: Number(rank || 0)
  };
}

async function assertPeriodNotLocked(res, periodeId) {
  if (!periodeId) return true;
  const period = await getPeriodeById(Number(periodeId));
  if (String(period?.Status || "").toLowerCase() === "locked") {
    res.status(403).json({
      success: false,
      message: "Data pada periode ini sudah terkunci dan tidak dapat diubah."
    });
    return false;
  }
  return true;
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
  try {
    const role = req.user?.role;
    let result = { rows: [], total: 0 };
    const departments = await getDepartments();
    const divisionNameById = new Map(departments.rows.map((d) => [Number(d.id), d.name]));
    const options = getQueryOptions(req);

    if (canOnlyViewOwnDivision(role) || canOnlyViewSelfEmployee(role)) {
      const deptId = Number(req.user?.dept_id || 0);
      result = deptId ? await getPeriodesByDivision(deptId, options) : { rows: [], total: 0 };
    } else {
      result = await getPeriodes(options);
    }

    await logActivity(req, "VIEW", "Periode", { total: result.total });

    return res.json({
      data: result.rows.map((p) => ({
        Id: p.Id,
        NamaPeriode: p.NamaPeriode,
        Tahun: p.Tahun,
        DivisiId: p.DivisiId,
        NamaDivisi: divisionNameById.get(Number(p.DivisiId)) || null,
        TanggalMulai: toIso(p.TanggalMulai),
        TanggalSelesai: toIso(p.TanggalSelesai),
        Status: p.Status
      })),
      meta: formatMeta(options, result.total)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
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

  if (!(await assertPeriodNotLocked(res, data.PeriodeId))) return;

  if (data.DivisiId !== null && data.DivisiId !== undefined && data.DivisiId !== "") {
    const activeStatusCheck = await querySpk(
      `SELECT Id FROM periodes
       WHERE DivisiId = ?
       AND Status NOT IN ('Draft')
       LIMIT 1`,
      [Number(data.DivisiId)]
    );
    if (activeStatusCheck.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Divisi ini masih memiliki periode aktif dan tidak dapat membuat periode baru."
      });
    }
  }

  if (req.user?.role === "Kadiv") {
    data.DivisiId = Number(req.user?.dept_id || 0) || data.DivisiId;
  }

  const insertId = await createPeriode(data);
  await logActivity(req, "CREATE", "Periode", { Id: insertId, Nama: data.NamaPeriode });
  return res.json({ success: true, Id: insertId });
}

async function updatePeriodeHandler(req, res) {
  try {
    const periodeId = Number(req.params.id);
    const existing = await getPeriodeById(periodeId);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Periode tidak ditemukan" });
    }

    const existingStatus = String(existing.Status || "").toLowerCase();
    if (existingStatus === "locked") {
      const requestedStatus = String(req.body?.Status ?? req.body?.status ?? "").toLowerCase();
      if (requestedStatus !== "locked") {
        return res.status(403).json({ success: false, message: "Periode terkunci tidak dapat diubah" });
      }
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

    if (payload.Status === "Final" && existing.Status !== "Final") {
      // Pastikan semua hasil_akhir sudah direview (Status = Reviewed atau Final)
      const records = await getHasilAkhirByPeriode(periodeId);
      const hasUnreviewed = records.rows.some((r) => r.status === "Pending" || r.status === "Draft");

      if (hasUnreviewed) {
        return res.status(400).json({
          success: false,
          message: "Tidak bisa finalisasi. Masih ada karyawan yang belum direview."
        });
      }

      // Stamp approved_by and set status final for all results in this period
      const approvedBy = Number(req.user?.sub || 0);
      await querySpk("UPDATE hasil_akhir SET approved_by = ?, status = 'Final' WHERE PeriodeId = ?", [
        approvedBy,
        periodeId
      ]);
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
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

async function deletePeriodeHandler(req, res) {
  const periodeId = Number(req.params.id);
  const existing = await getPeriodeById(periodeId);
  if (!existing) {
    return res.status(404).json({ success: false, message: "Periode tidak ditemukan" });
  }

  if (String(existing.Status || "").toLowerCase() === "locked") {
    return res.status(403).json({ success: false, message: "Periode terkunci tidak dapat dihapus" });
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
  try {
    const periodeId = req.query.periode_id;
    let result = { rows: [], total: 0 };
    const options = getQueryOptions(req);

    if (canOnlyViewOwnDivision(req.user?.role) || canOnlyViewSelfEmployee(req.user?.role)) {
      const deptId = Number(req.user?.dept_id || 0);
      result = deptId ? await getKpisByDivision(deptId, periodeId || null, options) : { rows: [], total: 0 };
    } else {
      result = await getKpis(periodeId, options);
    }

    await logActivity(req, "VIEW", "Criterion", { total: result.total });

    return res.json({
      data: result.rows.map((k) => ({
        Id: k.Id,
        NamaKpi: k.NamaKpi,
        Tipe: k.Tipe,
        Target: k.Target,
        IsActive: k.IsActive,
        BobotAhp: k.BobotAhp,
        PeriodeId: k.PeriodeId,
        attributeId: k.attributeId || null,
        group_id: k.group_id || null,
        nama_grup: k.nama_grup || null,
        bobot_grup: k.bobot_grup || 0,
        nama_satuan: k.nama_satuan || null,
        simbol: k.simbol || null
      })),
      meta: formatMeta(options, result.total)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

async function createKpiHandler(req, res) {
  if (canOnlyViewOwnDivision(req.user?.role) || canOnlyViewSelfEmployee(req.user?.role)) {
    return res.status(403).json({ success: false, message: "Role hanya memiliki akses view KPI" });
  }

  const data = req.body || {};
  data.attributeId = data.id_satuan ?? data.attributeId ?? null;
  if (data.Target !== undefined && Number(data.Target) <= 0) {
    return res.status(400).json({ success: false, message: "Target KPI harus lebih besar dari 0" });
  }
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
  try {
    const options = getQueryOptions(req);
    const { rows, total } = await getAttributes(options);

    await logActivity(req, "VIEW", "Attribute", { total });

    return res.json({
      data: rows.map((row) => ({
        id: row.id,
        nama: row.nama,
        simbol: row.simbol
      })),
      meta: formatMeta(options, total)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
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

  await logActivity(req, "CREATE", "Attribute", { Id: result.insertId, nama, simbol });
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

  await logActivity(req, "DELETE", "Attribute", { Id: id });
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
  if (String(existingPeriode?.Status || "").toLowerCase() === "locked") {
    return res.status(403).json({ success: false, message: "KPI pada periode terkunci tidak dapat diubah" });
  }
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
  if (payload.Target !== undefined && Number(payload.Target) <= 0) {
    return res.status(400).json({ success: false, message: "Target KPI harus lebih besar dari 0" });
  }

  await updateKpi(kpiId, {
    NamaKpi: payload.NamaKpi || existing.NamaKpi,
    Tipe: payload.Tipe || existing.Tipe,
    PeriodeId: targetPeriodeId,
    attributeId: targetAttributeId,
    BobotAhp: payload.BobotAhp ?? existing.BobotAhp,
    Target: payload.Target ?? existing.Target,
    IsActive: payload.IsActive ?? existing.IsActive,
    group_id: payload.group_id ?? existing.group_id
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
  if (String(existingPeriode?.Status || "").toLowerCase() === "locked") {
    return res.status(403).json({ success: false, message: "KPI pada periode terkunci tidak dapat dihapus" });
  }
  if (!canAccessPeriodeForUser(req.user, existingPeriode)) {
    return res.status(403).json({ success: false, message: "Tidak boleh menghapus KPI lintas divisi" });
  }

  await deleteKpi(kpiId);
  await logActivity(req, "DELETE", "Criterion", { Id: kpiId });
  return res.json({ success: true, message: "KPI berhasil dihapus" });
}

// KPI Groups Handlers
async function getKpiGroupsHandler(req, res) {
  try {
    const { periode_id } = req.query;
    const options = getQueryOptions(req);
    const { rows, total } = await getKpiGroups(periode_id, options);

    await logActivity(req, "VIEW", "KpiGroup", { total });

    return res.json({
      data: rows,
      meta: formatMeta(options, total)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

async function createKpiGroupHandler(req, res) {
  const { nama_grup, periode_id, bobot_grup } = req.body;
  if (!nama_grup || !periode_id) {
    return res.status(400).json({ success: false, message: "Nama grup dan Periode ID wajib diisi" });
  }
  if (!(await assertPeriodNotLocked(res, periode_id))) return;
  const id = await createKpiGroup({ nama_grup, periode_id, bobot_grup });
  await logActivity(req, "CREATE", "KpiGroup", { id, nama_grup });
  return res.json({ success: true, id });
}

async function updateKpiGroupHandler(req, res) {
  const { id } = req.params;
  const { nama_grup, bobot_grup } = req.body;
  const existing = await querySpk("SELECT periode_id FROM kpi_groups WHERE id = ? LIMIT 1", [id]);
  if (!(await assertPeriodNotLocked(res, existing[0]?.periode_id))) return;
  await updateKpiGroup(id, { nama_grup, bobot_grup });
  await logActivity(req, "UPDATE", "KpiGroup", { id, nama_grup });
  return res.json({ success: true, message: "Grup KPI berhasil diperbarui" });
}

async function deleteKpiGroupHandler(req, res) {
  const { id } = req.params;
  const existing = await querySpk("SELECT periode_id FROM kpi_groups WHERE id = ? LIMIT 1", [id]);
  if (!(await assertPeriodNotLocked(res, existing[0]?.periode_id))) return;
  await deleteKpiGroup(id);
  await logActivity(req, "DELETE", "KpiGroup", { id });
  return res.json({ success: true, message: "Grup KPI berhasil dihapus" });
}

async function getGroupComparisonsHandler(req, res) {
  try {
    const { periode_id } = req.params;
    const data = await getGroupComparisons(periode_id);

    await logActivity(req, "VIEW", "GroupComparisons", { periodeId: Number(periode_id) });

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

async function saveGroupComparisonsHandler(req, res) {
  try {
    const { periode_id } = req.params;
    const { comparisons } = req.body; // [{group_a_id, group_b_id, nilai}]

    // 1. Save raw comparisons
    await replaceGroupComparisons(periode_id, comparisons.map(c => ({ ...c, periode_id })));

    // 2. Step: Calculate AHP Local Weights for Groups
    const matrixInput = comparisons.map((c) => [c.group_a_id, c.group_b_id, c.nilai]);
    const groupsMeta = await getKpiGroups(periode_id);
    const groups = groupsMeta.rows;
    const groupIds = groups.map((g) => g.id);

    if (groupIds.length > 0) {
      const { weights, cr } = solveAhpMatrix(matrixInput, groupIds);
      await updateGroupWeights(periode_id, weights);
      await logActivity(req, "CREATE/UPDATE", "GroupComparisons", { periodeId: Number(periode_id), count: comparisons.length, cr });
      res.json({ success: true, cr, weights });
    } else {
      await logActivity(req, "CREATE/UPDATE", "GroupComparisons", { periodeId: Number(periode_id), count: comparisons.length });
      res.json({ success: true, message: "Comparisons saved but no groups found" });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
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
  if (String(periode?.Status || "").toLowerCase() === "locked") {
    return res.status(403).json({ success: false, message: "Periode terkunci, AHP tidak dapat diubah" });
  }
  if (!canAccessPeriodeForUser(req.user, periode)) {
    return res.status(403).json({ success: false, message: "Tidak boleh input perbandingan lintas divisi" });
  }

  const validation = validatePairwiseComparisons(dataList, [...new Set(dataList.flatMap((item) => [item.KpiAId, item.KpiBId]))]);
  if (!validation.valid) {
    return res.status(400).json({ success: false, message: validation.message });
  }

  await replaceComparisons(periodeId, dataList);
  await logActivity(req, "CREATE/UPDATE", "AhpComparison", { PeriodeId: periodeId, Count: dataList.length });
  return res.json({ success: true, message: "Matriks perbandingan AHP berhasil disimpan" });
}

async function calculateWeightsHandler(req, res) {
  try {
    const periodeId = Number(req.params.periode_id);
    const periode = await getPeriodeById(periodeId);
    if (String(periode?.Status || "").toLowerCase() === "locked") {
      return res.status(403).json({ success: false, message: "Periode terkunci, bobot tidak dapat dihitung ulang" });
    }
    if (!canAccessPeriodeForUser(req.user, periode)) {
      return res.status(403).json({ success: false, message: "Tidak boleh menghitung bobot lintas divisi" });
    }

    const groupId = req.body.group_id ? Number(req.body.group_id) : null;
    const kpisMeta = await getKpis(periodeId, {}, groupId);
    const kpis = kpisMeta.rows;

    if (kpis.length === 0) {
      return res.status(400).json({ success: false, message: "KPI tidak ditemukan" });
    }

    const kpiIds = new Set(kpis.map((k) => Number(k.Id)));
    const allComparisons = await getComparisons(periodeId);
    const comps = allComparisons.filter((c) => kpiIds.has(Number(c.KpiAId)) && kpiIds.has(Number(c.KpiBId)));

    if (comps.length === 0 && kpis.length > 1) {
      return res.status(400).json({ success: false, message: "Perbandingan AHP belum lengkap untuk grup ini" });
    }

    const ahp = calculateAHP(kpis, comps);
    if (!ahp.consistency.isConsistent || Number(ahp.consistency.cr) > 0.1) {
      return res.status(400).json({
        success: false,
        message: "Matriks AHP tidak konsisten. Silakan ulangi input perbandingan.",
        consistency: ahp.consistency
      });
    }

    const weightByKpiId = {};
    kpis.forEach((kpi, idx) => {
      weightByKpiId[kpi.Id] = Number(ahp.weights[idx]);
    });

    await updateKpiWeights(periodeId, weightByKpiId);
    await logActivity(req, "CALCULATE", "AhpWeights", {
      PeriodeId: periodeId,
      GroupId: groupId,
      Weights: ahp.weights,
      Consistency: ahp.consistency
    });

    return res.json({ success: true, data: ahp.weights, consistency: ahp.consistency });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}
async function processMooraPenilaian({ evals, periodeId, user }) {
  if (!Array.isArray(evals) || evals.length === 0) {
    throw new Error("Data tidak boleh kosong");
  }

  // 1. Load KPI sekali saja (ANTI N+1)
  const kpiRows = await getKpisByPeriode(periodeId);

  if (!kpiRows.length) {
    throw new Error("KPI periode tidak ditemukan");
  }

  const kpiMap = new Map(
    kpiRows.map(k => [Number(k.Id), k])
  );

  const activeKpiIds = new Set(kpiRows.map(k => Number(k.Id)));

  // 2. Validasi duplikasi input
  const pairSet = new Set();
  for (const e of evals) {
    const key = `${e.KaryawanId}:${e.KpiId}`;
    if (pairSet.has(key)) {
      throw new Error("Terdapat KPI duplikat dalam satu penilaian");
    }
    pairSet.add(key);
  }

  // 3. Validasi KPI lengkap
  const payloadKpiIds = new Set(evals.map(e => Number(e.KpiId)));
  const missing = [...activeKpiIds].filter(id => !payloadKpiIds.has(id));

  if (missing.length) {
    throw Object.assign(new Error("Matriks KPI belum lengkap"), {
      missing_kpi_ids: missing
    });
  }

  // 4. Transform data (FAST in-memory processing)
  const normalized = [];

  for (const item of evals) {
    const kpi = kpiMap.get(Number(item.KpiId));

    if (!kpi) {
      throw new Error(`KPI ${item.KpiId} tidak ditemukan`);
    }

    const realisasi = Number(item.Realisasi);

    if (!Number.isFinite(realisasi)) {
      throw new Error("Realisasi tidak valid");
    }

    // ✅ Calculate achievement (boleh 0 untuk realisasi=0)
    const achievement = calculateAchievement({
      target: Number(kpi.Target),
      realisasi,
      tipe: kpi.Tipe
    });

    normalized.push({
      KaryawanId: Number(item.KaryawanId),
      KpiId: Number(item.KpiId),
      PeriodeId: Number(periodeId),
      Realisasi: realisasi,
      Achievement: achievement.achievement, // ✅ 0 = valid, insert tetap
      CreatedBy: Number(user?.sub || 0)
    });
  }

  return normalized;
}
async function inputPenilaianHandler(req, res) {
  try {
    const periodeId = Number(req.body?.[0]?.PeriodeId);

    const periode = await getPeriodeById(periodeId);

    if (!periode) {
      return res.status(404).json({ message: "Periode tidak ditemukan" });
    }

    if (String(periode.Status).toLowerCase() === "locked") {
      return res.status(403).json({ message: "Periode terkunci" });
    }

    if (!canAccessPeriodeForUser(req.user, periode)) {
      return res.status(403).json({ message: "Akses ditolak" });
    }

    // 🔥 CORE ENGINE
    const normalized = await processMooraPenilaian({
      evals: req.body,
      periodeId,
      user: req.user
    });

    // 🔥 BULK INSERT (IMPORTANT)
    await bulkInsertPenilaian(normalized);

    await logActivity(req, "CREATE", "Penilaian", { periodeId, total: normalized.length });

    return res.json({
      success: true,
      message: "Penilaian berhasil disimpan",
      total: normalized.length
    });

  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
      extra: err.missing_kpi_ids || null
    });
  }
}

async function persistMooraResultSnapshots(periodeId, kpis, rankedResults, detailMap) {
  for (const row of rankedResults) {
    const snapshotRows = (detailMap[row.employeeId] || []).map((detail) => {
      const kpiMeta = kpis.find((k) => Number(k.Id) === Number(detail.KpiId));
      if (!kpiMeta) return null;
      return buildAssessmentSnapshotRow({
        periodeId,
        employeeId: row.employeeId,
        kpiMeta,
        realisasi: detail.NilaiAsli,
        achievement: detail.NilaiAsli,
        rank: row.rank,
        yi: row.yi
      });
    }).filter(Boolean);

    await saveMooraSnapshot(periodeId, row.employeeId, JSON.stringify({
      periode_id: periodeId,
      ranking: row.rank,
      yi: row.yi,
      details: snapshotRows
    }));
  }
}

function chunkArray(items, chunkSize) {
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

async function calculateMooraHandler(req, res) {
  try {
    const periodeId = Number(req.params.periode_id);
    const periode = await getPeriodeById(periodeId);
    if (String(periode?.Status || "").toLowerCase() === "locked") {
      return res.status(403).json({ success: false, message: "Periode terkunci, MOORA tidak dapat diproses ulang" });
    }
    if (!canAccessPeriodeForUser(req.user, periode)) {
      return res.status(403).json({ success: false, message: "Tidak boleh menghitung ranking lintas divisi" });
    }

    const kpisMeta = await getKpis(periodeId);
    const kpis = kpisMeta.rows;
    const employeeIds = await getDistinctKaryawanIdsByPeriode(periodeId);

    if (kpis.length === 0 || employeeIds.length === 0) {
      return res.status(400).json({ success: false, message: "Data tidak mencukupi" });
    }

    const summary = await getPenilaianSummaryByPeriode(periodeId);
    const activeKpiIds = kpis.map((kpi) => Number(kpi.Id));
    const activeKpiCount = activeKpiIds.length;
    const incompleteEmployees = summary
      .filter((row) => Number(row.kpi_count) !== activeKpiCount)
      .map((row) => Number(row.KaryawanId));
    if (incompleteEmployees.length > 0) {
      return res.status(400).json({
        success: false,
        message: "MOORA dibatalkan karena matriks keputusan tidak lengkap.",
        incomplete_employee_ids: incompleteEmployees
      });
    }

    const distinctKpiIds = await getDistinctKpiIdsByPeriode(periodeId);
    const missingKpis = activeKpiIds.filter((id) => !distinctKpiIds.includes(id));
    if (missingKpis.length > 0) {
      return res.status(400).json({
        success: false,
        message: "MOORA dibatalkan karena ada KPI aktif yang belum memiliki nilai.",
        missing_kpi_ids: missingKpis
      });
    }

    const hasWeights = kpis.every((kpi) => Number(kpi.BobotAhp) > 0);
    if (!hasWeights) {
      return res.status(400).json({
        success: false,
        message: "Bobot AHP belum tersedia. Jalankan perhitungan AHP terlebih dahulu."
      });
    }

    // Build group weight map from kpi_groups
    const groupRows = await getKpiGroups(periodeId);
    const groupWeightMap = {};
    groupRows.rows.forEach((g) => {
      groupWeightMap[g.id] = Number(g.bobot_grup ?? 1);
    });

    const denominatorRows = await querySpk(
      `SELECT KpiId, SQRT(SUM(Achievement * Achievement)) AS denominator
     FROM penilaians
     WHERE PeriodeId = ?
     GROUP BY KpiId`,
      [periodeId]
    );

    const denominatorMap = {};
    denominatorRows.forEach((row) => {
      denominatorMap[row.KpiId] = Number(row.denominator) || 1;
    });

    const coeffMap = buildMooraCoeffMap(kpis, denominatorMap, groupWeightMap);
    const yiMap = {};
    const detailMap = {};

    const chunks = chunkArray(employeeIds, Number(process.env.MOORA_BATCH_SIZE || 500));
    for (const employeeChunk of chunks) {
      const evaluations = await getEvaluationChunk(periodeId, employeeChunk);
      const partial = scoreMooraChunk(evaluations, coeffMap);
      for (const [employeeId, yi] of Object.entries(partial.yiByEmployee)) {
        yiMap[employeeId] = (yiMap[employeeId] || 0) + yi;
        if (!detailMap[employeeId]) detailMap[employeeId] = [];
        detailMap[employeeId].push(...(partial.detailByEmployee[employeeId] || []));
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
      NilaiSkala: Math.round(row.yi * 10000) / 10000,
      Ranking: index + 1,
      created_by: Number(req.user?.sub || 0),
      status: "Processed",
      catatan: JSON.stringify({
        periode_id: periodeId,
        kpis: kpis.map((kpi) => ({
          kpi_id: kpi.Id,
          nama_kpi: kpi.NamaKpi,
          jenis: String(kpi.Tipe || "").toLowerCase(),
          target: Number(kpi.Target || 0),
          bobot_ahp: Number(kpi.BobotAhp || 0),
          bobot_grup: Number(kpi.bobot_grup || 1),
          group_id: kpi.group_id || null,
          group_name: kpi.nama_grup || null,
          satuan: kpi.simbol || kpi.nama_satuan || null
        })),
        hasil_moora: detailMap[row.employeeId] || [],
        yi: row.yi,
        ranking: index + 1
      })
    }));

    const insertChunks = chunkArray(resultRows, Number(process.env.INSERT_BATCH_SIZE || 500));
    for (const resultChunk of insertChunks) {
      await insertHasilAkhirBatch(resultChunk);
    }

    await persistMooraResultSnapshots(periodeId, kpis, ranked.map((row, index) => ({ ...row, rank: index + 1 })), detailMap);

    await querySpk("UPDATE periodes SET Status = 'Processed' WHERE Id = ?", [periodeId]);

    await logActivity(req, "CALCULATE", "MooraResult", { PeriodeId: periodeId, Count: resultRows.length });
    return res.json({ success: true, message: "Perangkingan MOORA selesai" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

async function getMooraResultHandler(req, res) {
  try {
    const periodeId = Number(req.params.periode_id);
  const periode = await getPeriodeById(periodeId);
  if (!canAccessPeriodeForUser(req.user, periode)) {
    return res.status(403).json({ success: false, message: "Tidak boleh melihat hasil lintas divisi" });
  }

  const options = getQueryOptions(req);
  const { rows, total } = await getHasilAkhirByPeriode(periodeId, options);
  const employeeIds = [...new Set(rows.map((row) => row.KaryawanId))];
  const employees = await getEmployeesByIds(employeeIds);
  const employeeMap = new Map(employees.map((emp) => [Number(emp.id), emp]));

  let data = await Promise.all(rows.map(async (row) => {
    const employee = employeeMap.get(Number(row.KaryawanId));
    const decryptedNik = employee ? await decryptNikValue(employee.nik) : null;

    // Parse catatan JSON and handle legacy text
    let parsedCatatan = { p: "", i: "", s: "" };
    try {
      if (row.catatan && row.catatan.startsWith("{")) {
        parsedCatatan = JSON.parse(row.catatan);
      } else if (row.catatan) {
        parsedCatatan.p = row.catatan;
      }
    } catch (e) {
      parsedCatatan.p = row.catatan || "";
    }

    return {
      Id: row.Id,
      KaryawanId: row.KaryawanId,
      PeriodeId: row.PeriodeId,
      NilaiOptimasi: row.NilaiOptimasi,
      NilaiSkala: row.NilaiSkala,
      Ranking: row.Ranking,
      status: row.status,
      catatan: parsedCatatan,
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
    return res.json({ success: true, data, meta: formatMeta(options, total) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

async function getDepartmentsHandler(req, res) {
  try {
    const options = getQueryOptions(req);
    let { rows, total } = await getDepartments(options);

    if (canOnlyViewSelfEmployee(req.user?.role)) {
      const deptId = Number(req.user?.dept_id || 0);
      const ownDept = deptId ? await getDepartmentById(deptId) : null;
      rows = ownDept ? [ownDept] : [];
      total = rows.length;
    }

    await logActivity(req, "VIEW", "Department", { total });

    return res.json({
      data: rows.map((d) => ({ id: d.id, name: d.name })),
      meta: formatMeta(options, total)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

async function getEmployeesHandler(req, res) {
  try {
    const options = getQueryOptions(req);
    const { rows, total } = await getEmployees({
      deptId: req.query.dept_id || null,
      lokasiKerja: req.query.lokasi_kerja || null,
      ...options
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

    await logActivity(req, "VIEW", "Employee", { total });

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

    return res.json({
      data: mapped,
      meta: formatMeta(options, total)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

async function getWorkLocationsHandler(req, res) {
  try {
    const options = getQueryOptions(req);
    const { rows, total } = await getWorkLocations({
      status: req.query.status || null,
      ...options
    });

    await logActivity(req, "VIEW", "WorkLocation", { total });

    return res.json({
      data: rows.map((w) => ({
        id: w.id,
        name: w.name,
        status: w.status,
        berlaku: toIso(w.berlaku),
        tanggalawal: toIso(w.tanggalawal),
        tanggal_mulai: toIso(w.tanggal_mulai)
      })),
      meta: formatMeta(options, total)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

async function getAuditLogsHandler(req, res) {
  try {
    const options = getQueryOptions(req);
    const result = await getAuditLogs(options);
    
    return res.json({
      success: true,
      data: result.rows.map((row) => ({
        Id: row.Id,
        UserId: row.UserId,
        Email: row.Email,
        Name: row.Name,
        Action: row.Action,
        EntityName: row.EntityName,
        Details: row.Details,
        IpAddress: row.IpAddress,
        UserAgent: row.UserAgent,
        CreatedAt: toIso(row.CreatedAt),
        last_login: row.last_login ? toIso(row.last_login) : null
      })),
      meta: formatMeta(options, result.total)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

async function getIndividualReportHandler(req, res) {
  const { periode_id, karyawan_id } = req.params;
  const format = req.query.format || "json";

  try {
    const periode = await getPeriodeById(Number(periode_id));
    if (!canAccessPeriodeForUser(req.user, periode)) {
      return res.status(403).json({ success: false, message: "Tidak boleh akses laporan lintas divisi" });
    }

    const kpisMeta = await getKpis(Number(periode_id));
    const kpis = kpisMeta.rows;
    const rawEvals = await getEvaluationsByPeriode(Number(periode_id));
    const userEvals = rawEvals.filter((e) => Number(e.KaryawanId) === Number(karyawan_id));

    const employees = await getEmployeesByIds([Number(karyawan_id)]);
    const employee = employees[0] || null;

    // Build data per KPI with real evaluation values (Realisasi)
    const data = kpis.map((k) => {
      const ev = userEvals.find((e) => Number(e.KpiId) === Number(k.Id));
      return {
        Kriteria: k.NamaKpi,
        Realisasi: ev ? ev.Realisasi : 0,
        Satuan: k.simbol || "",
        group_id: k.group_id || null,
        nama_grup: k.nama_grup || null,
        Target: k.Target || null
      };
    });

    // Group KPIs by group_id, preserving order
    const groupOrder = [];
    const groupMap = new Map();
    data.forEach((item) => {
      const gid = item.group_id || "ungrouped";
      if (!groupMap.has(gid)) {
        groupMap.set(gid, { name: item.nama_grup || "Lainnya", items: [] });
        groupOrder.push(gid);
      }
      groupMap.get(gid).items.push(item);
    });

    const summaryMeta = await getHasilAkhirByPeriode(Number(periode_id));
    const summary = summaryMeta.rows;
    const result = summary.find((s) => Number(s.KaryawanId) === Number(karyawan_id));

    // Fetch Signer Information cross-DB if result exists
    let createdByInfo = null;
    let approvedByInfo = null;

    if (result) {
      if (result.created_by) {
        const signers = await queryMitra(
          `SELECT e.name, j.name AS jabatan
           FROM users u
           LEFT JOIN employees e ON e.email = u.email
           LEFT JOIN jabatans j ON e.jabatan_id = j.id
           WHERE u.id = ?
           LIMIT 1`,
          [result.created_by]
        );
        createdByInfo = signers[0] || null;
      }
      if (result.approved_by) {
        const signers = await queryMitra(
          `SELECT e.name, j.name AS jabatan
           FROM users u
           LEFT JOIN employees e ON e.email = u.email
           LEFT JOIN jabatans j ON e.jabatan_id = j.id
           WHERE u.id = ?
           LIMIT 1`,
          [result.approved_by]
        );
        approvedByInfo = signers[0] || null;
      }
    }

    if (format === "pdf") {
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const PAGE_WIDTH = 595.28;
      const PAGE_HEIGHT = 841.89;
      const MARGIN_X = 50;
      const MARGIN_BOTTOM = 60;

      function ensureSpace(currentPage, yPosRef, needed) {
        let page = currentPage;
        if (yPosRef.value < MARGIN_BOTTOM + needed) {
          page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
          yPosRef.value = PAGE_HEIGHT - 50;
        }
        return page;
      }

      let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      const { height } = page.getSize();

      // --- Header section ---
      page.drawText("FORM PENILAIAN KARYAWAN", { x: MARGIN_X, y: height - 50, size: 16, font: fontBold });
      page.drawText(`Nama: ${employee?.name || "N/A"}`, { x: MARGIN_X, y: height - 80, size: 12, font });
      page.drawText(`NIK: ${employee?.nik || "N/A"}`, { x: MARGIN_X, y: height - 100, size: 12, font });
      page.drawText(`Periode: ${periode?.NamaPeriode || "N/A"} ${periode?.Tahun || ""}`, { x: MARGIN_X, y: height - 120, size: 12, font });

      let yPos = { value: height - 155 };
      const tableRight = PAGE_WIDTH - 50;
      const noX = MARGIN_X;
      const kriteriaX = MARGIN_X + 35;
      const nilaiX = tableRight - 80;
      const lineY = -5;

      // --- Grouped tables ---
      let globalIdx = 0;
      for (const gid of groupOrder) {
        const group = groupMap.get(gid);

        page = ensureSpace(page, yPos, 60);

        // Group header bar
        page.drawRectangle({
          x: noX, y: yPos.value - 3,
          width: tableRight - noX, height: 18,
          color: rgb(0.85, 0.85, 0.85),
          borderWidth: 0
        });
        page.drawText(group.name, { x: noX + 5, y: yPos.value, size: 12, font: fontBold });
        yPos.value -= 22;

        // Table header
        page.drawText("No", { x: noX + 5, y: yPos.value, size: 10, font: fontBold });
        page.drawText("Kriteria", { x: kriteriaX, y: yPos.value, size: 10, font: fontBold });
        page.drawText("Realisasi", { x: nilaiX, y: yPos.value, size: 10, font: fontBold });
        page.drawLine({ start: { x: noX, y: yPos.value + lineY }, end: { x: tableRight, y: yPos.value + lineY }, thickness: 1 });
        yPos.value -= 18;

        // Table rows
        for (const item of group.items) {
          globalIdx++;
          page = ensureSpace(page, yPos, 15);

          const kriteriaStr = String(item.Kriteria || "");
          const realisasiStr = String(item.Realisasi ?? 0);
          const satuanStr = String(item.Satuan || "");

          page.drawText(`${globalIdx}`, { x: noX + 12, y: yPos.value, size: 10, font });
          page.drawText(kriteriaStr, { x: kriteriaX, y: yPos.value, size: 10, font });
          page.drawText(`${realisasiStr} ${satuanStr}`.trim(), { x: nilaiX, y: yPos.value, size: 10, font });
          yPos.value -= 18;
        }

        // Bottom line for group table
        page.drawLine({ start: { x: noX, y: yPos.value + 10 }, end: { x: tableRight, y: yPos.value + 10 }, thickness: 1 });
        yPos.value -= 15;
      }

      // --- Hasil Akhir ---
      page = ensureSpace(page, yPos, 40);
      yPos.value -= 10;
      if (result) {
        const score = typeof result.NilaiOptimasi === "number" ? result.NilaiOptimasi.toFixed(4) : "0";
        page.drawText(`Hasil Akhir: ${score}`, { x: MARGIN_X, y: yPos.value, size: 11, font: fontBold });
        page.drawText(`Ranking: ${result.Ranking || "-"}`, { x: tableRight - 100, y: yPos.value, size: 11, font: fontBold });
      }

      yPos.value -= 50;

      // --- Footer / Signatures ---
      page = ensureSpace(page, yPos, 90);
      page.drawText("Mengetahui,", { x: MARGIN_X, y: yPos.value, size: 11, font });
      page.drawText("Disetujui Oleh,", { x: 380, y: yPos.value, size: 11, font });
      yPos.value -= 60;

      const creatorName = createdByInfo ? (createdByInfo.name || ".................................") : ".................................";
      const creatorJabatan = createdByInfo ? (createdByInfo.jabatan || "Kepala Divisi") : "Kepala Divisi";
      const approverName = approvedByInfo ? (approvedByInfo.name || ".................................") : ".................................";
      const approverJabatan = approvedByInfo ? (approvedByInfo.jabatan || "Pimpinan") : "Pimpinan";

      page.drawText(`( ${creatorName} )`, { x: MARGIN_X, y: yPos.value, size: 11, font });
      page.drawText(`( ${approverName} )`, { x: 380, y: yPos.value, size: 11, font });
      page.drawText(creatorJabatan, { x: MARGIN_X, y: yPos.value - 15, size: 10, font });
      page.drawText(approverJabatan, { x: 380, y: yPos.value - 15, size: 10, font });

      const pdfBytes = await pdfDoc.save();
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="Report_${employee?.name || "User"}.pdf"`);
      return res.end(Buffer.from(pdfBytes));
    }

    // JSON response
    await logActivity(req, "VIEW", "IndividualReport", { periodeId: Number(periode_id), karyawanId: Number(karyawan_id) });
    return res.json({
      success: true,
      metadata: {
        Nama: employee?.name || "N/A",
        NIK: employee?.nik || "N/A",
        Periode: periode?.NamaPeriode || "N/A",
        Tahun: periode?.Tahun || "N/A",
        DibuatOleh: createdByInfo ? `${createdByInfo.name} (${createdByInfo.jabatan || "Kepala Divisi"})` : "N/A",
        DisetujuiOleh: approvedByInfo ? `${approvedByInfo.name} (${approvedByInfo.jabatan || "Pimpinan"})` : "N/A",
        Status: result?.status || "Draft"
      },
      rincian: groupOrder.map((gid) => ({
        group_name: groupMap.get(gid).name,
        items: groupMap.get(gid).items
      })),
      kesimpulan: result
        ? {
            Ranking: result.Ranking,
            Skor: result.NilaiOptimasi,
            Status: result.status
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

    const kpisMeta = await getKpis(periodeId);
    const resultsMeta = await getHasilAkhirByPeriode(periodeId);
    const kpis = kpisMeta.rows;
    const results = resultsMeta.rows;
    const evaluations = await getEvaluationsByPeriode(periodeId);

    const employeeIds = results.map((r) => Number(r.KaryawanId));
    const employees = await getEmployeesByIds(employeeIds);
    const empMap = new Map(employees.map((e) => [Number(e.id), e]));

    // Evaluation map: KaryawanId -> KpiId -> Realisasi
    const evalMap = {};
    evaluations.forEach((ev) => {
      const kId = Number(ev.KaryawanId);
      if (!evalMap[kId]) evalMap[kId] = {};
      evalMap[kId][Number(ev.KpiId)] = ev.Realisasi ?? ev.Nilai ?? 0;
    });

    // Group KPIs by group_id, preserving order
    const groupOrder = [];
    const groupMap = new Map();
    kpis.forEach((k) => {
      const gid = k.group_id || "ungrouped";
      if (!groupMap.has(gid)) {
        groupMap.set(gid, { name: k.nama_grup || "Lainnya", kpis: [] });
        groupOrder.push(gid);
      }
      groupMap.get(gid).kpis.push(k);
    });

    const data = results.map((res) => {
      const emp = empMap.get(Number(res.KaryawanId));
      const row = {
        NIK: emp?.nik || "N/A",
        Nama: emp?.name || "N/A"
      };

      kpis.forEach((k) => {
        row[k.NamaKpi] = evalMap[Number(res.KaryawanId)]?.[Number(k.Id)] || 0;
      });

      row.Skor = res.NilaiOptimasi;
      row.Ranking = res.Ranking;
      return row;
    });

    await logActivity(req, "VIEW", "SummaryReport", { periodeId, format });

    if (format === "excel") {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Rekapitulasi", {
        views: [{ state: "frozen", ySplit: 2 }]
      });

      // Thin border definition
      const thinBorder = {
        top: { style: "thin" },
        bottom: { style: "thin" },
        left: { style: "thin" },
        right: { style: "thin" }
      };
      const noFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
      const groupFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
      const headerFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFED7D31" } };

      // --- Row 1: Group headers (merged across KPI columns) + fixed cols ---
      const fixedColCount = 3;
      worksheet.getCell(1, 1).value = "No";
      worksheet.getCell(1, 2).value = "NIK";
      worksheet.getCell(1, 3).value = "Nama";

      let colIdx = fixedColCount + 1;
      for (const gid of groupOrder) {
        const group = groupMap.get(gid);
        const startCol = colIdx;
        const endCol = colIdx + group.kpis.length - 1;
        if (group.kpis.length > 1) {
          worksheet.mergeCells(1, startCol, 1, endCol);
        }
        worksheet.getCell(1, startCol).value = group.name;
        colIdx = endCol + 1;
      }

      const skorCol = colIdx;
      const rankingCol = colIdx + 1;
      worksheet.getCell(1, skorCol).value = "Skor MOORA";
      worksheet.getCell(1, rankingCol).value = "Ranking";

      // Style Row 1 (group headers)
      for (let c = 1; c <= rankingCol; c++) {
        const cell = worksheet.getCell(1, c);
        cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.border = thinBorder;
        if (c <= fixedColCount || c >= skorCol) {
          cell.fill = headerFill;
        } else {
          cell.fill = groupFill;
        }
      }

      // --- Row 2: Individual KPI headers ---
      worksheet.getCell(2, 1).value = "No";
      worksheet.getCell(2, 2).value = "NIK";
      worksheet.getCell(2, 3).value = "Nama";

      colIdx = fixedColCount + 1;
      for (const gid of groupOrder) {
        const group = groupMap.get(gid);
        for (const kpi of group.kpis) {
          worksheet.getCell(2, colIdx).value = kpi.NamaKpi;
          colIdx++;
        }
      }

      worksheet.getCell(2, skorCol).value = "Skor";
      worksheet.getCell(2, rankingCol).value = "Ranking";

      // Style Row 2
      for (let c = 1; c <= rankingCol; c++) {
        const cell = worksheet.getCell(2, c);
        cell.font = { bold: true, size: 10 };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.border = thinBorder;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
      }

      // --- Data Rows ---
      data.forEach((row, idx) => {
        const rowNum = idx + 3; // data starts at row 3

        worksheet.getCell(rowNum, 1).value = idx + 1;
        worksheet.getCell(rowNum, 1).alignment = { horizontal: "center" };

        worksheet.getCell(rowNum, 2).value = row.NIK;
        worksheet.getCell(rowNum, 3).value = row.Nama;

        colIdx = fixedColCount + 1;
        for (const gid of groupOrder) {
          const group = groupMap.get(gid);
          for (const kpi of group.kpis) {
            worksheet.getCell(rowNum, colIdx).value = row[kpi.NamaKpi] || 0;
            worksheet.getCell(rowNum, colIdx).numFmt = "0.####";
            colIdx++;
          }
        }

        worksheet.getCell(rowNum, skorCol).value = row.Skor;
        worksheet.getCell(rowNum, skorCol).numFmt = "0.####";
        worksheet.getCell(rowNum, rankingCol).value = row.Ranking;
        worksheet.getCell(rowNum, rankingCol).alignment = { horizontal: "center" };

        // Apply borders to all data cells
        for (let c = 1; c <= rankingCol; c++) {
          worksheet.getCell(rowNum, c).border = thinBorder;
          worksheet.getCell(rowNum, c).font = { size: 10 };
          // Zebra striping
          if (idx % 2 === 0) {
            worksheet.getCell(rowNum, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
          }
        }
      });

      // Set column widths
      worksheet.getColumn(1).width = 5;   // No
      worksheet.getColumn(2).width = 16;  // NIK
      worksheet.getColumn(3).width = 28;  // Nama
      let ki = fixedColCount + 1;
      for (const gid of groupOrder) {
        const group = groupMap.get(gid);
        for (let j = 0; j < group.kpis.length; j++) {
          worksheet.getColumn(ki).width = 14;
          ki++;
        }
      }
      worksheet.getColumn(skorCol).width = 12;
      worksheet.getColumn(rankingCol).width = 10;

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

async function updateHasilReviewHandler(req, res) {
  const { id } = req.params;
  const { status, Catatan, prestasi, indisipliner, saran } = req.body;

  if (status && !["Draft", "Pending", "Reviewed", "Processed", "Locked"].includes(status)) {
    return res.status(400).json({ success: false, message: "Status tidak valid." });
  }

  let catatanObj;
  if (Catatan && typeof Catatan === "object") {
    catatanObj = {
      p: String(Catatan.p || Catatan.prestasi || "").trim(),
      i: String(Catatan.i || Catatan.indisipliner || "").trim(),
      s: String(Catatan.s || Catatan.saran || "").trim()
    };
  } else {
    catatanObj = {
      p: (prestasi || "").trim(),
      i: (indisipliner || "").trim(),
      s: (saran || "").trim()
    };
  }
  const catatanJson = JSON.stringify(catatanObj);

  const resultRows = await querySpk("SELECT PeriodeId FROM hasil_akhir WHERE Id = ? LIMIT 1", [id]);
  if (!resultRows.length) {
    return res.status(404).json({ success: false, message: "Data hasil tidak ditemukan" });
  }
  if (!(await assertPeriodNotLocked(res, resultRows[0]?.PeriodeId))) return;

  await querySpk(
    `UPDATE hasil_akhir 
     SET catatan = ?,
         status = COALESCE(?, status)
     WHERE Id = ?`,
    [catatanJson, status || null, id]
  );

  await logActivity(req, "REVIEW", "MooraResult", { Id: id, Status: status, Catatan: catatanObj });

  return res.json({ success: true, message: "Review berhasil disimpan" });
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
  getKpiGroupsHandler,
  createKpiGroupHandler,
  updateKpiGroupHandler,
  deleteKpiGroupHandler,
  getGroupComparisonsHandler,
  saveGroupComparisonsHandler,
  getAttributesHandler,
  createAttributeHandler,
  deleteAttributeHandler,
  getComparisonsHandler,
  inputComparisonHandler,
  calculateWeightsHandler,
  inputPenilaianHandler,
  calculateMooraHandler,
  getMooraResultHandler,
  updateHasilReviewHandler,
  getIndividualReportHandler,
  getSummaryReportHandler,
  getDepartmentsHandler,
  getEmployeesHandler,
  getWorkLocationsHandler,
  getAuditLogsHandler
};
