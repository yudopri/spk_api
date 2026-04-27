const express = require("express");
const {
	getDepartmentsHandler,
	getEmployeesHandler,
	getWorkLocationsHandler,
	getAttributesHandler,
	createAttributeHandler,
	deleteAttributeHandler,
	getKpiHandler,
	createKpiHandler
} = require("../controllers/spkController");
const { authenticateToken } = require("../middlewares/authMiddleware");
const { hasPermission } = require("../middlewares/permissionMiddleware");

const router = express.Router();

// Requested canonical endpoints
router.get("/departments", authenticateToken, hasPermission("department_view"), getDepartmentsHandler);
router.get("/employees", authenticateToken, hasPermission("employee_view"), getEmployeesHandler);
router.get("/work-locations", authenticateToken, hasPermission("department_view"), getWorkLocationsHandler);
router.get("/attribute", authenticateToken, hasPermission("kpi_view"), getAttributesHandler);
router.post("/attribute", authenticateToken, hasPermission("kpi_manage"), createAttributeHandler);
router.delete("/attribute/:id", authenticateToken, hasPermission("kpi_manage"), deleteAttributeHandler);
router.get("/kriteria", authenticateToken, hasPermission("kpi_view"), getKpiHandler);
router.post("/kriteria", authenticateToken, hasPermission("kpi_manage"), createKpiHandler);

// Backward-compatible aliases from Flask API
router.get("/spk/mitra/departments", authenticateToken, hasPermission("department_view"), getDepartmentsHandler);
router.get("/spk/mitra/karyawan", authenticateToken, hasPermission("employee_view"), getEmployeesHandler);
router.get("/spk/mitra/work-locations", authenticateToken, hasPermission("department_view"), getWorkLocationsHandler);

module.exports = router;
