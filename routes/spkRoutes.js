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
const { checkPeriodStatus } = require("../middlewares/freezeMiddleware");

const router = express.Router();

router.get("/periode", authenticateToken, hasPermission("periode_view"), getPeriodeHandler);
router.post("/periode", authenticateToken, hasPermission("periode_manage"), createPeriodeHandler);
router.put("/periode/:id", authenticateToken, hasPermission("periode_manage"), updatePeriodeHandler);
router.delete("/periode/:id", authenticateToken, hasPermission("periode_manage"), deletePeriodeHandler);

router.get("/kpi", authenticateToken, hasPermission("kpi_view"), getKpiHandler);
router.post("/kpi", authenticateToken, hasPermission("kpi_manage"), checkPeriodStatus, createKpiHandler);
router.put("/kpi/:id", authenticateToken, hasPermission("kpi_manage"), checkPeriodStatus, updateKpiHandler);
router.delete("/kpi/:id", authenticateToken, hasPermission("kpi_manage"), checkPeriodStatus, deleteKpiHandler);

router.get("/kpi-group", authenticateToken, hasPermission("kpi_view"), getKpiGroupsHandler);
router.post("/kpi-group", authenticateToken, hasPermission("kpi_manage"), checkPeriodStatus, createKpiGroupHandler);
router.put("/kpi-group/:id", authenticateToken, hasPermission("kpi_manage"), checkPeriodStatus, updateKpiGroupHandler);
router.delete("/kpi-group/:id", authenticateToken, hasPermission("kpi_manage"), checkPeriodStatus, deleteKpiGroupHandler);

router.get("/ahp-group/perbandingan/:periode_id", authenticateToken, hasPermission("spk_view"), getGroupComparisonsHandler);
router.post("/ahp-group/perbandingan/:periode_id", authenticateToken, hasPermission("spk_manage"), checkPeriodStatus, saveGroupComparisonsHandler);

router.get("/ahp/perbandingan/:periode_id", authenticateToken, hasPermission("spk_view"), getComparisonsHandler);
router.post("/ahp/perbandingan", authenticateToken, hasPermission("spk_manage"), checkPeriodStatus, inputComparisonHandler);
router.post("/ahp/calculate-weight/:periode_id", authenticateToken, hasPermission("spk_calculate"), checkPeriodStatus, calculateWeightsHandler);

router.post("/moora/penilaian", authenticateToken, hasPermission("score_input"), checkPeriodStatus, inputPenilaianHandler);
router.post("/moora/calculate/:periode_id", authenticateToken, hasPermission("spk_calculate"), checkPeriodStatus, calculateMooraHandler);
router.get("/moora/hasil/:periode_id", authenticateToken, hasPermission("spk_view"), getMooraResultHandler);
router.patch("/moora/hasil/:id/review", authenticateToken, hasPermission("spk_calculate"), updateHasilReviewHandler);

// Reports
router.get("/report/individual/:periode_id/:karyawan_id", authenticateToken, hasPermission("spk_view"), getIndividualReportHandler);
router.get("/report/summary/:periode_id", authenticateToken, hasPermission("spk_view"), getSummaryReportHandler);

module.exports = router;
