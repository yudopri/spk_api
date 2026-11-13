const express = require("express");
const {
	getDepartmentsHandler,
	getEmployeesHandler,
	getWorkLocationsHandler,
	getAttributesHandler,
	createAttributeHandler,
	updateAttributeHandler,
	deleteAttributeHandler,
	getKpiHandler,
	createKpiHandler
} = require("../controllers/spkController");
const { authenticateToken } = require("../middlewares/authMiddleware");
const { hasPermission } = require("../middlewares/permissionMiddleware");
const { asyncHandler } = require("../middlewares/asyncHandler");

const router = express.Router();

// Requested canonical endpoints
router.get("/departments", authenticateToken, hasPermission("department_view"), asyncHandler(getDepartmentsHandler));
router.get("/employees", authenticateToken, hasPermission("employee_view"), asyncHandler(getEmployeesHandler));
router.get("/work-locations", authenticateToken, hasPermission("department_view"), asyncHandler(getWorkLocationsHandler));
router.get("/attribute", authenticateToken, hasPermission("kpi_view"), asyncHandler(getAttributesHandler));
router.post("/attribute", authenticateToken, hasPermission("kpi_manage"), asyncHandler(createAttributeHandler));
router.put("/attribute/:id", authenticateToken, hasPermission("kpi_manage"), asyncHandler(updateAttributeHandler));
router.delete("/attribute/:id", authenticateToken, hasPermission("kpi_manage"), asyncHandler(deleteAttributeHandler));
router.get("/kriteria", authenticateToken, hasPermission("kpi_view"), asyncHandler(getKpiHandler));
router.post("/kriteria", authenticateToken, hasPermission("kpi_manage"), asyncHandler(createKpiHandler));

// Backward-compatible aliases from Flask API
router.get("/spk/mitra/departments", authenticateToken, hasPermission("department_view"), asyncHandler(getDepartmentsHandler));
router.get("/spk/mitra/karyawan", authenticateToken, hasPermission("employee_view"), asyncHandler(getEmployeesHandler));
router.get("/spk/mitra/work-locations", authenticateToken, hasPermission("department_view"), asyncHandler(getWorkLocationsHandler));

module.exports = router;
