const express = require("express");
const {
  login,
  refresh,
  logout,
  getPermissions,
  createPermissionHandler,
  getPermissionsByMitraRole,
  assignPermissionsToMitraRole,
  getRolesMitra,
  seedPermissions
} = require("../controllers/authController");
const { getAuditLogsHandler } = require("../controllers/spkController");
const { authenticateToken, requireRefreshToken } = require("../middlewares/authMiddleware");
const { hasPermission, hasRole } = require("../middlewares/permissionMiddleware");

const router = express.Router();

router.post("/login", login);
router.post("/refresh", authenticateToken, requireRefreshToken, refresh);
router.post("/logout", authenticateToken, logout);

router.get("/permissions", authenticateToken, hasPermission("user_manage"), getPermissions);
router.post("/permissions", authenticateToken, hasPermission("user_manage"), createPermissionHandler);

router.get("/mitra-roles/:role_name/permissions", authenticateToken, hasPermission("user_manage"), getPermissionsByMitraRole);
router.post("/mitra-roles/:role_name/permissions", authenticateToken, hasPermission("user_manage"), assignPermissionsToMitraRole);
router.get("/roles-mitra", authenticateToken, hasPermission("user_manage"), getRolesMitra);
router.post("/seed-permissions", authenticateToken, hasPermission("user_manage"), seedPermissions);
router.get("/audit-logs", authenticateToken, hasPermission("audit_view"), hasRole(["Manager", "Dev"]), getAuditLogsHandler);

module.exports = router;
