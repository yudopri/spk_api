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
  seedPermissions,
  getUsers,
  // New CRUD imports
  getRoles,
  getRoleDetail,
  createRoleHandler,
  updateRoleHandler,
  getPermissionDetail,
  updatePermissionHandler,
  deletePermissionHandler,
  addPermissionToRoleHandler,
  removePermissionFromRoleHandler,
  bulkSetRolePermissionsHandler
} = require("../controllers/authController");
const { getAuditLogsHandler } = require("../controllers/spkController");
const { authenticateToken, requireRefreshToken } = require("../middlewares/authMiddleware");
const { hasPermission, hasRole } = require("../middlewares/permissionMiddleware");

const router = express.Router();

router.post("/login", login);
router.post("/refresh", authenticateToken, requireRefreshToken, refresh);
router.post("/logout", authenticateToken, logout);

// ─── Permissions CRUD ────────────────────────────────────────
router.get("/permissions", authenticateToken, hasPermission("user_manage"), getPermissions);
router.post("/permissions", authenticateToken, hasPermission("user_manage"), createPermissionHandler);
router.get("/permissions/:id", authenticateToken, hasPermission("user_manage"), getPermissionDetail);
router.put("/permissions/:id", authenticateToken, hasPermission("user_manage"), updatePermissionHandler);
router.delete("/permissions/:id", authenticateToken, hasPermission("user_manage"), deletePermissionHandler);

// ─── Roles CRUD ──────────────────────────────────────────────
router.get("/roles", authenticateToken, hasPermission("user_manage"), getRoles);
router.post("/roles", authenticateToken, hasPermission("user_manage"), createRoleHandler);
router.get("/roles/:id", authenticateToken, hasPermission("user_manage"), getRoleDetail);
router.put("/roles/:id", authenticateToken, hasPermission("user_manage"), updateRoleHandler);

// ─── Role ↔ Permission Mapping (granular) ────────────────────
router.post("/roles/:id/permissions", authenticateToken, hasPermission("user_manage"), bulkSetRolePermissionsHandler);
router.post("/roles/:id/permissions/:permission_id", authenticateToken, hasPermission("user_manage"), addPermissionToRoleHandler);
router.delete("/roles/:id/permissions/:permission_id", authenticateToken, hasPermission("user_manage"), removePermissionFromRoleHandler);

// ─── Legacy / backward-compatible endpoints ──────────────────
router.get("/mitra-roles/:role_name/permissions", authenticateToken, hasPermission("user_manage"), getPermissionsByMitraRole);
router.post("/mitra-roles/:role_name/permissions", authenticateToken, hasPermission("user_manage"), assignPermissionsToMitraRole);
router.get("/roles-mitra", authenticateToken, hasPermission("user_manage"), getRolesMitra);
router.post("/seed-permissions", authenticateToken, hasPermission("user_manage"), seedPermissions);
router.get("/users", authenticateToken, hasPermission("user_manage"), getUsers);
router.get("/audit-logs", authenticateToken, hasPermission("audit_view"), hasRole(["Manager", "Dev", "Hrd"]), getAuditLogsHandler);

module.exports = router;
