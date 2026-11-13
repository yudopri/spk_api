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
const { asyncHandler } = require("../middlewares/asyncHandler");

const router = express.Router();

router.get("/periode", authenticateToken, hasPermission("periode_view"), asyncHandler(getPeriodeHandler));
router.post("/periode", authenticateToken, hasPermission("periode_manage"), asyncHandler(createPeriodeHandler));
router.put("/periode/:id", authenticateToken, hasPermission("periode_manage"), asyncHandler(updatePeriodeHandler));
router.delete("/periode/:id", authenticateToken, hasPermission("periode_manage"), asyncHandler(deletePeriodeHandler));

router.get("/kpi", authenticateToken, hasPermission("kpi_view"), asyncHandler(getKpiHandler));
router.post("/kpi", authenticateToken, hasPermission("kpi_manage"), checkPeriodStatus, asyncHandler(createKpiHandler));
router.put("/kpi/:id", authenticateToken, hasPermission("kpi_manage"), checkPeriodStatus, asyncHandler(updateKpiHandler));
router.delete("/kpi/:id", authenticateToken, hasPermission("kpi_manage"), checkPeriodStatus, asyncHandler(deleteKpiHandler));

router.get("/kpi-group", authenticateToken, hasPermission("kpi_view"), asyncHandler(getKpiGroupsHandler));
router.post("/kpi-group", authenticateToken, hasPermission("kpi_manage"), checkPeriodStatus, asyncHandler(createKpiGroupHandler));
router.put("/kpi-group/:id", authenticateToken, hasPermission("kpi_manage"), checkPeriodStatus, asyncHandler(updateKpiGroupHandler));
router.delete("/kpi-group/:id", authenticateToken, hasPermission("kpi_manage"), checkPeriodStatus, asyncHandler(deleteKpiGroupHandler));

router.get("/ahp-group/perbandingan/:periode_id", authenticateToken, hasPermission("spk_view"), asyncHandler(getGroupComparisonsHandler));
router.post("/ahp-group/perbandingan/:periode_id", authenticateToken, hasPermission("spk_manage"), checkPeriodStatus, asyncHandler(saveGroupComparisonsHandler));

router.get("/ahp/perbandingan/:periode_id", authenticateToken, hasPermission("spk_view"), asyncHandler(getComparisonsHandler));
router.post("/ahp/perbandingan", authenticateToken, hasPermission("spk_manage"), checkPeriodStatus, asyncHandler(inputComparisonHandler));
router.post("/ahp/calculate-weight/:periode_id", authenticateToken, hasPermission("spk_calculate"), checkPeriodStatus, asyncHandler(calculateWeightsHandler));

router.post("/moora/penilaian", authenticateToken, hasPermission("score_input"), checkPeriodStatus, asyncHandler(inputPenilaianHandler));
router.post("/moora/calculate/:periode_id", authenticateToken, hasPermission("spk_calculate"), checkPeriodStatus, asyncHandler(calculateMooraHandler));
router.get("/moora/hasil/:periode_id", authenticateToken, hasPermission("spk_view"), asyncHandler(getMooraResultHandler));
router.patch("/moora/hasil/:id/review", authenticateToken, hasPermission("spk_calculate"), asyncHandler(updateHasilReviewHandler));

// Reports
router.get("/report/individual/:periode_id/:karyawan_id", authenticateToken, hasPermission("spk_view"), asyncHandler(getIndividualReportHandler));
router.get("/report/summary/:periode_id", authenticateToken, hasPermission("spk_view"), asyncHandler(getSummaryReportHandler));

module.exports = router;
