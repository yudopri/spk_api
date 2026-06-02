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
 * Validate AHP Matrix without saving to database.
 * Used for real-time consistency feedback (CR).
 * POST /api/spk/ahp/validate-matrix
 */
async function validateAhpMatrix(req, res) {
  try {
    const { comparisons } = req.body; // [{id_a, id_b, nilai}, ...]

    if (!comparisons || !Array.isArray(comparisons) || comparisons.length === 0) {
      return res.status(400).json({ success: false, message: "Comparisons array is required." });
    }

    // Extract unique IDs
    const criteriaIds = [...new Set(comparisons.flatMap(c => [c.id_a, c.id_b]))];

    // Adapt input to match spkMath.calculateAHP expectations
    const kpis = criteriaIds.map(id => ({ Id: id }));
    const adaptComps = comparisons.map(c => ({
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
    // Joining with kpi_masters to get names for the details
    const kpiSnapshots = await querySpk(
      `SELECT kp.id, kp.kpi_master_id, kp.bobot_ahp, km.nama_kriteria 
       FROM kpi_periodes kp
       JOIN kpi_masters km ON kp.kpi_master_id = km.id
       WHERE kp.periode_id = ? AND kp.status_aktif = TRUE`,
      [periode_id]
    );

    if (kpiSnapshots.length === 0) {
      return res.status(404).json({ success: false, message: "No active KPIs found for this period." });
    }

    // Map weights and names for easy access
    const weightMap = {};
    kpiSnapshots.forEach(k => {
      weightMap[k.id] = {
        weight: parseFloat(k.bobot_ahp || 0),
        nama: k.nama_kriteria
      };
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
          nilai_akhir: 0, 
          nilai_optimasi: 0, // Align with hasil_akhir table naming
          details: []
        };
      }
      
      const kpiInfo = weightMap[ev.kpi_periode_id] || { weight: 0, nama: "Unknown" };
      const weight = kpiInfo.weight;
      const score = parseFloat(ev.nilai_karyawan || 0);
      const weightedScore = score * weight;
      
      rankingMap[ev.karyawan_id].totalScore += weightedScore;
      rankingMap[ev.karyawan_id].details.push({
        kpi_periode_id: ev.kpi_periode_id,
        nama_kriteria: kpiInfo.nama,
        score: score,
        weight: weight,
        weightedScore: weightedScore
      });
    });

    // 4. Sort by Score descending and finalize nilai_akhir/nilai_optimasi
    const finalRanking = Object.values(rankingMap).map(item => {
      // Round to 4 decimal places for cleanliness
      item.totalScore = Math.round(item.totalScore * 10000) / 10000;
      item.nilai_akhir = item.totalScore;
      item.nilai_optimasi = item.totalScore;
      return item;
    }).sort((a, b) => b.totalScore - a.totalScore);

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
  validateAhpMatrix,
  getRankingByPeriod
};
