const { querySpk } = require("../config/db");

/**
 * Middleware to block mutations on locked periods.
 * Supported status flow:
 * draft -> open -> closed -> processed -> locked
 */
async function checkPeriodStatus(req, res, next) {
  const method = req.method;

  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return next();
  }

  const rawPeriodId =
    req.body?.periode_id ??
    req.body?.PeriodeId ??
    req.params?.periode_id ??
    req.params?.id ??
    req.query?.periode_id ??
    req.query?.PeriodeId;

  if (!rawPeriodId) {
    return next();
  }

  try {
    const periodId = Number(rawPeriodId);
    if (!Number.isFinite(periodId) || periodId <= 0) {
      return res.status(400).json({
        success: false,
        message: "periode_id tidak valid"
      });
    }

    const rows = await querySpk(
      "SELECT status FROM periodes WHERE id = ? LIMIT 1",
      [periodId]
    );

    const status = String(rows[0]?.status || "").toLowerCase();
    if (status === "locked") {
      return res.status(403).json({
        success: false,
        message: "Data pada periode ini sudah terkunci dan tidak dapat diubah."
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({ success: false, message: "Middleware error: " + error.message });
  }
}

module.exports = { checkPeriodStatus };
