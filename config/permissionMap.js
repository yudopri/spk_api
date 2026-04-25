const PERMISSION_MAP = {
  divisi_view: ["/apps/divisi"],
  kpi_manage: ["/apps/perbandingan", "/apps/data-kpi"],
  score_input: ["/apps/penilaian"],
  user_manage: ["/apps/user"],
  spk_view: ["/apps/spk", "/apps/hasil"],
  spk_manage: ["/apps/periode", "/apps/data-kpi", "/apps/perbandingan"],
  spk_calculate: ["/apps/perhitungan"],
  mitra_view: ["/apps/karyawan", "/apps/divisi"],
  employee_view: ["/apps/karyawan"],
  department_view: ["/apps/divisi"],
  periode_view: ["/apps/periode"],
  periode_manage: ["/apps/periode"],
  kpi_view: ["/apps/data-kpi"],
  audit_view: ["/apps/audit"]
};

module.exports = { PERMISSION_MAP };
