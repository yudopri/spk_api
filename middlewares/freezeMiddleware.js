const { querySpk } = require("../config/db");

/**
 * Middleware to check if a period is finalized.
 * If finalized, mutations (POST, PUT, DELETE) are forbidden.
 * 
 * Expectations:
 * - req.body.periode_id OR req.params.periode_id exists
 */
async function checkPeriodStatus(req, res, next) {
  const method = req.method;
  
  // Only intercept mutation requests
  if (!["POST", "PUT", "DELETE"].includes(method)) {
    return next();
  }

  // Find period_id from various possible locations
  let periodId = req.body.periode_id || req.params.periode_id || req.query.periode_id;

  // Extra check for routes with :periode_id or requests that provide it
  if (!periodId && (req.params.id || req.body.id)) {
    // If we're updating a specific record, we might need a DB lookup to find its period
    // For now, we assume period context is passed. In a real production app, 
    // you would query the table (e.g., kpi_periodes) to find the periode_id for that :id.
  }

  if (!periodId) {
    // If no period context is provided, we can't check. 
    // Depending on security policy, we might allow or deny. 
    // Here we allow it to proceed to other validations.
    return next();
  }

  try {
    const rows = await querySpk(
      "SELECT status FROM periodes WHERE id = ? LIMIT 1",
      [periodId]
    );

    if (rows.length > 0 && rows[0].status === "finalized") {
      return res.status(403).json({
        success: false,
        message: "403 Forbidden: Data pada periode ini telah dikunci (Finalized)."
      });
    }

    next();
  } catch (error) {
    res.status(500).json({ success: false, message: "Middleware error: " + error.message });
  }
}

module.exports = { checkPeriodStatus };
