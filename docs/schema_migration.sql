-- SPK Database Schema Migration
-- Author: GitHub Copilot
-- Description: Dynamic Period Snapshot for Employee Performance SPK

-- 1. Table Periode
-- Stores evaluation cycles (e.g., Q1 2026). Status 'finalized' triggers data freezing.
CREATE TABLE IF NOT EXISTS periodes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nama_periode VARCHAR(100) NOT NULL,
    status ENUM('draft', 'finalized') DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 2. Table KPI Master
-- The master library of all possible performance criteria.
CREATE TABLE IF NOT EXISTS kpi_masters (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nama_kriteria VARCHAR(255) NOT NULL,
    deskripsi TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Table KPI Periode (Snapshot)
-- Stores a snapshot of KPI for a specific period. 
-- Dynamic: you can change weights per period.
CREATE TABLE IF NOT EXISTS kpi_periodes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    periode_id INT NOT NULL,
    kpi_master_id INT NOT NULL,
    bobot_ahp DECIMAL(5, 4) DEFAULT 0.0000,
    status_aktif BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (periode_id) REFERENCES periodes(id) ON DELETE CASCADE,
    FOREIGN KEY (kpi_master_id) REFERENCES kpi_masters(id) ON DELETE CASCADE
);

-- 4. Table Karyawan
CREATE TABLE IF NOT EXISTS employees (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nama VARCHAR(255) NOT NULL,
    divisi_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Table Penilaian
-- Record of scores given to an employee for a specific KPI Snapshot.
CREATE TABLE IF NOT EXISTS penilaians (
    id INT AUTO_INCREMENT PRIMARY KEY,
    karyawan_id INT NOT NULL,
    kpi_periode_id INT NOT NULL,
    nilai_karyawan DECIMAL(10, 2) NOT NULL,
    FOREIGN KEY (karyawan_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY (kpi_periode_id) REFERENCES kpi_periodes(id) ON DELETE CASCADE
);

-- Relations Overview:
-- Period -> (1:N) -> KPI_Periode (Snapshot of KPI_Master)
-- KPI_Periode -> (1:N) -> Penilaian
-- Karyawan -> (1:N) -> Penilaian
