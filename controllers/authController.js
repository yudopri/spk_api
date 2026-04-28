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
  getAllUsers
} = require("../models/authModel");

function signAccessToken(payload) {
  return jwt.sign({ ...payload, token_type: "access" }, process.env.JWT_SECRET || "dev-secret", {
    expiresIn: process.env.JWT_ACCESS_EXPIRES || "1h"
  });
}

function signRefreshToken(payload) {
  return jwt.sign({ ...payload, token_type: "refresh" }, process.env.JWT_SECRET || "dev-secret", {
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
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    const isValid = await bcrypt.compare(password, userMitra.password);
    if (!isValid) {
      return res.status(401).json({ status: "error", message: "Invalid password" });
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

    return res.status(200).json({
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
  } catch (error) {
    return res.status(500).json({ status: "error", message: "Internal Server Error", error: error.message });
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
    return res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
}

async function logout(_req, res) {
  return res.status(200).json({ message: "Successfully logged out" });
}

async function getPermissions(_req, res) {
  const perms = await getAllPermissions();
  return res.json(perms);
}

async function createPermissionHandler(req, res) {
  const { permission_name: permissionName, path } = req.body || {};
  if (!permissionName) {
    return res.status(400).json({ success: false, message: "permission_name is required" });
  }

  const created = await createPermission(permissionName, path || "");
  if (created.exists) {
    return res.status(400).json({ success: false, message: "Permission already exists" });
  }

  return res.json({ success: true, id: created.id });
}

async function getPermissionsByMitraRole(req, res) {
  const roleName = req.params.role_name;
  const permissions = await getRolePermissionNames(roleName);
  return res.json(permissions);
}

async function assignPermissionsToMitraRole(req, res) {
  const roleName = req.params.role_name;
  if (!ROLE_ENUM.includes(roleName)) {
    return res.status(400).json({ success: false, message: "Role name is not valid according to Mitra Enum" });
  }

  const permissionIds = Array.isArray(req.body) ? req.body : [];
  const role = await getOrCreateRoleByName(roleName);
  await setRolePermissions(role.id, permissionIds);

  return res.json({ success: true, message: `Permissions updated for Mitra role: ${roleName}` });
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

async function getUsers(_req, res) {
  try {
    const { getAllUsers } = require("../models/authModel");
    const users = await getAllUsers();
    return res.json({ success: true, data: users });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal Server Error", error: error.message });
  }
}

async function getUsers(_req, res) {
  try {
    const users = await getAllUsers();
    return res.json({ success: true, data: users });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Internal Server Error", error: error.message });
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
  getUsers
};
