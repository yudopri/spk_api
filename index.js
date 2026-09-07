require("dotenv").config();

process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED_REJECTION]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT_EXCEPTION]", err);
});

const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const YAML = require("yamljs");
const authRoutes = require("./routes/authRoutes");
const spkRoutes = require("./routes/spkRoutes");
const masterRoutes = require("./routes/masterRoutes");
const spkEngineRoutes = require("./routes/spkEngineRoutes");
const { runStartupSeedIfEnabled } = require("./services/startupSeed");

const app = express();
const isProd = process.env.NODE_ENV === "production";

// ── Helmet (security headers) ──────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// ── CORS ───────────────────────────────────────────────────────────
// Production: restrict via CORS_ORIGINS (comma-separated).
// Development: allow all for easy testing.
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map(o => o.trim())
  : [];

app.use(cors({
  origin: isProd && allowedOrigins.length > 0
    ? (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      }
    : undefined, // undefined = allow all (dev mode)
  credentials: true
}));

// ── Body parser ────────────────────────────────────────────────────
app.use(express.json({ limit: isProd ? "1mb" : "5mb" }));

// ── Global rate limit ──────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: isProd ? 200 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please try again later." }
}));

// ── Login rate limit (brute-force protection) ──────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 10 : 50,
  message: { status: "error", message: "Too many login attempts, please try again later." },
  standardHeaders: true,
  legacyHeaders: false
});
app.use("/api/auth/login", loginLimiter);

// ── Swagger YAML (load once) ────────────────────────────────────────
const swaggerEnabled = process.env.SWAGGER_ENABLED !== "false" || !isProd;
const swaggerPath = path.join(__dirname, "docs", "swagger.yaml");
let swaggerDocument = null;

try {
  swaggerDocument = YAML.load(swaggerPath);
  swaggerDocument.servers = [
    {
      url: process.env.SERVER_URL || "/",
      description: "Current Deployment Server"
    }
  ];
} catch (e) {
  console.warn("[SWAGGER] Failed to load swagger.yaml:", e.message);
}

// ── Routes ─────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({
    service: "SPK API (Express)",
    status: "ok",
    message: "Niagahoster startup entrypoint ready"
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/spk", spkRoutes);
app.use("/api", spkEngineRoutes);
app.use("/api", masterRoutes);

if (swaggerEnabled && swaggerDocument) {
  app.get("/api/docs/swagger.json", (_req, res) => {
    return res.json(swaggerDocument);
  });

  app.get("/api/docs", (_req, res) => {
    res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SPK API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: "/api/docs/swagger.json", dom_id: "#swagger-ui", presets: [SwaggerUIBundle.presets.apis], layout: "BaseLayout" });
  </script>
</body>
</html>`);
  });
} else {
  app.use("/api/docs", (_req, res) => {
    return res.status(404).json({ success: false, message: "Swagger not available" });
  });
}

// ── 404 handler ────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: "Not found" });
});

// ── Global error handler (sanitize — jangan leak err.message) ──────
app.use((err, _req, res, _next) => {
  console.error("[ERROR]", err);
  return res.status(500).json({
    success: false,
    message: "Internal Server Error"
  });
});

const port = Number(process.env.PORT || 5000);

// Vercel serverless: export app, skip listen
if (process.env.VERCEL) {
  app.maxDuration = 30;
  module.exports = app;
} else {
  app.listen(port, async () => {
    console.log(`SPK API running on port ${port} [${isProd ? "production" : "development"}]`);

    if (!swaggerEnabled) {
      console.log("Swagger docs: DISABLED");
    }

    try {
      await runStartupSeedIfEnabled();
      if (String(process.env.AUTO_SEED_PERMISSIONS || "false").toLowerCase() === "true") {
        console.log("AUTO_SEED_PERMISSIONS enabled: seed migration completed");
      }
    } catch (error) {
      console.error("AUTO_SEED_PERMISSIONS failed:", error.message);
    }
  });
}