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

  let rawPeriodId =
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
    if (req.params?.id && req.path.includes("/kpi/")) {
      const kpiRows = await querySpk(
        "SELECT PeriodeId FROM kpis WHERE Id = ? LIMIT 1",
        [req.params.id]
      );
      rawPeriodId = kpiRows[0]?.PeriodeId;
    }
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
    if (["processed", "final", "closed", "locked", "finalized"].includes(status)) {
      return res.status(403).json({
        success: false,
        message: "Periode sudah diproses/final dan tidak dapat diubah."
      });
    }

    next();
  } catch (error) {
    console.error("[FREEZE MIDDLEWARE ERROR]", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
}

module.exports = { checkPeriodStatus };
