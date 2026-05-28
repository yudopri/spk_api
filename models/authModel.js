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
    "SELECT id, name, email, password, role FROM users WHERE email = ? LIMIT 1",
    [email]
  );
  return rows[0] || null;
}

async function findMitraUserById(id) {
  const rows = await queryMitra(
    "SELECT id, name, email, role FROM users WHERE id = ? LIMIT 1",
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
    "SELECT id, name, email, departemen_id, lokasikerja FROM employees WHERE email = ? LIMIT 1",
    [email]
  );
  return rows[0] || null;
}

async function findRoleByName(roleName) {
  const rows = await querySpk("SELECT id, role_name FROM roles WHERE role_name = ? LIMIT 1", [roleName]);
  return rows[0] || null;
}

async function getRolePermissions(roleId) {
  const rows = await querySpk(
    `SELECT p.permission_name
     FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = ?`,
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
    "SELECT id FROM permissions WHERE permission_name = ? LIMIT 1",
    [permissionName]
  );
  if (existing.length > 0) return { exists: true, id: existing[0].id };

  const result = await querySpk(
    "INSERT INTO permissions(permission_name, path) VALUES(?, ?)",
    [permissionName, pathValue || ""]
  );
  return { exists: false, id: result.insertId };
}

async function getOrCreateRoleByName(roleName) {
  const existing = await findRoleByName(roleName);
  if (existing) return existing;

  const result = await querySpk("INSERT INTO roles(role_name) VALUES(?)", [roleName]);
  return { id: result.insertId, role_name: roleName };
}

async function setRolePermissions(roleId, permissionIds) {
  await querySpk("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);
  if (!permissionIds || permissionIds.length === 0) return;

  const valuesSql = permissionIds.map(() => "(?, ?)").join(",");
  const params = permissionIds.flatMap((permissionId) => [roleId, permissionId]);
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
  getAllUsers
};
