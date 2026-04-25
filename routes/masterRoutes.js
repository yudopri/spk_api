const express = require("express");
const {
	getDepartmentsHandler,
	getEmployeesHandler,
	getWorkLocationsHandler
} = require("../controllers/spkController");
const { authenticateToken } = require("../middlewares/authMiddleware");
const { hasPermission } = require("../middlewares/permissionMiddleware");

const router = express.Router();

// Requested canonical endpoints
router.get("/departments", authenticateToken, hasPermission("department_view"), getDepartmentsHandler);
router.get("/employees", authenticateToken, hasPermission("employee_view"), getEmployeesHandler);
router.get("/work-locations", authenticateToken, hasPermission("department_view"), getWorkLocationsHandler);

// Backward-compatible aliases from Flask API
router.get("/spk/mitra/departments", authenticateToken, hasPermission("department_view"), getDepartmentsHandler);
router.get("/spk/mitra/karyawan", authenticateToken, hasPermission("employee_view"), getEmployeesHandler);
router.get("/spk/mitra/work-locations", authenticateToken, hasPermission("department_view"), getWorkLocationsHandler);

module.exports = router;
