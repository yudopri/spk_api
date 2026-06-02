const { querySpk } = require("../config/db");
const { calculateAHP } = require("../services/spkMath");

/**
 * Controller for AHP and Ranking logic as per Senior Developer requirements.
 */

/**
 * 3. Endpoint Hitung AHP & Live CR
 * POST /api/ahp/calculate-cr
 * Input Body: { criteriaIds: [1, 2, 3], comparisons: [{ a: 1, b: 2, value: 3 }, ...] }
 */
async function calculateAhpLive(req, res) {
  try {
    const { criteriaIds, comparisons } = req.body;

    if (!criteriaIds || !Array.isArray(criteriaIds) || criteriaIds.length === 0) {
      return res.status(400).json({ success: false, message: "criteriaIds is required and must be an array." });
    }

    // Adapt input to match spkMath.calculateAHP expectations
    const kpis = criteriaIds.map(id => ({ Id: id }));
    const adaptComps = comparisons.map(c => ({
      KpiAId: c.a,
      KpiBId: c.b,
      Nilai: c.value
    }));

    const result = calculateAHP(kpis, adaptComps);

    return res.json({
      success: true,
      cr: result.consistency.cr,
      isConsistent: result.consistency.isConsistent,
      draftWeights: criteriaIds.map((id, idx) => ({
        id: id,
        weight: result.weights[idx]
      })),
      consistencyDetails: result.consistency
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

/**
 * 4. Endpoint Perankingan
 * GET /api/ranking/:periode_id
 * Executes final ranking based on (Decision Matrix * KPI_Periode Weights)
 */
async function getRankingByPeriod(req, res) {
  try {
    const { periode_id } = req.params;

    // 1. Get KPI Snapshot for this period (Weights)
    const kpiSnapshots = await querySpk(
      "SELECT id, kpi_master_id, bobot_ahp FROM kpi_periodes WHERE periode_id = ? AND status_aktif = TRUE",
      [periode_id]
    );

    if (kpiSnapshots.length === 0) {
      return res.status(404).json({ success: false, message: "No active KPIs found for this period." });
    }

    // Map weights for easy access
    const weightMap = {};
    kpiSnapshots.forEach(k => {
      weightMap[k.id] = parseFloat(k.bobot_ahp);
    });

    // 2. Get All Evaluations for this period
    // Join with employees to get names
    const evaluations = await querySpk(
      `SELECT p.karyawan_id, e.nama as nama_karyawan, p.kpi_periode_id, p.nilai_karyawan 
       FROM penilaians p
       JOIN employees e ON p.karyawan_id = e.id
       WHERE p.kpi_periode_id IN (?)`,
      [kpiSnapshots.map(k => k.id)]
    );

    // 3. Group by Employee and Calculate Final Score
    const rankingMap = {};

    evaluations.forEach(ev => {
      if (!rankingMap[ev.karyawan_id]) {
        rankingMap[ev.karyawan_id] = {
          id: ev.karyawan_id,
          nama: ev.nama_karyawan,
          totalScore: 0,
          details: []
        };
      }
      
      const weight = weightMap[ev.kpi_periode_id] || 0;
      const weightedScore = parseFloat(ev.nilai_karyawan) * weight;
      
      rankingMap[ev.karyawan_id].totalScore += weightedScore;
      rankingMap[ev.karyawan_id].details.push({
        kpi_periode_id: ev.kpi_periode_id,
        score: ev.nilai_karyawan,
        weight: weight,
        weightedScore: weightedScore
      });
    });

    // 4. Sort by Score descending
    const finalRanking = Object.values(rankingMap).sort((a, b) => b.totalScore - a.totalScore);

    // Add rank number
    finalRanking.forEach((item, index) => {
      item.rank = index + 1;
    });

    return res.json({
      success: true,
      periode_id: parseInt(periode_id),
      data: finalRanking
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

module.exports = {
  calculateAhpLive,
  getRankingByPeriod
};
