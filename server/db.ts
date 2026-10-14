import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
  connectionLimit: number;
}

function buildDbConfig(): DbConfig {
  return {
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'cft_app',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'cft_tracker',
    connectionLimit: 10
  };
}

// Safe diagnostics without secret values — used by health/status endpoints.
export function getSafeDbConfig(): Omit<DbConfig, 'password'> & { hasPassword: boolean } {
  const cfg = buildDbConfig();
  return {
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    database: cfg.database,
    connectionLimit: cfg.connectionLimit,
    hasPassword: Boolean(process.env.MYSQL_PASSWORD)
  };
}

let pool: mysql.Pool | null = null;
let isConnected = false;

export async function getDbPool(): Promise<mysql.Pool | null> {
  // Reuse existing pool only after verifying it can still serve a connection.
  // This prevents health endpoints from falsely reporting connected after a drop.
  if (pool) {
    try {
      const conn = await pool.getConnection();
      try {
        await conn.ping();
      } finally {
        conn.release();
      }
      isConnected = true;
      return pool;
    } catch {
      // Pool is stale — fall through and rebuild below.
      try {
        await pool.end();
      } catch {
        // Ignore cleanup errors; a fresh pool will be attempted.
      }
      pool = null;
      isConnected = false;
    }
  }

  // Don't attempt to connect if credentials are not provided.
  // Requires explicit local config (e.g. .env with MYSQL_HOST/MYSQL_DATABASE).
  if (!process.env.MYSQL_HOST && !process.env.MYSQL_DATABASE) {
    isConnected = false;
    return null;
  }

  const dbConfig = buildDbConfig();

  try {
    pool = mysql.createPool({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database,
      waitForConnections: true,
      connectionLimit: dbConfig.connectionLimit,
      queueLimit: 0,
      connectTimeout: 10000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000
    });

    const conn = await pool.getConnection();
    try {
      await conn.ping();
    } finally {
      conn.release();
    }
    isConnected = true;
    // Never log user/password values here.
    console.log(`[Database] Connected to MySQL (${dbConfig.host}:${dbConfig.port}/${dbConfig.database})`);
    return pool;
  } catch (err: any) {
    console.warn(`[Database] MySQL connection skipped/unavailable: ${err.message}. Using fast local storage fallback.`);
    if (pool) {
      try {
        await pool.end();
      } catch {
        // Ignore cleanup errors on failed connect.
      }
    }
    pool = null;
    isConnected = false;
    return null;
  }
}

export function isDbConnected(): boolean {
  return isConnected && pool !== null;
}

export async function closeDbPool(): Promise<void> {
  if (pool) {
    try {
      await pool.end();
    } finally {
      pool = null;
      isConnected = false;
    }
  }
}
