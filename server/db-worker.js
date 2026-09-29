/* PostgreSQL worker used by db.js.
 * The application was originally written around synchronous better-sqlite3.
 * This worker preserves that small synchronous statement API while the actual
 * PostgreSQL driver remains asynchronous off the main event loop.
 */
const { parentPort, workerData } = require('worker_threads');
const { Pool, Client } = require('pg');

const connectionString = workerData.connectionString || process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) throw new Error('DATABASE_URL is required. Create a PostgreSQL database and set DATABASE_URL.');

const pool = new Pool({
  connectionString,
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  max: Number(process.env.PGPOOL_MAX || 5),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

let txClient = null;

function prepareSql(sql, params) {
  if (params && !Array.isArray(params) && typeof params === 'object') {
    const values = [];
    const converted = String(sql).replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_, key) => {
      values.push(params[key]);
      return '$' + values.length;
    });
    return { text: converted, values };
  }
  const values = Array.isArray(params) ? params : [];
  let i = 0;
  const text = String(sql).replace(/\?/g, () => '$' + (++i));
  return { text, values };
}

function translateSql(sql) {
  let text = String(sql);
  const ignoreInsert = /INSERT\s+OR\s+IGNORE\s+INTO/i.test(text);
  text = text.replace(/INSERT\s+OR\s+IGNORE\s+INTO/ig, 'INSERT INTO');
  if (ignoreInsert && !/ON\s+CONFLICT/i.test(text)) {
    text = text.replace(/;\s*$/, '') + ' ON CONFLICT DO NOTHING';
  }
  // PostgreSQL uses BIGSERIAL for SQLite's INTEGER PRIMARY KEY AUTOINCREMENT.
  text = text.replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/ig, 'BIGSERIAL PRIMARY KEY');
  return text;
}

async function query(text, values) {
  const client = txClient || pool;
  return client.query(text, values);
}

async function execute(message) {
  const { op, sql, params } = message;
  if (op === 'begin') {
    if (txClient) throw new Error('Nested transactions are not supported.');
    txClient = await pool.connect();
    await txClient.query('BEGIN');
    return { ok: true };
  }
  if (op === 'commit') {
    if (!txClient) return { ok: true };
    await txClient.query('COMMIT');
    txClient.release();
    txClient = null;
    return { ok: true };
  }
  if (op === 'rollback') {
    if (!txClient) return { ok: true };
    try { await txClient.query('ROLLBACK'); } finally { txClient.release(); txClient = null; }
    return { ok: true };
  }

  const prepared = prepareSql(translateSql(sql), params);
  const result = await query(prepared.text, prepared.values);
  if (op === 'all') return result.rows;
  if (op === 'get') return result.rows[0] || undefined;
  if (op === 'run') return { changes: result.rowCount };
  if (op === 'exec') return { changes: result.rowCount };
  throw new Error('Unknown database operation: ' + op);
}

parentPort.on('message', async ({ sab, message }) => {
  const status = new Int32Array(sab, 0, 2);
  const buffer = new Uint8Array(sab, 8);
  try {
    const result = await execute(message);
    const payload = Buffer.from(JSON.stringify({ ok: true, result }));
    if (payload.length > buffer.length) throw new Error('Database response is too large for the worker buffer.');
    buffer.fill(0);
    buffer.set(payload);
    Atomics.store(status, 1, payload.length);
    Atomics.store(status, 0, 1);
    Atomics.notify(status, 0);
  } catch (error) {
    const payload = Buffer.from(JSON.stringify({ ok: false, error: {
      name: error.name, message: error.message, code: error.code, detail: error.detail, constraint: error.constraint
    }}));
    buffer.fill(0);
    buffer.set(payload.slice(0, buffer.length));
    Atomics.store(status, 1, Math.min(payload.length, buffer.length));
    Atomics.store(status, 0, 2);
    Atomics.notify(status, 0);
  }
});
