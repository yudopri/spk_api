require("dotenv").config();
const { querySpk } = require("../config/db");

async function migrate() {
  try {
    console.log("Starting migration...");
    
    await querySpk(`
      CREATE TABLE IF NOT EXISTS kpi_groups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nama_grup VARCHAR(100) NOT NULL,
        periode_id INT NOT NULL,
        bobot_grup DECIMAL(10,4) DEFAULT 0,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (periode_id)
      )
    `);
    console.log("- Table kpi_groups created or already exists.");

    await querySpk(`
      CREATE TABLE IF NOT EXISTS kpi_group_comparisons (
        id INT AUTO_INCREMENT PRIMARY KEY,
        periode_id INT NOT NULL,
        group_a_id INT NOT NULL,
        group_b_id INT NOT NULL,
        nilai DECIMAL(10,4) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (periode_id),
        INDEX (group_a_id),
        INDEX (group_b_id)
      )
    `);
    console.log("- Table kpi_group_comparisons created or already exists.");

    // Check if group_id column exists in kpis
    const columns = await querySpk("SHOW COLUMNS FROM kpis LIKE 'group_id'");
    if (columns.length === 0) {
      await querySpk("ALTER TABLE kpis ADD COLUMN group_id INT NULL");
      console.log("- Column group_id added to kpis table.");
    } else {
      console.log("- Column group_id already exists in kpis table.");
    }

    console.log("Migration finished successfully.");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

migrate();
