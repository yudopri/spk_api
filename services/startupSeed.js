const {
  createPermission,
  getAllPermissions,
  getOrCreateRoleByName,
  setRolePermissions
} = require("../models/authModel");

async function seedPermissionsData() {
  const permissionsList = [
    { name: "user_manage", path: "/api/auth/*" },
    { name: "spk_view", path: "/api/spk/view" },
    { name: "spk_manage", path: "/api/spk/manage" },
    { name: "spk_calculate", path: "/api/spk/calculate" },
    { name: "mitra_view", path: "/api/spk/mitra/*" },
    { name: "audit_view", path: "/api/auth/audit-logs" },
    { name: "employee_view", path: "/api/spk/mitra/karyawan" },
    { name: "department_view", path: "/api/spk/mitra/departments" },
    { name: "periode_view", path: "/api/spk/periode" },
    { name: "periode_manage", path: "/api/spk/periode" },
    { name: "kpi_view", path: "/api/spk/kpi" },
    { name: "kpi_manage", path: "/api/spk/kpi" },
    { name: "divisi_view", path: "/api/departments" },
    { name: "score_input", path: "/api/spk/moora/penilaian" }
  ];

  for (const permission of permissionsList) {
    await createPermission(permission.name, permission.path);
  }

  const allPerms = await getAllPermissions();
  const permByName = new Map(allPerms.map((perm) => [perm.permission_name, perm.id]));

  const defaultMapping = {
    Admin: [
      "spk_view",
      "employee_view",
      "department_view",
      "divisi_view"
    ],
    Manager: [
      "user_manage",
      "spk_view",
      "spk_manage",
      "spk_calculate",
      "mitra_view",
      "audit_view",
      "employee_view",
      "department_view",
      "periode_view",
      "periode_manage",
      "kpi_view",
      "kpi_manage",
      "divisi_view",
      "score_input"
    ],
    Hrd: [
      "spk_view",
      "employee_view",
      "department_view",
      "periode_view",
      "kpi_view",
      "divisi_view",
    ],
    Kadiv: [
      "spk_view",
      "spk_manage",
      "spk_calculate",
      "mitra_view",
      "employee_view",
      "department_view",
      "periode_view",
      "periode_manage",
      "kpi_view",
      "kpi_manage",
      "divisi_view",
      "score_input"
    ],
    Dev: ["audit_view"],
    "Adm Karyawan": ["spk_view", "employee_view", "department_view",, "divisi_view"],
    Karyawan: ["spk_view", "employee_view", "department_view", "divisi_view"],
    "Adm Logistik": ["spk_view", "employee_view", "department_view",, "divisi_view"],
    "Adm Lapangan": ["spk_view", "employee_view", "department_view",, "divisi_view"],
    "Adm Keuangan": ["spk_view", "employee_view", "department_view",, "divisi_view"],
    "Adm Pajak": ["spk_view", "employee_view", "department_view",, "divisi_view"],
    "Adm Bpjs": ["spk_view", "employee_view", "department_view",, "divisi_view"]
  };

  for (const [roleName, permissionNames] of Object.entries(defaultMapping)) {
    const role = await getOrCreateRoleByName(roleName);
    const permissionIds = permissionNames.map((name) => permByName.get(name)).filter(Boolean);
    await setRolePermissions(role.id, permissionIds);
  }
}

async function runStartupSeedIfEnabled() {
  const enabled = String(process.env.AUTO_SEED_PERMISSIONS || "false").toLowerCase() === "true";
  if (!enabled) return;

  await seedPermissionsData();
}

module.exports = {
  seedPermissionsData,
  runStartupSeedIfEnabled
};
