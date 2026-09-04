const { queryMitra, querySpk, applyQueryMeta } = require("../config/db");

const ROLE_ENUM = [
  "Karyawan",
  "Admin",
  "Hrd",
  "Manager",
  "Kadiv",
  "Dev",
  "Adm Karyawan",
  "Adm Logistik",
  "Adm Lapangan",
  "Adm Keuangan",
  "Adm Pajak",
  "Adm Bpjs"
];

async function findMitraUserByEmail(email) {
  const rows = await queryMitra(
    "SELECT id, name, email, password, role FROM users WHERE email = $1 LIMIT 1",
    [email]
  );
  return rows[0] || null;
}

async function findMitraUserById(id) {
  const rows = await queryMitra(
    "SELECT id, name, email, role FROM users WHERE id = $1 LIMIT 1",
    [id]
  );
  return rows[0] || null;
}

async function getAllUsers(options = {}) {
  const baseSql = "SELECT id, name, email, role FROM users";
  const { sql, params, countSql, countParams } = applyQueryMeta(baseSql, [], options, ["name", "email", "role"]);
  const [rows, totalRes] = await Promise.all([
    queryMitra(sql, params),
    queryMitra(countSql, countParams)
  ]);
  return { rows, total: totalRes[0]?.total || 0 };
}

async function findEmployeeByEmail(email) {
  const rows = await queryMitra(
    "SELECT id, name, email, departemen_id, lokasikerja FROM employees WHERE email = $1 LIMIT 1",
    [email]
  );
  return rows[0] || null;
}

async function findRoleByName(roleName) {
  const rows = await querySpk("SELECT id, role_name FROM roles WHERE role_name = $1 LIMIT 1", [roleName]);
  return rows[0] || null;
}

async function getRolePermissions(roleId) {
  const rows = await querySpk(
    `SELECT p.permission_name
     FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = $1`,
    [roleId]
  );
  return rows.map((r) => r.permission_name);
}

async function getAllPermissions(options = {}) {
  const baseSql = "SELECT id, permission_name, path FROM permissions";
  const { sql, params, countSql, countParams } = applyQueryMeta(baseSql, [], options, ["permission_name", "path"]);
  const [rows, totalRes] = await Promise.all([
    querySpk(sql, params),
    querySpk(countSql, countParams)
  ]);
  return { rows, total: totalRes[0]?.total || 0 };
}

async function createPermission(permissionName, pathValue) {
  const existing = await querySpk(
    "SELECT id FROM permissions WHERE permission_name = $1 LIMIT 1",
    [permissionName]
  );
  if (existing.length > 0) return { exists: true, id: existing[0].id };

  const result = await querySpk(
    "INSERT INTO permissions(permission_name, path) VALUES($1, $2) RETURNING id",
    [permissionName, pathValue || ""]
  );
  return { exists: false, id: result[0]?.id };
}

async function getOrCreateRoleByName(roleName) {
  const existing = await findRoleByName(roleName);
  if (existing) return existing;

  const result = await querySpk("INSERT INTO roles(role_name) VALUES($1) RETURNING id", [roleName]);
  return { id: result[0]?.id, role_name: roleName };
}

async function setRolePermissions(roleId, permissionIds) {
  await querySpk("DELETE FROM role_permissions WHERE role_id = $1", [roleId]);
  if (!permissionIds || permissionIds.length === 0) return;

  const valuesSql = permissionIds.map((_, i) => `($1, $${i + 2})`).join(",");
  const params = [roleId, ...permissionIds];
  await querySpk(
    `INSERT INTO role_permissions(role_id, permission_id) VALUES ${valuesSql}`,
    params
  );
}

async function getRolePermissionNames(roleName) {
  const role = await findRoleByName(roleName);
  if (!role) return [];
  return getRolePermissions(role.id);
}

// ─── CRUD Roles ──────────────────────────────────────────────
async function getAllRoles(options = {}) {
  const baseSql = "SELECT id, role_name FROM roles";
  const { sql, params, countSql, countParams } = applyQueryMeta(baseSql, [], options, ["role_name"]);
  const [rows, totalRes] = await Promise.all([
    querySpk(sql, params),
    querySpk(countSql, countParams)
  ]);
  return { rows, total: totalRes[0]?.total || 0 };
}

async function getRoleById(id) {
  const rows = await querySpk("SELECT id, role_name FROM roles WHERE id = $1 LIMIT 1", [id]);
  return rows[0] || null;
}

async function createRole(roleName) {
  const existing = await findRoleByName(roleName);
  if (existing) return { exists: true, id: existing.id, role_name: existing.role_name };

  const result = await querySpk("INSERT INTO roles(role_name) VALUES($1) RETURNING id", [roleName]);
  return { exists: false, id: result[0]?.id, role_name: roleName };
}

async function updateRole(id, roleName) {
  const existing = await getRoleById(id);
  if (!existing) return { notFound: true };

  const duplicate = await findRoleByName(roleName);
  if (duplicate && Number(duplicate.id) !== Number(id)) {
    return { conflict: true };
  }

  await querySpk("UPDATE roles SET role_name = $1 WHERE id = $2", [roleName, id]);
  return { success: true };
}

// ─── CRUD Permissions ────────────────────────────────────────
async function getPermissionById(id) {
  const rows = await querySpk("SELECT id, permission_name, path FROM permissions WHERE id = $1 LIMIT 1", [id]);
  return rows[0] || null;
}

async function updatePermission(id, permissionName, pathValue) {
  const existing = await getPermissionById(id);
  if (!existing) return { notFound: true };

  const duplicate = await querySpk(
    "SELECT id FROM permissions WHERE permission_name = $1 AND id != $2 LIMIT 1",
    [permissionName, id]
  );
  if (duplicate.length > 0) return { conflict: true };

  await querySpk("UPDATE permissions SET permission_name = $1, path = $2 WHERE id = $3", [
    permissionName,
    pathValue ?? existing.path,
    id
  ]);
  return { success: true };
}

async function deletePermission(id) {
  const existing = await getPermissionById(id);
  if (!existing) return { notFound: true };

  // Check if permission is assigned to any role
  const rolesWithPerm = await querySpk(
    "SELECT COUNT(*) AS cnt FROM role_permissions WHERE permission_id = $1 LIMIT 1",
    [id]
  );
  if (rolesWithPerm[0]?.cnt > 0) {
    return { inUse: true, roleCount: rolesWithPerm[0].cnt };
  }

  await querySpk("DELETE FROM permissions WHERE id = $1", [id]);
  return { success: true };
}

// ─── Single Permission Assignment ────────────────────────────
async function addPermissionToRole(roleId, permissionId) {
  const existing = await querySpk(
    "SELECT 1 FROM role_permissions WHERE role_id = $1 AND permission_id = $2 LIMIT 1",
    [roleId, permissionId]
  );
  if (existing.length > 0) return { alreadyAssigned: true };

  await querySpk("INSERT INTO role_permissions(role_id, permission_id) VALUES($1, $2)", [roleId, permissionId]);
  return { success: true };
}

async function removePermissionFromRole(roleId, permissionId) {
  const result = await querySpk(
    "DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2",
    [roleId, permissionId]
  );
  return { success: result.length > 0 || result.count > 0 };
}

// ─── Bulk Permission Assignment (with validation) ────────────
async function bulkSetRolePermissions(roleId, permissionIds) {
  // Validate all permission IDs exist
  if (!permissionIds || permissionIds.length === 0) {
    await querySpk("DELETE FROM role_permissions WHERE role_id = $1", [roleId]);
    return { success: true, assigned: 0 };
  }

  const placeholders = permissionIds.map((_, i) => `$${i + 1}`).join(",");
  const validPerms = await querySpk(
    `SELECT id FROM permissions WHERE id IN (${placeholders})`,
    permissionIds
  );
  const validIds = validPerms.map((p) => p.id);
  const invalidIds = permissionIds.filter((id) => !validIds.includes(id));

  await querySpk("DELETE FROM role_permissions WHERE role_id = $1", [roleId]);
  if (validIds.length > 0) {
    const valuesSql = validIds.map((_, i) => `($1, $${i + 2})`).join(",");
    const params = [roleId, ...validIds];
    await querySpk(
      `INSERT INTO role_permissions(role_id, permission_id) VALUES ${valuesSql}`,
      params
    );
  }

  return { success: true, assigned: validIds.length, invalidIds };
}

module.exports = {
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
  // New CRUD exports
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
};
