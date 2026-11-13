const express = require("express");
const router = express.Router();
const { calculateAhpLive, validateAhpMatrix, getRankingByPeriod } = require("../controllers/ahpController");
const { checkPeriodStatus } = require("../middlewares/freezeMiddleware");
const { authenticateToken } = require("../middlewares/authMiddleware");
const { asyncHandler } = require("../middlewares/asyncHandler");

/**
 * SPK Engine Routes
 * Path: /api
 */

// AHP Live Calculation (Pure Logic, No DB write)
router.post("/ahp/calculate-cr", authenticateToken, asyncHandler(calculateAhpLive));

// Real-time AHP Validation for UI feedback
router.post("/spk/ahp/validate-matrix", authenticateToken, asyncHandler(validateAhpMatrix));

// Ranking Result (DB Read)
router.get("/ranking/:periode_id", authenticateToken, asyncHandler(getRankingByPeriod));

module.exports = router;
