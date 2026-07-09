const { querySpk } = require("../config/db");
const { getKpis, getEvaluationsByPeriode, getEmployeesByIds } = require("../models/spkModel");
const { calculateAHP, validatePairwiseComparisons, buildMooraCoeffMap, scoreMooraChunk } = require("../services/spkMath");

async function calculateAhpLive(req, res) {
  try {
    const { criteriaIds, comparisons } = req.body || {};

    if (!Array.isArray(criteriaIds) || criteriaIds.length === 0) {
      return res.status(400).json({ success: false, message: "criteriaIds wajib diisi" });
    }
    if (!Array.isArray(comparisons) || comparisons.length === 0) {
      return res.status(400).json({ success: false, message: "comparisons wajib diisi" });
    }

    const validation = validatePairwiseComparisons(
      comparisons.map((c) => ({ KpiAId: c.a, KpiBId: c.b, Nilai: c.value })),
      criteriaIds
    );
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.message });
    }

    const kpis = criteriaIds.map((id) => ({ Id: id }));
    const adaptComps = comparisons.map((c) => ({
      KpiAId: c.a,
      KpiBId: c.b,
      Nilai: c.value
    }));

    const result = calculateAHP(kpis, adaptComps);
    if (!result.consistency.isConsistent) {
      return res.status(400).json({
        success: false,
        message: "Matriks AHP tidak konsisten. Silakan input ulang.",
        consistency: result.consistency
      });
    }

    return res.json({
      success: true,
      cr: result.consistency.cr,
      isConsistent: result.consistency.isConsistent,
      draftWeights: criteriaIds.map((id, idx) => ({
        id,
        weight: result.weights[idx]
      })),
      consistencyDetails: result.consistency,
      normalizedMatrix: result.normalizedMatrix
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

async function validateAhpMatrix(req, res) {
  try {
    const { comparisons } = req.body || {};
    if (!Array.isArray(comparisons) || comparisons.length === 0) {
      return res.status(400).json({ success: false, message: "Comparisons array is required." });
    }

    const criteriaIds = [...new Set(comparisons.flatMap((c) => [c.id_a, c.id_b]))];
    const validation = validatePairwiseComparisons(
      comparisons.map((c) => ({ KpiAId: c.id_a, KpiBId: c.id_b, Nilai: c.nilai })),
      criteriaIds
    );
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.message });
    }

    const kpis = criteriaIds.map((id) => ({ Id: id }));
    const adaptComps = comparisons.map((c) => ({
      KpiAId: c.id_a,
      KpiBId: c.id_b,
      Nilai: c.nilai
    }));
    const result = calculateAHP(kpis, adaptComps);

    return res.json({
      success: true,
      cr: result.consistency.cr,
      isConsistent: result.consistency.isConsistent
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

async function getRankingByPeriod(req, res) {
  try {
    const periodeId = Number(req.params.periode_id);
    if (!Number.isFinite(periodeId) || periodeId <= 0) {
      return res.status(400).json({ success: false, message: "periode_id tidak valid" });
    }

    const groupId = req.query.group_id ? Number(req.query.group_id) : null;

    const kpisMeta = await getKpis(periodeId, {}, groupId);
    const kpis = kpisMeta.rows;
    const rows = await getEvaluationsByPeriode(periodeId, groupId);
    const employeeIds = [...new Set(rows.map((row) => Number(row.KaryawanId)))];

    if (kpis.length === 0 || employeeIds.length === 0) {
      return res.status(404).json({ success: false, message: "Data KPI atau penilaian tidak ditemukan" });
    }

    const denominatorQuery = `
      SELECT p.KpiId, SQRT(SUM(p.Achievement * p.Achievement)) AS denominator
      FROM penilaians p
      INNER JOIN kpis k ON k.Id = p.KpiId
      WHERE p.PeriodeId = ?
      ${groupId ? "AND k.group_id = ?" : ""}
      GROUP BY p.KpiId
    `;
    const denominatorParams = groupId ? [periodeId, groupId] : [periodeId];
    const denominatorRows = await querySpk(denominatorQuery, denominatorParams);

    const denominatorMap = {};
    denominatorRows.forEach((row) => {
      denominatorMap[row.KpiId] = Number(row.denominator) || 1;
    });

    const coeffMap = buildMooraCoeffMap(kpis, denominatorMap);
    const partial = scoreMooraChunk(rows, coeffMap);

    const employees = await getEmployeesByIds(employeeIds);
    const employeeMap = new Map(employees.map((emp) => [Number(emp.id), emp]));

    const ranked = Object.entries(partial.yiByEmployee)
      .map(([employeeId, yi]) => {
        const employee = employeeMap.get(Number(employeeId));
        return {
          employeeId: Number(employeeId),
          employeeName: employee?.name || null,
          yi: Number(yi),
          detail: partial.detailByEmployee[employeeId] || []
        };
      })
      .sort((a, b) => b.yi - a.yi)
      .map((item, index) => ({ ...item, rank: index + 1 }));

    return res.json({
      success: true,
      periode_id: periodeId,
      data: ranked
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

module.exports = {
  calculateAhpLive,
  validateAhpMatrix,
  getRankingByPeriod
};
