const math = require("mathjs");

const RI_TABLE = {
  1: 0,
  2: 0,
  3: 0.58,
  4: 0.9,
  5: 1.12,
  6: 1.24,
  7: 1.32,
  8: 1.41,
  9: 1.45,
  10: 1.49
};

function powerIteration(matrix, maxIter = 1000, tolerance = 1e-9) {
  const n = matrix.length;
  let vector = Array(n).fill(1 / n);

  for (let i = 0; i < maxIter; i += 1) {
    const next = math.multiply(matrix, vector);
    const sum = math.sum(next);
    const normalized = next.map((x) => x / (sum || 1));

    const diff = math.max(math.abs(math.subtract(normalized, vector)));
    vector = normalized;
    if (diff < tolerance) break;
  }

  return vector;
}

function normalizePairwiseMatrix(matrix) {
  const n = matrix.length;
  const columnSums = Array.from({ length: n }, (_, col) =>
    matrix.reduce((sum, row) => sum + Number(row[col] || 0), 0)
  );

  return matrix.map((row) =>
    row.map((value, col) => {
      const denom = columnSums[col] || 1;
      return Number(value) / denom;
    })
  );
}

function validatePairwiseComparisons(comparisons = [], expectedIds = []) {
  const ids = Array.from(new Set(expectedIds.map((id) => Number(id)).filter(Number.isFinite)));
  const pairKey = (a, b) => `${Math.min(a, b)}:${Math.max(a, b)}`;
  const seen = new Set();

  for (const item of comparisons) {
    const a = Number(item.KpiAId);
    const b = Number(item.KpiBId);
    const value = Number(item.Nilai);

    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
      return { valid: false, message: "ID KPI pada perbandingan tidak valid" };
    }
    if (!Number.isFinite(value) || value <= 0) {
      return { valid: false, message: "Nilai perbandingan harus lebih besar dari 0" };
    }
    if (a === b && value !== 1) {
      return { valid: false, message: "Diagonal matriks harus bernilai 1" };
    }

    seen.add(pairKey(a, b));
  }

  const expectedPairs = (ids.length * (ids.length - 1)) / 2;
  if (ids.length > 1 && seen.size < expectedPairs) {
    return { valid: false, message: "Matriks perbandingan belum lengkap" };
  }

  return { valid: true };
}

function calculateAchievement({ target, realisasi, tipe }) {
  const targetValue = Number(target);
  const realisasiValue = Number(realisasi);
  const normalizedType = String(tipe || "benefit").toLowerCase();

  if (!Number.isFinite(targetValue) || targetValue <= 0) {
    return { achievement: 0, valid: false, message: "Target KPI tidak valid" };
  }

  if (!Number.isFinite(realisasiValue) || realisasiValue < 0) {
    return { achievement: 0, valid: false, message: "Realisasi KPI tidak valid" };
  }

  if (realisasiValue === 0) {
    return {
      achievement: 0,
      valid: false,
      message: "Realisasi KPI bernilai 0 sehingga achievement tidak dapat dihitung"
    };
  }

  const achievement =
    normalizedType === "cost"
      ? (targetValue / realisasiValue) * 100
      : (realisasiValue / targetValue) * 100;

  return {
    achievement,
    valid: Number.isFinite(achievement) && achievement >= 0,
    message: null
  };
}

function calculateAHP(kpis, comparisons) {
  const n = kpis.length;
  if (n === 0) {
    return { matrix: [], weights: [], consistency: { ci: 0, cr: 0, lambdaMax: 0, isConsistent: true } };
  }

  const matrix = Array.from({ length: n }, () => Array(n).fill(1));
  const kpiIndex = new Map(kpis.map((kpi, idx) => [kpi.Id, idx]));

  comparisons.forEach((c) => {
    const i = kpiIndex.get(c.KpiAId);
    const j = kpiIndex.get(c.KpiBId);
    if (i === undefined || j === undefined) return;

    const value = Number(c.Nilai) || 1;
    if (i === j) {
      matrix[i][j] = 1;
      return;
    }
    matrix[i][j] = value;
    matrix[j][i] = value === 0 ? 1 : 1 / value;
  });

  const normalizedMatrix = normalizePairwiseMatrix(matrix);
  const weights = normalizedMatrix.map((row) => math.mean(row));
  const weightedSum = math.multiply(matrix, weights);
  const lambdaVector = weightedSum.map((v, idx) => v / (weights[idx] || 1));
  const lambdaMax = math.mean(lambdaVector);
  const ci = n > 1 ? (lambdaMax - n) / (n - 1) : 0;
  const ri = RI_TABLE[n] || 1.49;
  const cr = ri === 0 ? 0 : ci / ri;

  return {
    matrix,
    normalizedMatrix,
    weights,
    consistency: {
      ci,
      cr,
      lambdaMax,
      isConsistent: cr <= 0.1
    }
  };
}

function buildMooraCoeffMap(kpis, denominatorMap, groupWeightMap = {}) {
  const coeff = {};
  for (const kpi of kpis) {
    const denominator = denominatorMap[kpi.Id] || 1;
    const kpiWeight = Number(kpi.BobotAhp || 0);
    const groupWeight = Number(groupWeightMap[kpi.group_id] || 1);
    const combinedWeight = kpiWeight * groupWeight;
    coeff[kpi.Id] = {
      weight: combinedWeight,
      kpiWeight,
      groupWeight,
      denominator: denominator || 1,
      jenis: String(kpi.Tipe || "benefit").toLowerCase() === "benefit" ? "benefit" : "cost"
    };
  }
  return coeff;
}

function scoreMooraChunk(evaluations, coeffMap) {
  const yiByEmployee = {};
  const detailByEmployee = {};
  for (const ev of evaluations) {
    const coeff = coeffMap[ev.KpiId];
    if (!coeff) continue;
    const current = yiByEmployee[ev.KaryawanId] || 0;
    const baseValue = Number(ev.Achievement ?? ev.achievement ?? ev.Nilai ?? ev.Realisasi ?? 0);
    const normalized = baseValue / (coeff.denominator || 1);
    const weighted = normalized * (coeff.weight || 0);
    const signedWeighted = coeff.jenis === "cost" ? -weighted : weighted;
    yiByEmployee[ev.KaryawanId] = current + signedWeighted;
    if (!detailByEmployee[ev.KaryawanId]) detailByEmployee[ev.KaryawanId] = [];
    detailByEmployee[ev.KaryawanId].push({
      KpiId: ev.KpiId,
      group_id: ev.group_id || null,
      nama_grup: ev.nama_grup || null,
      bobot_grup: Number(ev.bobot_grup || 1),
      NilaiAsli: baseValue,
      NilaiNormalisasi: normalized,
      NilaiTerbobot: weighted,
      Jenis: coeff.jenis
    });
  }
  return { yiByEmployee, detailByEmployee };
}

/**
 * Solve AHP matrix for a set of elements
 * @param {Array<[number, number, number]>} comparisons - [[idA, idB, value], ...]
 * @param {Array<number>} elementIds - Array of unique IDs
 * @returns {{weights: Object, cr: number}}
 */
function solveAhpMatrix(comparisons, elementIds) {
  const n = elementIds.length;
  if (n === 0) return { weights: {}, cr: 0 };
  if (n === 1) return { weights: { [elementIds[0]]: 1.0 }, cr: 0 };

  const matrix = Array.from({ length: n }, () => Array(n).fill(1));
  const idToIndex = {};
  elementIds.forEach((id, i) => {
    idToIndex[id] = i;
  });

  comparisons.forEach(([idA, idB, val]) => {
    const i = idToIndex[idA];
    const j = idToIndex[idB];
    if (i !== undefined && j !== undefined) {
      matrix[i][j] = val;
      matrix[j][i] = val === 0 ? 1 : 1 / val;
    }
  });

  const weights = powerIteration(matrix);

  // Consistency Ratio
  const weightedSum = math.multiply(matrix, weights);
  const lambdaVector = weightedSum.map((v, idx) => v / (weights[idx] || 1));
  const lambdaMax = math.mean(lambdaVector);
  const ci = (lambdaMax - n) / (n - 1);
  const ri = RI_TABLE[n] || 1.49;
  const cr = ri === 0 ? 0 : ci / ri;

  const weightResult = {};
  elementIds.forEach((id, idx) => {
    weightResult[id] = weights[idx];
  });

  return { weights: weightResult, cr: cr };
}

module.exports = {
  calculateAHP,
  calculateAchievement,
  normalizePairwiseMatrix,
  validatePairwiseComparisons,
  buildMooraCoeffMap,
  scoreMooraChunk,
  solveAhpMatrix
};
