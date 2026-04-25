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
    matrix[i][j] = value;
    matrix[j][i] = value === 0 ? 1 : 1 / value;
  });

  const weights = powerIteration(matrix);
  const weightedSum = math.multiply(matrix, weights);
  const lambdaVector = weightedSum.map((v, idx) => v / (weights[idx] || 1));
  const lambdaMax = math.mean(lambdaVector);
  const ci = n > 1 ? (lambdaMax - n) / (n - 1) : 0;
  const ri = RI_TABLE[n] || 1.49;
  const cr = ri === 0 ? 0 : ci / ri;

  return {
    matrix,
    weights,
    consistency: {
      ci,
      cr,
      lambdaMax,
      isConsistent: cr <= 0.1
    }
  };
}

function buildMooraCoeffMap(kpis, denominatorMap) {
  const coeff = {};
  for (const kpi of kpis) {
    const denominator = denominatorMap[kpi.Id] || 1;
    const weight = Number(kpi.BobotAhp || 0);
    const sign = String(kpi.Tipe || "benefit").toLowerCase() === "benefit" ? 1 : -1;
    coeff[kpi.Id] = (weight * sign) / (denominator || 1);
  }
  return coeff;
}

function scoreMooraChunk(evaluations, coeffMap) {
  const yiByEmployee = {};
  for (const ev of evaluations) {
    const coeff = coeffMap[ev.KpiId] || 0;
    const current = yiByEmployee[ev.KaryawanId] || 0;
    yiByEmployee[ev.KaryawanId] = current + Number(ev.Nilai || 0) * coeff;
  }
  return yiByEmployee;
}

module.exports = {
  calculateAHP,
  buildMooraCoeffMap,
  scoreMooraChunk
};
