const ADMIN_ADM_VIEW_ONLY_ROLES = [
  "Admin",
  "Adm Karyawan",
  "Adm Logistik",
  "Adm Lapangan",
  "Adm Keuangan",
  "Adm Pajak",
  "Adm Bpjs"
];

const FULL_ACCESS_ROLES = ["Manager", "Kadiv"];
const EMPLOYEE_ROLE = "Karyawan";
const DEV_ROLE = "Dev";

const MANAGEMENT_ROLES_FOR_GROUPING = [
  "Admin",
  "Manager",
  "Adm Karyawan",
  "Adm Logistik",
  "Adm Lapangan",
  "Adm Keuangan",
  "Adm Pajak",
  "Adm Bpjs",
  "Kadiv",
  "Dev"
];

function normalizeRole(role) {
  return String(role || "").trim();
}

function isAdminAdmViewOnlyRole(role) {
  return ADMIN_ADM_VIEW_ONLY_ROLES.includes(normalizeRole(role));
}

function isFullAccessRole(role) {
  return FULL_ACCESS_ROLES.includes(normalizeRole(role));
}

function isEmployeeRole(role) {
  return normalizeRole(role) === EMPLOYEE_ROLE;
}

function isDevRole(role) {
  return normalizeRole(role).toLowerCase() === DEV_ROLE.toLowerCase();
}

function isManagementRoleForGrouping(role) {
  return MANAGEMENT_ROLES_FOR_GROUPING.includes(normalizeRole(role));
}

module.exports = {
  ADMIN_ADM_VIEW_ONLY_ROLES,
  FULL_ACCESS_ROLES,
  EMPLOYEE_ROLE,
  DEV_ROLE,
  MANAGEMENT_ROLES_FOR_GROUPING,
  isAdminAdmViewOnlyRole,
  isFullAccessRole,
  isEmployeeRole,
  isDevRole,
  isManagementRoleForGrouping
};