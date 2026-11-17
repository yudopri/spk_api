const assert = require("assert");
const {
  calculateAHP,
  calculateAchievement,
  buildMooraCoeffMap,
  scoreMooraChunk,
  validatePairwiseComparisons
} = require("../services/spkMath");

let passed = 0;
let failed = 0;
const rows = [];

function record(fungsi, jalur, input, expected, actual, ok) {
  if (ok) passed += 1; else failed += 1;
  rows.push({ fungsi, jalur, input, expected, actual, status: ok ? "Lulus" : "Gagal" });
}

function check(fungsi, jalur, input, expected, actual, ok) {
  record(fungsi, jalur, input, expected, actual, ok);
}

// ===== validatePairwiseComparisons() | P = 5, V(G) = 6 =====
{
  const r1 = validatePairwiseComparisons(
    [
      { KpiAId: 1, KpiBId: 2, Nilai: 3 },
      { KpiAId: 1, KpiBId: 3, Nilai: 5 },
      { KpiAId: 2, KpiBId: 3, Nilai: 2 }
    ],
    [1, 2, 3]
  );
  check("validatePairwiseComparisons()", "P1", "Perbandingan lengkap, ID valid, Nilai > 0", "{ valid: true }", JSON.stringify(r1), r1.valid === true);

  const r2 = validatePairwiseComparisons([{ KpiAId: 0, KpiBId: 2, Nilai: 3 }], [1, 2]);
  check("validatePairwiseComparisons()", "P2", "ID KPI tidak valid (0)", "valid:false, ID tidak valid", JSON.stringify(r2), r2.valid === false && /ID KPI/.test(r2.message));

  const r3 = validatePairwiseComparisons([{ KpiAId: 1, KpiBId: 2, Nilai: 0 }], [1, 2]);
  check("validatePairwiseComparisons()", "P3", "Nilai perbandingan = 0", "valid:false, nilai harus > 0", JSON.stringify(r3), r3.valid === false && /lebih besar dari 0/.test(r3.message));

  const r4 = validatePairwiseComparisons([{ KpiAId: 1, KpiBId: 1, Nilai: 2 }], [1, 2]);
  check("validatePairwiseComparisons()", "P4", "Nilai diagonal != 1 (a === b)", "valid:false, diagonal harus 1", JSON.stringify(r4), r4.valid === false && /Diagonal/.test(r4.message));

  const r5 = validatePairwiseComparisons([{ KpiAId: 1, KpiBId: 2, Nilai: 3 }], [1, 2, 3]);
  check("validatePairwiseComparisons()", "P5", "Matriks tidak lengkap (3 KPI, 1 pasangan)", "valid:false, belum lengkap", JSON.stringify(r5), r5.valid === false && /belum lengkap/.test(r5.message));
}

// ===== calculateAchievement() | P = 4, V(G) = 5 =====
{
  const r1 = calculateAchievement({ target: -5, realisasi: 10, tipe: "benefit" });
  check("calculateAchievement()", "P1", "Target tidak valid (-5)", "achievement 0, valid false", JSON.stringify(r1), r1.achievement === 0 && r1.valid === false);

  const r2 = calculateAchievement({ target: 5, realisasi: 0, tipe: "cost" });
  check("calculateAchievement()", "P2", "Cost dengan realisasi = 0", "achievement 200, valid true", JSON.stringify(r2), r2.achievement === 200 && r2.valid === true);

  const r3 = calculateAchievement({ target: 5, realisasi: 10, tipe: "cost" });
  check("calculateAchievement()", "P3", "Tipe cost", "achievement 50 (target/realisasi*100)", JSON.stringify(r3), Math.abs(r3.achievement - 50) < 1e-9 && r3.valid === true);

  const r4 = calculateAchievement({ target: 10, realisasi: 8, tipe: "benefit" });
  check("calculateAchievement()", "P4", "Tipe benefit", "achievement 80 (realisasi/target*100)", JSON.stringify(r4), Math.abs(r4.achievement - 80) < 1e-9 && r4.valid === true);

  const r5 = calculateAchievement({ target: 10, realisasi: Infinity, tipe: "benefit" });
  check("calculateAchievement()", "P5", "Hasil tidak hingga (realisasi = Infinity)", "achievement 0, valid false", JSON.stringify(r5), r5.achievement === 0 && r5.valid === false);
}

// ===== calculateAHP() | P = 6, V(G) = 7 =====
{
  const r1 = calculateAHP([], []);
  check("calculateAHP()", "P1", "Jumlah KPI = 0", "matrix [], weights [], cr 0", JSON.stringify({ m: r1.matrix.length, w: r1.weights.length, cr: r1.consistency.cr }), r1.matrix.length === 0 && r1.weights.length === 0 && r1.consistency.cr === 0);

  const kpis = [
    { Id: 1, NamaKpi: "A" },
    { Id: 2, NamaKpi: "B" },
    { Id: 3, NamaKpi: "C" }
  ];

  const r2 = calculateAHP(kpis, [{ KpiAId: 99, KpiBId: 1, Nilai: 3 }]);
  check("calculateAHP()", "P2", "KPI tidak ditemukan (ID 99)", "Perbandingan dilewati, matriks tetap 1", JSON.stringify(r2.matrix), r2.matrix.every((row) => row.every((v) => v === 1)));

  const r3 = calculateAHP(kpis, [{ KpiAId: 1, KpiBId: 1, Nilai: 7 }]);
  check("calculateAHP()", "P3", "KPI sama (diagonal)", "Nilai diagonal ditetapkan 1", JSON.stringify(r3.matrix), r3.matrix[0][0] === 1 && r3.matrix[1][1] === 1 && r3.matrix[2][2] === 1);

  const r4 = calculateAHP(kpis, [{ KpiAId: 1, KpiBId: 2, Nilai: 0 }]);
  check("calculateAHP()", "P4", "Nilai perbandingan = 0", "Dinormalisasi menjadi 1 (matrix[i][j]=1, matrix[j][i]=1)", JSON.stringify(r4.matrix), r4.matrix[0][1] === 1 && r4.matrix[1][0] === 1);

  const r5 = calculateAHP(kpis, [
    { KpiAId: 1, KpiBId: 2, Nilai: 1 },
    { KpiAId: 1, KpiBId: 3, Nilai: 3 },
    { KpiAId: 2, KpiBId: 3, Nilai: 3 }
  ]);
  check("calculateAHP()", "P5", "Matriks konsisten 3x3", "CI dihitung, CR <= 0.1, konsisten", `cr=${r5.consistency.cr.toFixed(4)}`, r5.consistency.cr <= 0.1 && r5.consistency.isConsistent === true && Math.abs(r5.weights.reduce((a, b) => a + b, 0) - 1) < 1e-6);

  const r6 = calculateAHP(kpis, [
    { KpiAId: 1, KpiBId: 2, Nilai: 9 },
    { KpiAId: 1, KpiBId: 3, Nilai: 1 / 9 },
    { KpiAId: 2, KpiBId: 3, Nilai: 9 }
  ]);
  check("calculateAHP()", "P6", "Matriks tidak konsisten", "CR terdeteksi > 0.1, tidak konsisten", `cr=${r6.consistency.cr.toFixed(4)}`, r6.consistency.cr > 0.1 && r6.consistency.isConsistent === false);

  const r7 = calculateAHP([{ Id: 1, NamaKpi: "A" }], []);
  check("calculateAHP()", "P7", "Jumlah KPI = 1 (RI = 0, CI = 0)", "CR = 0, bobot = [1]", `cr=${r7.consistency.cr}`, r7.consistency.cr === 0 && r7.weights[0] === 1);
}

// ===== buildMooraCoeffMap() | P = 3, V(G) = 4 =====
{
  const kpisNoGroup = [{ Id: 1, BobotAhp: 0.5, Tipe: "benefit", group_id: null }];
  const kpisGroup = [
    { Id: 1, BobotAhp: 0.5, Tipe: "benefit", group_id: 10 },
    { Id: 2, BobotAhp: 1.0, Tipe: "cost", group_id: 20 }
  ];

  const r1 = buildMooraCoeffMap(kpisNoGroup, { 1: 2 }, {});
  check("buildMooraCoeffMap()", "P1", "KPI tanpa grup (group_id null)", "groupWeight = 1, global = bobot AHP", JSON.stringify(r1[1]), r1[1].groupWeight === 1 && Math.abs(r1[1].globalWeight - 0.5) < 1e-9);

  const r2 = buildMooraCoeffMap(kpisGroup, { 1: 2, 2: 3 }, { 10: 0.6, 20: 0.4 });
  check("buildMooraCoeffMap()", "P2", "KPI dengan grup", "groupWeight diambil dari map (0.6 / 0.4)", JSON.stringify(r2), Math.abs(r2[1].groupWeight - 0.6) < 1e-9 && Math.abs(r2[2].groupWeight - 0.4) < 1e-9);

  const r3 = buildMooraCoeffMap(kpisGroup, { 1: 2, 2: 3 }, { 10: 0.6, 20: 0.4 });
  check("buildMooraCoeffMap()", "P3", "Tipe benefit vs cost", "jenis benefit / cost", JSON.stringify([r3[1].jenis, r3[2].jenis]), r3[1].jenis === "benefit" && r3[2].jenis === "cost");

  const r4 = buildMooraCoeffMap([{ Id: 7, BobotAhp: 0.8, Tipe: "Benefit", group_id: 99 }], {}, {});
  check("buildMooraCoeffMap()", "P4", "Group weight map kosong & tipe huruf besar", "groupWeight = 0 (default), jenis benefit (lowercase)", JSON.stringify(r4[7]), r4[7].groupWeight === 0 && r4[7].jenis === "benefit");
}

// ===== scoreMooraChunk() | P = 3, V(G) = 4 =====
{
  const coeffMap = {
    1: { weight: 0.5, denominator: 2, jenis: "benefit" },
    2: { weight: 0.3, denominator: 4, jenis: "cost" }
  };

  const r1 = scoreMooraChunk([], coeffMap);
  check("scoreMooraChunk()", "P1", "Evaluasi kosong (loop 0 iterasi)", "yiByEmployee / detailByEmployee kosong", JSON.stringify(r1), Object.keys(r1.yiByEmployee).length === 0 && Object.keys(r1.detailByEmployee).length === 0);

  const r2 = scoreMooraChunk([{ KpiId: 999, KaryawanId: 1, Achievement: 80 }], coeffMap);
  check("scoreMooraChunk()", "P2", "Koefisien tidak tersedia (KpiId 999)", "Evaluasi dilewati, hasil kosong", JSON.stringify(r2), Object.keys(r2.yiByEmployee).length === 0);

  const r3 = scoreMooraChunk([{ KpiId: 1, KaryawanId: 10, Achievement: 80, Realisasi: 40 }], coeffMap);
  check("scoreMooraChunk()", "P3", "Evaluasi pertama untuk karyawan (detail dibuat)", "yi = (80/2)*0.5 = 20; detail 1 item", JSON.stringify(r3), Math.abs(r3.yiByEmployee[10] - 20) < 1e-9 && r3.detailByEmployee[10].length === 1);

  const r4 = scoreMooraChunk([
    { KpiId: 1, KaryawanId: 10, Achievement: 80, Realisasi: 40 },
    { KpiId: 2, KaryawanId: 10, Achievement: 60, Realisasi: 30 }
  ], coeffMap);
  check("scoreMooraChunk()", "P4", "Evaluasi kedua karyawan sama (akumulasi Yi)", "yi = 20 + (60/4)*0.3 = 24.5; detail 2 item", JSON.stringify(r4), Math.abs(r4.yiByEmployee[10] - 24.5) < 1e-9 && r4.detailByEmployee[10].length === 2);
}

// ===== Rekapitulasi =====
console.log("\nHASIL PENGUJIAN WHITE BOX");
console.log("=".repeat(110));
for (const r of rows) {
  console.log(`${r.fungsi}\t${r.jalur}\t${r.actual}\t${r.status}`);
}
console.log("=".repeat(110));
console.log(`Total: ${passed + failed} kasus | Lulus: ${passed} | Gagal: ${failed}`);
if (failed > 0) process.exit(1);
