const { createClient } = require("@supabase/supabase-js");

// ─── Timeout & Retry Configuration ──────────────────────────
const DB_TIMEOUT_MS = Number(process.env.DB_TIMEOUT_MS || 8000);
const DB_MAX_RETRIES = Number(process.env.DB_MAX_RETRIES || 2);

// ─── Supabase Clients ────────────────────────────────────────
const mitraSupabase = createClient(
  process.env.MITRA_SUPABASE_URL,
  process.env.MITRA_SUPABASE_KEY
);

const spkSupabase = createClient(
  process.env.SPK_SUPABASE_URL,
  process.env.SPK_SUPABASE_KEY
);

// ─── Read-Only Assertion ─────────────────────────────────────
function assertReadOnly(sql) {
  const statement = String(sql || "").trim().toLowerCase();
  if (
    !statement.startsWith("select") &&
    !statement.startsWith("show") &&
    !statement.startsWith("describe")
  ) {
    throw new Error(
      "Mitra DB is read-only. Only SELECT/SHOW/DESCRIBE are allowed."
    );
  }
}

// ─── Supabase Raw Query Helper ───────────────────────────────
// Supabase doesn't support raw SQL directly via the JS client.
// We use the PostgREST-compatible query builder instead.
// For complex queries, use rpc() with PostgreSQL functions.

/**
 * Execute a raw SQL query via Supabase RPC.
 * Requires a PostgreSQL function to be created in the database.
 *
 * CREATE OR REPLACE FUNCTION exec_sql(sql_text TEXT, params TEXT[] DEFAULT '{}')
 * RETURNS SETOF JSON AS $$
 * DECLARE
 *   _sql TEXT;
 *   _i INT;
 *   _row JSON;
 * BEGIN
 *   IF params IS NULL OR array_length(params, 1) IS NULL THEN
 *     FOR _row IN EXECUTE 'SELECT row_to_json(t) FROM (' || sql_text || ') t' LOOP
 *       RETURN NEXT _row;
 *     END LOOP;
 *   ELSE
 *     _sql := sql_text;
 *     FOR _i IN REVERSE array_length(params, 1) .. 1 LOOP
 *       _sql := regexp_replace(_sql, '\$' || _i, quote_literal(params[_i]), 'g');
 *     END LOOP;
 *     FOR _row IN EXECUTE 'SELECT row_to_json(t) FROM (' || _sql || ') t' LOOP
 *       RETURN NEXT _row;
 *     END LOOP;
 *   END IF;
 * END;
 * $$ LANGUAGE plpgsql;
 */
function withTimeout(promise, ms, label = "query") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`DB_TIMEOUT: ${label} exceeded ${ms}ms`)), ms)
    )
  ]);
}

async function execSqlRawWithRetry(supabaseClient, sql, params = [], attempt = 1) {
  try {
    const { data, error } = await withTimeout(
      supabaseClient.rpc("exec_sql", { sql_text: sql, params }),
      DB_TIMEOUT_MS,
      sql.substring(0, 80)
    );
    if (error) {
      console.error("[EXEC_SQL ERROR]", { sql: sql.substring(0, 200), params, error });
      throw error;
    }
    console.log("[EXEC_SQL_DEBUG] sql:", sql.substring(0, 150), "data:", JSON.stringify(data)?.substring(0, 500), "dataLength:", Array.isArray(data) ? data.length : typeof data);
    return data || [];
  } catch (err) {
    const isRetryable = err.message?.includes("DB_TIMEOUT") || err.code === "ECONNRESET" || err.status >= 502;
    if (isRetryable && attempt <= DB_MAX_RETRIES) {
      const delay = Math.min(300 * Math.pow(2, attempt - 1), 2000);
      await new Promise((r) => setTimeout(r, delay));
      return execSqlRawWithRetry(supabaseClient, sql, params, attempt + 1);
    }
    throw err;
  }
}

async function execSqlRaw(supabaseClient, sql, params = []) {
  return execSqlRawWithRetry(supabaseClient, sql, params, 1);
}

// ─── Query Mitra (Read-Only) ─────────────────────────────────
async function queryMitra(sql, params = []) {
  assertReadOnly(sql);
  return execSqlRaw(mitraSupabase, sql, params);
}

// ─── Query SPK (Read/Write) ──────────────────────────────────
async function querySpk(sql, params = []) {
  return execSqlRaw(spkSupabase, sql, params);
}

// ─── Supabase Query Builder Helpers ──────────────────────────
// These functions use Supabase's native query builder for better performance.
// Use these for simple CRUD operations instead of raw SQL.

function mitraFrom(table) {
  return mitraSupabase.from(table);
}

function spkFrom(table) {
  return spkSupabase.from(table);
}

// ─── Column Name Sanitizer ───────────────────────────────────
// Auto-quotes identifiers so Supabase case-sensitive columns work.
function sanitizeColumnName(name) {
  if (!name || name === "*") return name || null;
  if (/^".*"$/.test(name)) return name;
  if (/^[A-Za-z0-9_.]+$/.test(name)) {
    if (name.includes(".")) {
      const parts = name.split(".");
      return parts.map((p) => `"${p}"`).join(".");
    }
    return `"${name}"`;
  }
  return null;
}

// ─── Query Meta (Pagination, Search, Filter, Sort) ──────────
function applyQueryMeta(baseSql, baseParams, options = {}, searchColumns = []) {
  let { search, filter, page, pageSize, sort } = options;
  let sql = baseSql;
  let params = [...baseParams];
  let whereClauses = [];

  const lowerSql = sql.toLowerCase();
  const hasWhere = lowerSql.includes("where");

  // 1. Search (LIKE across multiple columns)
  if (search && searchColumns.length > 0) {
    const validCols = searchColumns.filter((col) => sanitizeColumnName(col));
    if (validCols.length > 0) {
      const searchConditions = validCols
        .map((col) => `${col} ILIKE $${params.length + 1}`)
        .join(" OR ");
      whereClauses.push(`(${searchConditions})`);
      params.push(`%${search}%`);
    }
  }

  // 2. Filter
  if (filter) {
    try {
      const filterObj =
        typeof filter === "string" ? JSON.parse(filter) : filter;
      Object.entries(filterObj).forEach(([col, val]) => {
        if (val !== undefined && val !== null && val !== "") {
          const safeCol = sanitizeColumnName(col);
          if (safeCol) {
            whereClauses.push(`${safeCol} = $${params.length + 1}`);
            params.push(val);
          }
        }
      });
    } catch (e) {
      /* ignore invalid json */
    }
  }

  if (whereClauses.length > 0) {
    sql += (hasWhere ? " AND " : " WHERE ") + whereClauses.join(" AND ");
  }

  // Count SQL (before ORDER BY and LIMIT)
  const countSql = `SELECT COUNT(*) as total FROM (${sql}) AS t`;
  const countParams = [...params];

  // 3. Sort (format: "column:asc" atau "column:desc")
  if (sort) {
    const validSortParts = [];
    const sortParts = sort.includes(",") ? sort.split(",") : [sort];

    sortParts.forEach((part) => {
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
  const hasPage =
    page !== undefined && page !== null && page !== "";
  const hasPageSize =
    pageSize !== undefined && pageSize !== null && pageSize !== "";
  if (hasPage || hasPageSize) {
    const p = Math.max(1, parseInt(hasPage ? page : 1, 10) || 1);
    const ps = Math.max(
      1,
      parseInt(hasPageSize ? pageSize : 10, 10) || 10
    );
    sql += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(ps, (p - 1) * ps);
  }

  return { sql, params, countSql, countParams };
}

module.exports = {
  mitraSupabase,
  spkSupabase,
  queryMitra,
  querySpk,
  mitraFrom,
  spkFrom,
  applyQueryMeta,
};
