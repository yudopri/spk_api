const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("FATAL: JWT_SECRET environment variable is not set. Server cannot start.");
  process.exit(1);
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

function authenticateToken(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ message: "Missing bearer token" });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

function requireRefreshToken(req, res, next) {
  if (!req.user || req.user.token_type !== "refresh") {
    return res.status(401).json({ message: "Refresh token required" });
  }
  return next();
}

module.exports = {
  authenticateToken,
  requireRefreshToken
};
