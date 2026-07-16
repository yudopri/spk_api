const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { seedPermissionsData } = require("../services/startupSeed");
const {
  ROLE_ENUM,
  findMitraUserByEmail,
  findMitraUserById,
  findEmployeeByEmail,
  findRoleByName,
  getRolePermissions,
  getAllPermissions,
  createPermission,
  getOrCreateRoleByName,
  setRolePermissions,
  getRolePermissionNames,
  getAllUsers,
  // New CRUD imports
  getAllRoles,
  getRoleById,
  createRole,
  updateRole,
  getPermissionById,
  updatePermission,
  deletePermission,
  addPermissionToRole,
  removePermissionFromRole,
  bulkSetRolePermissions
} = require("../models/authModel");

function signAccessToken(payload) {
  return jwt.sign({ ...payload, token_type: "access" }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES || "1h"
  });
}

function signRefreshToken(payload) {
  return jwt.sign({ ...payload, token_type: "refresh" }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES || "7d"
  });
}

async function login(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ status: "error", message: "Email and password are required" });
    }

    const userMitra = await findMitraUserByEmail(email);
    if (!userMitra) {
      return res.status(401).json({ status: "error", message: "Invalid email or password" });
    }

    const isValid = await bcrypt.compare(password, userMitra.password);
    if (!isValid) {
      return res.status(401).json({ status: "error", message: "Invalid email or password" });
    }

    const employee = await findEmployeeByEmail(userMitra.email);
    const internalRole = await findRoleByName(userMitra.role);
    const permissionsList = internalRole ? await getRolePermissions(internalRole.id) : [];

    const claims = {
      sub: String(userMitra.id),
      name: employee?.name || userMitra.name,
      email: userMitra.email,
      role: userMitra.role,
      permissions: permissionsList,
      employee_id: employee?.id || null,
      dept_id: employee?.departemen_id || null,
      lokasi_kerja: employee?.lokasikerja || null
    };

    const response = await res.status(200).json({
      status: "success",
      access_token: signAccessToken(claims),
      refresh_token: signRefreshToken({ sub: String(userMitra.id) }),
      user: {
        id: userMitra.id,
        employee_id: employee?.id || null,
        name: employee?.name || userMitra.name,
        role: userMitra.role,
        dept_id: employee?.departemen_id || null,
        lokasi_kerja: employee?.lokasikerja || null
      },
      permissions: permissionsList
    });

    // ✅ Tambahkan audit log untuk LOGIN
    const { insertAuditLog } = require("../models/spkModel");
    try {
      await insertAuditLog({
        userId: userMitra.id,
        email: userMitra.email,
        name: employee?.name || userMitra.name,
        action: "LOGIN",
        entityName: "Authentication",
        details: {
          method: "email",
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"]
        },
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        url: req.originalUrl,
        method: req.method
      });

      // Update last_login timestamp on the audit_logs row we just inserted
      const { querySpk } = require("../config/db");
      await querySpk(
        `UPDATE audit_logs SET last_login = NOW() WHERE UserId = ? AND Action = 'LOGIN' ORDER BY Id DESC LIMIT 1`,
        [userMitra.id]
      );
    } catch (auditError) {
      console.error("[AUDIT LOGIN ERROR]", auditError);
      // Jangan disturb response utama jika audit gagal
    }

    return response;
  } catch (error) {
    console.error("[LOGIN ERROR]", error);
    return res.status(500).json({ status: "error", message: "Internal Server Error" });
  }
}

async function refresh(req, res) {
  try {
    const userId = req.user?.sub;
    const userMitra = await findMitraUserById(userId);
    if (!userMitra) {
      return res.status(404).json({ message: "User no longer exists" });
    }

    const internalRole = await findRoleByName(userMitra.role);
    const permissionsList = internalRole ? await getRolePermissions(internalRole.id) : [];
    const employee = await findEmployeeByEmail(userMitra.email);

    const newAccessToken = signAccessToken({
      sub: String(userMitra.id),
      name: employee?.name || userMitra.name,
      email: userMitra.email,
      role: userMitra.role,
      permissions: permissionsList,
      employee_id: employee?.id || null,
      dept_id: employee?.departemen_id || null,
      lokasi_kerja: employee?.lokasikerja || null
    });

    return res.status(200).json({ access_token: newAccessToken });
  } catch (error) {
    console.error("[REFRESH ERROR]", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
}

async function logout(_req, res) {
  return res.status(200).json({ message: "Successfully logged out" });
}

function getQueryOptions(req) {
  return {
    search: req.query.search,
    filter: req.query.filter,
    page: req.query.page,
    pageSize: req.query.pageSize || req.query.limit,
    sort: req.query.sort
  };
}

function formatMeta(options, total) {
  const page = parseInt(options.page || 1);
  const pageSize = parseInt(options.pageSize || total || 1);
  return {
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / (pageSize || 1))
  };
}

async function getPermissions(req, res) {
  const options = getQueryOptions(req);
  const { rows, total } = await getAllPermissions(options);
  return res.json({
    data: rows,
    meta: formatMeta(options, total)
  });
}

async function createPermissionHandler(req, res) {
  try {
    const { permission_name: permissionName, path } = req.body || {};
    if (!permissionName) {
      return res.status(400).json({ success: false, message: "permission_name is required" });
    }

    const created = await createPermission(permissionName, path || "");
    if (created.exists) {
      return res.status(400).json({ success: false, message: "Permission already exists" });
    }

    // ✅ Audit log CREATE
    const { insertAuditLog } = require("../models/spkModel");
    await insertAuditLog({
      userId: req.user?.sub,
      email: req.user?.email,
      name: req.user?.name,
      action: "CREATE",
      entityName: "Permission",
      details: { permission_name: permissionName, path },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      url: req.originalUrl,
      method: req.method
    });

    return res.json({ success: true, id: created.id });
  } catch (error) {
    console.error("[CREATE PERMISSION ERROR]", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

async function getPermissionsByMitraRole(req, res) {
  const roleName = req.params.role_name;
  const permissions = await getRolePermissionNames(roleName);
  return res.json(permissions);
}

async function assignPermissionsToMitraRole(req, res) {
  try {
    const roleName = req.params.role_name;
    if (!ROLE_ENUM.includes(roleName)) {
      return res.status(400).json({ success: false, message: "Role name is not valid according to Mitra Enum" });
    }

    const permissionIds = Array.isArray(req.body) ? req.body : [];
    const role = await getOrCreateRoleByName(roleName);
    await setRolePermissions(role.id, permissionIds);

    // ✅ Audit log - Assign permissions to Mitra role
    const { insertAuditLog } = require("../models/spkModel");
    await insertAuditLog({
      userId: req.user?.sub,
      email: req.user?.email,
      name: req.user?.name,
      action: "UPDATE",
      entityName: "Mitra_Role_Permission",
      details: { role_name: roleName, permission_ids: permissionIds },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      url: req.originalUrl,
      method: req.method
    });

    return res.json({ success: true, message: `Permissions updated for Mitra role: ${roleName}` });
  } catch (error) {
    console.error("[ASSIGN MITRA ROLE ERROR]", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

async function getRolesMitra(_req, res) {
  const results = [];
  for (const roleName of ROLE_ENUM) {
    const permissions = await getRolePermissionNames(roleName);
    results.push({
      role_name: roleName,
      is_mapped: permissions.length > 0,
      permission_count: permissions.length
    });
  }
  return res.json(results);
}

async function seedPermissions(_req, res) {
  await seedPermissionsData();

  return res.json({ success: true, message: "Permissions seeded and mapped to Enum roles successfully" });
}

async function getUsers(req, res) {
  try {
    const options = getQueryOptions(req);
    const { rows, total } = await getAllUsers(options);
    return res.json({ 
      success: true, 
      data: rows,
      meta: formatMeta(options, total)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

// ─── CRUD Roles ──────────────────────────────────────────────

async function getRoles(req, res) {
  try {
    const options = getQueryOptions(req);
    const { rows, total } = await getAllRoles(options);
    // Enrich with permission count
    const enriched = await Promise.all(
      rows.map(async (role) => {
        const permissions = await getRolePermissions(role.id);
        return {
          id: role.id,
          role_name: role.role_name,
          permission_count: permissions.length,
          permissions
        };
      })
    );
    return res.json({ success: true, data: enriched, meta: formatMeta(options, total) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

async function getRoleDetail(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "ID tidak valid" });

    const role = await getRoleById(id);
    if (!role) return res.status(404).json({ success: false, message: "Role tidak ditemukan" });

    const permissions = await getRolePermissions(role.id);
    return res.json({
      success: true,
      data: { id: role.id, role_name: role.role_name, permissions }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

async function createRoleHandler(req, res) {
  try {
    const { role_name } = req.body || {};
    if (!role_name || !String(role_name).trim()) {
      return res.status(400).json({ success: false, message: "role_name wajib diisi" });
    }

    const result = await createRole(String(role_name).trim());
    if (result.exists) {
      return res.status(409).json({ success: false, message: `Role '${role_name}' sudah ada`, id: result.id });
    }

    // ✅ Audit log CREATE
    const { insertAuditLog } = require("../models/spkModel");
    await insertAuditLog({
      userId: req.user?.sub,
      email: req.user?.email,
      name: req.user?.name,
      action: "CREATE",
      entityName: "Role",
      details: { role_name: result.role_name },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      url: req.originalUrl,
      method: req.method
    });

    return res.status(201).json({ success: true, id: result.id, role_name: result.role_name });
  } catch (error) {
    console.error("[CREATE ROLE ERROR]", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

async function updateRoleHandler(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "ID tidak valid" });

    const { role_name } = req.body || {};
    if (!role_name || !String(role_name).trim()) {
      return res.status(400).json({ success: false, message: "role_name wajib diisi" });
    }

    const result = await updateRole(id, String(role_name).trim());
    if (result.notFound) return res.status(404).json({ success: false, message: "Role tidak ditemukan" });
    if (result.conflict) return res.status(409).json({ success: false, message: `Role '${role_name}' sudah digunakan role lain` });

    // ✅ Audit log UPDATE
    const { insertAuditLog } = require("../models/spkModel");
    await insertAuditLog({
      userId: req.user?.sub,
      email: req.user?.email,
      name: req.user?.name,
      action: "UPDATE",
      entityName: "Role",
      details: { role_name: result.role_name },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      url: req.originalUrl,
      method: req.method
    });

    return res.json({ success: true, message: "Role berhasil diperbarui" });
  } catch (error) {
    console.error("[UPDATE ROLE ERROR]", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

// ─── CRUD Permissions ────────────────────────────────────────

async function getPermissionDetail(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "ID tidak valid" });

    const perm = await getPermissionById(id);
    if (!perm) return res.status(404).json({ success: false, message: "Permission tidak ditemukan" });

    return res.json({ success: true, data: perm });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

async function updatePermissionHandler(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "ID tidak valid" });

    const { permission_name, path } = req.body || {};
    if (!permission_name || !String(permission_name).trim()) {
      return res.status(400).json({ success: false, message: "permission_name wajib diisi" });
    }

    const result = await updatePermission(id, String(permission_name).trim(), path);
    if (result.notFound) return res.status(404).json({ success: false, message: "Permission tidak ditemukan" });
    if (result.conflict) return res.status(409).json({ success: false, message: `Permission '${permission_name}' sudah ada` });

    // ✅ Audit log UPDATE
    const { insertAuditLog } = require("../models/spkModel");
    await insertAuditLog({
      userId: req.user?.sub,
      email: req.user?.email,
      name: req.user?.name,
      action: "UPDATE",
      entityName: "Permission",
      details: { permission_name: permission_name, path },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      url: req.originalUrl,
      method: req.method
    });

    return res.json({ success: true, message: "Permission berhasil diperbarui" });
  } catch (error) {
    console.error("[UPDATE PERMISSION ERROR]", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

async function deletePermissionHandler(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "ID tidak valid" });

    const result = await deletePermission(id);
    if (result.notFound) return res.status(404).json({ success: false, message: "Permission tidak ditemukan" });
    if (result.inUse) {
      return res.status(409).json({
        success: false,
        message: `Permission masih digunakan oleh ${result.roleCount} role. Hapus mapping terlebih dahulu.`
      });
    }

    // ✅ Audit log DELETE
    const { insertAuditLog } = require("../models/spkModel");
    await insertAuditLog({
      userId: req.user?.sub,
      email: req.user?.email,
      name: req.user?.name,
      action: "DELETE",
      entityName: "Permission",
      details: { id },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      url: req.originalUrl,
      method: req.method
    });

    return res.json({ success: true, message: "Permission berhasil dihapus" });
  } catch (error) {
    console.error("[DELETE PERMISSION ERROR]", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

// ─── Single Permission Assignment ────────────────────────────

async function addPermissionToRoleHandler(req, res) {
  try {
    const roleId = Number(req.params.id);
    const permissionId = Number(req.params.permission_id);
    if (!roleId || !permissionId) return res.status(400).json({ success: false, message: "ID tidak valid" });

    const role = await getRoleById(roleId);
    if (!role) return res.status(404).json({ success: false, message: "Role tidak ditemukan" });

    const perm = await getPermissionById(permissionId);
    if (!perm) return res.status(404).json({ success: false, message: "Permission tidak ditemukan" });

    const result = await addPermissionToRole(roleId, permissionId);
    if (result.alreadyAssigned) {
      return res.status(409).json({ success: false, message: "Permission sudah ditambahkan ke role ini" });
    }

    // ✅ Audit log - Tambah permission ke role
    const { insertAuditLog } = require("../models/spkModel");
    await insertAuditLog({
      userId: req.user?.sub,
      email: req.user?.email,
      name: req.user?.name,
      action: "UPDATE",
      entityName: "Role_Permission",
      details: { role_name: role.role_name, permission_name: perm.permission_name, add: true },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      url: req.originalUrl,
      method: req.method
    });

    return res.json({ success: true, message: `Permission '${perm.permission_name}' ditambahkan ke role '${role.role_name}'` });
  } catch (error) {
    console.error("[ADD PERMISSION TO ROLE ERROR]", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

async function removePermissionFromRoleHandler(req, res) {
  try {
    const roleId = Number(req.params.id);
    const permissionId = Number(req.params.permission_id);
    if (!roleId || !permissionId) return res.status(400).json({ success: false, message: "ID tidak valid" });

    const result = await removePermissionFromRole(roleId, permissionId);
    if (!result.success) {
      return res.status(404).json({ success: false, message: "Mapping tidak ditemukan" });
    }

    // ✅ Audit log - Hapus permission dari role
    const { insertAuditLog } = require("../models/spkModel");
    await insertAuditLog({
      userId: req.user?.sub,
      email: req.user?.email,
      name: req.user?.name,
      action: "UPDATE",
      entityName: "Role_Permission",
      details: { remove: true },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      url: req.originalUrl,
      method: req.method
    });

    return res.json({ success: true, message: "Permission berhasil dihapus dari role" });
  } catch (error) {
    console.error("[REMOVE PERMISSION FROM ROLE ERROR]", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

async function bulkSetRolePermissionsHandler(req, res) {
  try {
    const roleId = Number(req.params.id);
    if (!roleId) return res.status(400).json({ success: false, message: "ID tidak valid" });

    const role = await getRoleById(roleId);
    if (!role) return res.status(404).json({ success: false, message: "Role tidak ditemukan" });

    const { permission_ids } = req.body || {};
    if (!Array.isArray(permission_ids)) {
      return res.status(400).json({ success: false, message: "permission_ids harus berupa array" });
    }

    const result = await bulkSetRolePermissions(roleId, permission_ids);

    // ✅ Audit log - Bulk set role permissions
    const { insertAuditLog } = require("../models/spkModel");
    await insertAuditLog({
      userId: req.user?.sub,
      email: req.user?.email,
      name: req.user?.name,
      action: "UPDATE",
      entityName: "Role_Permission",
      details: { role_name: role.role_name, assigned: result.assigned, invalid_ids: result.invalidIds || [], permission_ids },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      url: req.originalUrl,
      method: req.method
    });

    return res.json({
      success: true,
      message: `Permission berhasil diatur untuk role '${role.role_name}'`,
      assigned: result.assigned,
      invalid_ids: result.invalidIds || []
    });
  } catch (error) {
    console.error("[BULK SET ROLE PERMISSIONS ERROR]", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

module.exports = {
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
  // New CRUD exports
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
};
