const assert = require("assert");
const { calculateAHP, calculateAchievement, buildMooraCoeffMap, scoreMooraChunk } = require("../services/spkMath");

function almostEqual(a, b, eps = 1e-6) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

function runAHPTest() {
  const kpis = [
    { Id: 1, NamaKpi: "Kehadiran" },
    { Id: 2, NamaKpi: "SOP" },
    { Id: 3, NamaKpi: "Komunikasi" }
  ];

  const comparisons = [
    { KpiAId: 1, KpiBId: 2, Nilai: 1 },
    { KpiAId: 1, KpiBId: 3, Nilai: 3 },
    { KpiAId: 2, KpiBId: 3, Nilai: 3 }
  ];

  const result = calculateAHP(kpis, comparisons);
  const sumWeights = result.weights.reduce((acc, val) => acc + val, 0);
  assert(almostEqual(sumWeights, 1), "AHP weights must sum to 1");
  assert(result.consistency.cr <= 0.1, "AHP consistency ratio must be <= 0.10");

  return result;
}

function runAchievementTest() {
  const cases = [
    { target: 98, realisasi: 94, tipe: "benefit", expected: 95.91836734693877 },
    { target: 5, realisasi: 4, tipe: "benefit", expected: 80 },
    { target: 5, realisasi: 5, tipe: "benefit", expected: 100 }
  ];

  for (const item of cases) {
    const result = calculateAchievement(item);
    assert(almostEqual(result.achievement, item.expected), "Achievement formula mismatch");
  }
}

function runMooraTest() {
  const kpis = [
    { Id: 1, BobotAhp: 0.7, Tipe: "benefit", group_id: 10 },
    { Id: 2, BobotAhp: 0.3, Tipe: "benefit", group_id: 10 },
    { Id: 3, BobotAhp: 1.0, Tipe: "benefit", group_id: 20 }
  ];

  const groupWeightMap = { 10: 0.6, 20: 0.4 };
  const denominatorMap = {
    1: Math.sqrt(95.91836734693877 ** 2 + 100 ** 2 + 97.95918367346938 ** 2),
    2: Math.sqrt(80 ** 2 + 100 ** 2 + 80 ** 2),
    3: Math.sqrt(80 ** 2 + 80 ** 2 + 80 ** 2)
  };

  const coeffMap = buildMooraCoeffMap(kpis, denominatorMap, groupWeightMap);
  assert(almostEqual(coeffMap[1].globalWeight, 0.42), "Global weight KPI 1 mismatch");
  assert(almostEqual(coeffMap[2].globalWeight, 0.18), "Global weight KPI 2 mismatch");
  assert(almostEqual(coeffMap[3].globalWeight, 0.4), "Global weight KPI 3 mismatch");
  assert(almostEqual(coeffMap[1].globalWeight + coeffMap[2].globalWeight + coeffMap[3].globalWeight, 1), "Global weights must sum to 1");

  const rows = [
    { KaryawanId: 1, KpiId: 1, Achievement: 95.91836734693877 },
    { KaryawanId: 1, KpiId: 2, Achievement: 80 },
    { KaryawanId: 1, KpiId: 3, Achievement: 80 },
    { KaryawanId: 2, KpiId: 1, Achievement: 100 },
    { KaryawanId: 2, KpiId: 2, Achievement: 100 },
    { KaryawanId: 2, KpiId: 3, Achievement: 80 },
    { KaryawanId: 3, KpiId: 1, Achievement: 97.95918367346938 },
    { KaryawanId: 3, KpiId: 2, Achievement: 80 },
    { KaryawanId: 3, KpiId: 3, Achievement: 80 }
  ];

  const { yiByEmployee, detailByEmployee } = scoreMooraChunk(rows, coeffMap);
  assert(detailByEmployee[1].every((d) => d.NilaiTerbobot <= d.NilaiAsli), "Weighted value should not exceed unweighted value");
  assert(yiByEmployee[2] > yiByEmployee[1], "Employee 2 should rank above Employee 1");
  assert(yiByEmployee[3] > yiByEmployee[1], "Employee 3 should rank above Employee 1");

  return { yiByEmployee, coeffMap };
}

function main() {
  runAchievementTest();
  const ahp = runAHPTest();
  const moora = runMooraTest();

  // eslint-disable-next-line no-console
  console.log("Smoke test passed");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    ahp: {
      weights: ahp.weights,
      consistency: ahp.consistency
    },
    moora
  }, null, 2));
}

main();
