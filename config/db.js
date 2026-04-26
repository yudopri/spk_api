const mysql = require("mysql2/promise");

const mitraPool = mysql.createPool({
  host: process.env.MITRA_DB_HOST ,
  port: Number(process.env.MITRA_DB_PORT),
  user: process.env.MITRA_DB_USER,
  password: process.env.MITRA_DB_PASSWORD,
  database: process.env.MITRA_DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(process.env.MITRA_DB_POOL),
  queueLimit: 0
});

const spkPool = mysql.createPool({
  host: process.env.SPK_DB_HOST,
  port: Number(process.env.SPK_DB_PORT),
  user: process.env.SPK_DB_USER,
  password: process.env.SPK_DB_PASSWORD,
  database: process.env.SPK_DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(process.env.SPK_DB_POOL),
  queueLimit: 0
});

function assertReadOnly(sql) {
  const statement = String(sql || "").trim().toLowerCase();
  if (!statement.startsWith("select") && !statement.startsWith("show") && !statement.startsWith("describe")) {
    throw new Error("Mitra DB is read-only. Only SELECT/SHOW/DESCRIBE are allowed.");
  }
}

async function queryMitra(sql, params = []) {
  assertReadOnly(sql);
  const [rows] = await mitraPool.query(sql, params);
  return rows;
}

async function querySpk(sql, params = []) {
  const [rows] = await spkPool.query(sql, params);
  return rows;
}

module.exports = {
  mitraPool,
  spkPool,
  queryMitra,
  querySpk
};
