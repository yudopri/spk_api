const { calculateAHP, buildMooraCoeffMap, scoreMooraChunk } = require("../services/spkMath");

function runAHPTest() {
  const kpis = [
    { Id: 1, NamaKpi: "Disiplin" },
    { Id: 2, NamaKpi: "Kualitas" },
    { Id: 3, NamaKpi: "Produktivitas" }
  ];

  const comparisons = [
    { KpiAId: 1, KpiBId: 2, Nilai: 1 / 3 },
    { KpiAId: 1, KpiBId: 3, Nilai: 1 / 5 },
    { KpiAId: 2, KpiBId: 3, Nilai: 1 / 2 }
  ];

  const result = calculateAHP(kpis, comparisons);
  const sumWeights = result.weights.reduce((acc, val) => acc + val, 0);
  if (Math.abs(sumWeights - 1) > 0.00001) {
    throw new Error("AHP weights are not normalized");
  }

  return {
    weights: result.weights,
    consistency: result.consistency
  };
}

function runMooraTest() {
  const kpis = [
    { Id: 1, BobotAhp: 0.5, Tipe: "benefit" },
    { Id: 2, BobotAhp: 0.5, Tipe: "cost" }
  ];
  const denominatorMap = { 1: 10, 2: 10 };
  const coeffMap = buildMooraCoeffMap(kpis, denominatorMap);

  const chunk = [
    { KaryawanId: 101, KpiId: 1, Nilai: 8 },
    { KaryawanId: 101, KpiId: 2, Nilai: 3 },
    { KaryawanId: 102, KpiId: 1, Nilai: 6 },
    { KaryawanId: 102, KpiId: 2, Nilai: 5 }
  ];

  const yi = scoreMooraChunk(chunk, coeffMap);
  if (!(yi[101] > yi[102])) {
    throw new Error("MOORA score ordering unexpected");
  }

  return yi;
}

function main() {
  const ahp = runAHPTest();
  const moora = runMooraTest();

  // eslint-disable-next-line no-console
  console.log("Smoke test passed");
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ahp, moora }, null, 2));
}

main();
