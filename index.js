require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const authRoutes = require("./routes/authRoutes");
const spkRoutes = require("./routes/spkRoutes");
const masterRoutes = require("./routes/masterRoutes");
const { runStartupSeedIfEnabled } = require("./services/startupSeed");

const app = express();
const swaggerPath = path.join(__dirname, "docs", "swagger.yaml");
const swaggerDocument = YAML.load(swaggerPath);

// =====================================================================
// TAMBAHAN: Otomatis membaca server tempat deploy
// =====================================================================
// Swagger akan menggunakan SERVER_URL dari variabel environment jika ada, 
// atau fallback ke "/" (yang artinya otomatis mengikuti domain saat ini).
swaggerDocument.servers = [
  {
    url: process.env.SERVER_URL || "/",
    description: "Current Deployment Server"
  }
];
// =====================================================================

app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/", (_req, res) => {
  res.json({
    service: "SPK API (Express)",
    status: "ok",
    message: "Niagahoster startup entrypoint ready"
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/spk", spkRoutes);
app.use("/api", masterRoutes);

app.get("/api/docs/swagger.yaml", (_req, res) => {
  return res.sendFile(swaggerPath);
});

// Pasang Swagger
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use((err, _req, res, _next) => {
  return res.status(500).json({
    success: false,
    message: "Internal Server Error",
    error: err.message
  });
});

const port = Number(process.env.PORT || 5000);
app.listen(port, async () => {
  // eslint-disable-next-line no-console
  console.log(`SPK API running on port ${port}`);

  try {
    await runStartupSeedIfEnabled();
    if (String(process.env.AUTO_SEED_PERMISSIONS || "false").toLowerCase() === "true") {
      // eslint-disable-next-line no-console
      console.log("AUTO_SEED_PERMISSIONS enabled: seed migration completed");
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("AUTO_SEED_PERMISSIONS failed:", error.message);
  }
});