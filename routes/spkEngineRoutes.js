const express = require("express");
const router = express.Router();
const { calculateAhpLive, getRankingByPeriod } = require("../controllers/ahpController");
const { checkPeriodStatus } = require("../middlewares/freezeMiddleware");
const { authenticateToken } = require("../middlewares/authMiddleware");

/**
 * SPK Engine Routes
 * Path: /api
 */

// AHP Live Calculation (Pure Logic, No DB write)
router.post("/ahp/calculate-cr", authenticateToken, calculateAhpLive);

// Ranking Result (DB Read)
router.get("/ranking/:periode_id", authenticateToken, getRankingByPeriod);

module.exports = router;
