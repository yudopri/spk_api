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
  getUserDetail,
  // New CRUD imports
  getRoles,
  getRoleDetail,
  createRoleHandler,
  updateRoleHandler,
  deleteRoleHandler,
  syncRolesHandler,
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
const { asyncHandler } = require("../middlewares/asyncHandler");

const router = express.Router();

router.post("/login", asyncHandler(login));
router.post("/refresh", authenticateToken, requireRefreshToken, asyncHandler(refresh));
router.post("/logout", authenticateToken, asyncHandler(logout));

// ─── Permissions CRUD ────────────────────────────────────────
router.get("/permissions", authenticateToken, hasPermission("user_manage"), asyncHandler(getPermissions));
router.post("/permissions", authenticateToken, hasPermission("user_manage"), asyncHandler(createPermissionHandler));
router.get("/permissions/:id", authenticateToken, hasPermission("user_manage"), asyncHandler(getPermissionDetail));
router.put("/permissions/:id", authenticateToken, hasPermission("user_manage"), asyncHandler(updatePermissionHandler));
router.delete("/permissions/:id", authenticateToken, hasPermission("user_manage"), asyncHandler(deletePermissionHandler));

// ─── Roles CRUD ──────────────────────────────────────────────
router.get("/roles", authenticateToken, hasPermission("user_manage"), asyncHandler(getRoles));
router.post("/roles", authenticateToken, hasPermission("user_manage"), asyncHandler(createRoleHandler));
router.post("/roles/sync", authenticateToken, hasPermission("user_manage"), asyncHandler(syncRolesHandler));
router.get("/roles/:id", authenticateToken, hasPermission("user_manage"), asyncHandler(getRoleDetail));
router.put("/roles/:id", authenticateToken, hasPermission("user_manage"), asyncHandler(updateRoleHandler));
router.delete("/roles/:id", authenticateToken, hasPermission("user_manage"), asyncHandler(deleteRoleHandler));

// ─── Role ↔ Permission Mapping (granular) ────────────────────
router.post("/roles/:id/permissions", authenticateToken, hasPermission("user_manage"), asyncHandler(bulkSetRolePermissionsHandler));
router.post("/roles/:id/permissions/:permission_id", authenticateToken, hasPermission("user_manage"), asyncHandler(addPermissionToRoleHandler));
router.delete("/roles/:id/permissions/:permission_id", authenticateToken, hasPermission("user_manage"), asyncHandler(removePermissionFromRoleHandler));

// ─── Legacy / backward-compatible endpoints ──────────────────
router.get("/mitra-roles/:role_name/permissions", authenticateToken, hasPermission("user_manage"), asyncHandler(getPermissionsByMitraRole));
router.post("/mitra-roles/:role_name/permissions", authenticateToken, hasPermission("user_manage"), asyncHandler(assignPermissionsToMitraRole));
router.get("/roles-mitra", authenticateToken, hasPermission("user_manage"), asyncHandler(getRolesMitra));
router.post("/seed-permissions", authenticateToken, hasPermission("user_manage"), asyncHandler(seedPermissions));
router.get("/users", authenticateToken, hasPermission("user_manage"), asyncHandler(getUsers));
router.get("/users/:id", authenticateToken, hasPermission("user_manage"), asyncHandler(getUserDetail));
router.get("/audit-logs", authenticateToken, hasPermission("audit_view"), hasRole(["Manager", "Dev", "Hrd"]), asyncHandler(getAuditLogsHandler));

module.exports = router;
