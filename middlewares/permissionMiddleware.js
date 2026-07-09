const { PERMISSION_MAP } = require("../config/permissionMap");

function hasPermission(permissionName) {
  return (req, res, next) => {
    const claims = req.user || {};
    const permissions = claims.permissions || [];

    if (permissions.includes(permissionName)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: `Anda tidak memiliki izin '${permissionName}'`
    });
  };
}

function hasRole(allowedRoles) {
  const normalized = (Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles]).map((r) => String(r || "").trim().toLowerCase());
  return (req, res, next) => {
    const currentRole = String(req.user?.role || "").trim().toLowerCase();
    if (normalized.includes(currentRole)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: "Role tidak memiliki akses ke endpoint ini"
    });
  };
}

module.exports = { hasPermission, hasRole };
