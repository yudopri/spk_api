const express = require("express");
const {
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
  getComparisonsHandler,
  inputComparisonHandler,
  calculateWeightsHandler,
  inputPenilaianHandler,
  calculateMooraHandler,
  getMooraResultHandler,
  updateHasilReviewHandler,
  getIndividualReportHandler,
  getSummaryReportHandler
} = require("../controllers/spkController");
const { authenticateToken } = require("../middlewares/authMiddleware");
const { hasPermission } = require("../middlewares/permissionMiddleware");

const router = express.Router();

router.get("/periode", authenticateToken, hasPermission("periode_view"), getPeriodeHandler);
router.post("/periode", authenticateToken, hasPermission("periode_manage"), createPeriodeHandler);
router.put("/periode/:id", authenticateToken, hasPermission("periode_manage"), updatePeriodeHandler);
router.delete("/periode/:id", authenticateToken, hasPermission("periode_manage"), deletePeriodeHandler);

router.get("/kpi", authenticateToken, hasPermission("kpi_view"), getKpiHandler);
router.post("/kpi", authenticateToken, hasPermission("kpi_manage"), createKpiHandler);
router.put("/kpi/:id", authenticateToken, hasPermission("kpi_manage"), updateKpiHandler);
router.delete("/kpi/:id", authenticateToken, hasPermission("kpi_manage"), deleteKpiHandler);

router.get("/kpi-group", authenticateToken, hasPermission("kpi_view"), getKpiGroupsHandler);
router.post("/kpi-group", authenticateToken, hasPermission("kpi_manage"), createKpiGroupHandler);
router.put("/kpi-group/:id", authenticateToken, hasPermission("kpi_manage"), updateKpiGroupHandler);
router.delete("/kpi-group/:id", authenticateToken, hasPermission("kpi_manage"), deleteKpiGroupHandler);

router.get("/ahp-group/perbandingan/:periode_id", authenticateToken, hasPermission("spk_view"), getGroupComparisonsHandler);
router.post("/ahp-group/perbandingan/:periode_id", authenticateToken, hasPermission("spk_manage"), saveGroupComparisonsHandler);

router.get("/ahp/perbandingan/:periode_id", authenticateToken, hasPermission("spk_view"), getComparisonsHandler);
router.post("/ahp/perbandingan", authenticateToken, hasPermission("spk_manage"), inputComparisonHandler);
router.post("/ahp/calculate-weight/:periode_id", authenticateToken, hasPermission("spk_calculate"), calculateWeightsHandler);

router.post("/moora/penilaian", authenticateToken, hasPermission("score_input"), inputPenilaianHandler);
router.post("/moora/calculate/:periode_id", authenticateToken, hasPermission("spk_calculate"), calculateMooraHandler);
router.get("/moora/hasil/:periode_id", authenticateToken, hasPermission("spk_view"), getMooraResultHandler);
router.patch("/moora/hasil/:id/review", authenticateToken, hasPermission("spk_calculate"), updateHasilReviewHandler);

// Reports
router.get("/report/individual/:periode_id/:karyawan_id", authenticateToken, hasPermission("spk_view"), getIndividualReportHandler);
router.get("/report/summary/:periode_id", authenticateToken, hasPermission("spk_view"), getSummaryReportHandler);

module.exports = router;
