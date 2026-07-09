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

/**
 * Validasi nama kolom agar hanya berisi alphanumeric dan underscore.
 * Mencegah SQL injection dari input user.
 */
function sanitizeColumnName(name) {
  return /^[A-Za-z0-9_.]+$/.test(name) ? name : null;
}

/**
 * Membantu menyusun query dengan pagination, search, filter, dan sort.
 */
function applyQueryMeta(baseSql, baseParams, options = {}, searchColumns = []) {
  let { search, filter, page, pageSize, sort } = options;
  let sql = baseSql;
  let params = [...baseParams];
  let whereClauses = [];

  const lowerSql = sql.toLowerCase();
  const hasWhere = lowerSql.includes("where");

  // 1. Search (LIKE across multiple columns) — gunakan searchColumns yang sudah ditentukan
  if (search && searchColumns.length > 0) {
    const validCols = searchColumns.filter(col => sanitizeColumnName(col));
    if (validCols.length > 0) {
      const searchConditions = validCols.map(col => `${col} LIKE ?`).join(" OR ");
      whereClauses.push(`(${searchConditions})`);
      validCols.forEach(() => params.push(`%${search}%`));
    }
  }

  // 2. Filter (Expects JSON object or string) — validasi nama kolom
  if (filter) {
    try {
      const filterObj = typeof filter === 'string' ? JSON.parse(filter) : filter;
      Object.entries(filterObj).forEach(([col, val]) => {
        if (val !== undefined && val !== null && val !== '') {
          const safeCol = sanitizeColumnName(col);
          if (safeCol) {
            whereClauses.push(`${safeCol} = ?`);
            params.push(val);
          }
        }
      });
    } catch (e) { /* ignore invalid json */ }
  }

  if (whereClauses.length > 0) {
    sql += (hasWhere ? " AND " : " WHERE ") + whereClauses.join(" AND ");
  }

  // Count SQL (dibuat sebelum penambahan ORDER BY dan LIMIT)
  const countSql = `SELECT COUNT(*) as total FROM (${sql}) AS t`;
  const countParams = [...params];

  // 3. Sort (format: "column:asc" atau "column:desc") — validasi nama kolom
  if (sort) {
    const validSortParts = [];
    const sortParts = sort.includes(",") ? sort.split(",") : [sort];
    
    sortParts.forEach(part => {
      const [col, dir] = part.trim().split(":");
      const safeCol = sanitizeColumnName(col);
      if (safeCol) {
        const direction = dir?.toLowerCase() === "desc" ? "DESC" : "ASC";
        validSortParts.push(`${safeCol} ${direction}`);
      }
    });

    if (validSortParts.length > 0) {
      const sortSql = validSortParts.join(", ");
      if (lowerSql.includes("order by")) {
        sql = sql.split(/order by/i)[0] + ` ORDER BY ${sortSql}`;
      } else {
        sql += ` ORDER BY ${sortSql}`;
      }
    }
  }

  // 4. Pagination
  if (page && pageSize) {
    const p = Math.max(1, parseInt(page));
    const ps = Math.max(1, parseInt(pageSize));
    sql += ` LIMIT ? OFFSET ?`;
    params.push(ps, (p - 1) * ps);
  }

  return { sql, params, countSql, countParams };
}

module.exports = {
  mitraPool,
  spkPool,
  queryMitra,
  querySpk,
  applyQueryMeta
};
