// Test harness. Each test file calls setup() once: it re-creates a throwaway
// database (TEST_DB_NAME, default sd_maintenance_test - never the real one),
// applies all migrations, seeds an administrator and starts the API on a
// random port. Emails run in dry-run mode, so nothing is ever sent.
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const TEST_DB = process.env.TEST_DB_NAME || 'sd_maintenance_test';
if (!/_test$/.test(TEST_DB)) {
  throw new Error(`TEST_DB_NAME must end with "_test" (got "${TEST_DB}"); the test database is dropped and re-created.`);
}

// Must be set before any application module is loaded
Object.assign(process.env, {
  DB_NAME: TEST_DB,
  NODE_ENV: 'test',
  EMAIL_DRY_RUN: 'true',
  NOTIFY_TO: 'qa-team@example.test',
  AUTH_RATE_LIMIT: '100000',
  JWT_SECRET: process.env.JWT_SECRET || 'test-only-secret',
});

const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');

const ADMIN = { userName: 'admin', password: `T${crypto.randomBytes(8).toString('hex')}9` };

async function recreateDatabase() {
  const client = new Client({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: 'postgres',
  });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await client.end();
  }
}

/**
 * Fresh database + running API. Returns a context:
 *   ctx.api(method, url, body?, token?) -> { status, body }
 *   ctx.download(url, token?)            -> { status, buffer, headers }
 *   ctx.upload(url, rows, token?)        -> api result (rows = array of arrays, first = header)
 *   ctx.login(userName, password)        -> token
 *   ctx.adminToken, ctx.pool, ctx.close()
 */
async function setup() {
  await recreateDatabase();
  const { pool } = require('../config/db');
  const { runMigrations } = require('../scripts/migrate');
  await runMigrations(pool, { log: () => {} });
  await pool.query(
    `INSERT INTO users (user_name, user_email, password_hash, status, is_admin, created_by)
     VALUES ($1, 'admin@example.test', $2, 'Active', TRUE, 'test')`,
    [ADMIN.userName, await bcrypt.hash(ADMIN.password, 4)]
  );

  const app = require('../app');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;

  const ctx = { pool, base };

  ctx.api = async (method, url, body, token = ctx.adminToken) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + url, { method, headers, body: payload });
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    return { status: res.status, body: json };
  };

  ctx.download = async (url, token = ctx.adminToken) => {
    const res = await fetch(base + url, { headers: { Authorization: `Bearer ${token}` } });
    return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
  };

  ctx.upload = async (url, rows, token = ctx.adminToken, fileName = 'upload.xlsx') => {
    const form = new FormData();
    form.append('file', new Blob([await buildXlsx(rows)]), fileName);
    return ctx.api('POST', url, form, token);
  };

  ctx.login = async (userName, password) => {
    const res = await ctx.api('POST', '/auth/login', { userName, password }, null);
    if (res.status !== 200) throw new Error(`login ${userName} failed: ${res.body.message}`);
    return res.body.token;
  };

  ctx.adminToken = await ctx.login(ADMIN.userName, ADMIN.password);
  ctx.adminPassword = ADMIN.password;

  ctx.close = async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  };
  return ctx;
}

// rows: array of arrays (first row = header). Date values become Excel dates.
async function buildXlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// First sheet of an .xlsx buffer as objects keyed by header
async function readXlsx(buffer) {
  const { cellText } = require('../utils/excel');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  const headers = [];
  ws.getRow(1).eachCell((c, i) => { headers[i] = cellText(c.value); });
  const out = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const o = {};
    headers.forEach((h, i) => { if (h) o[h] = row.getCell(i).value; });
    out.push(o);
  });
  return out;
}

// Creates a cost center and a Level 1 > 2 > 3 location path; returns their ids
async function createMasters(ctx, suffix = '') {
  const cc = (await ctx.api('POST', '/cost-centers', { name: `Test CC${suffix}` })).body.data;
  const l1 = (await ctx.api('POST', '/locations/1', { name: `Region${suffix}` })).body.data;
  const l2 = (await ctx.api('POST', '/locations/2', { name: `City${suffix}`, l1Id: l1.l1_id })).body.data;
  const l3 = (await ctx.api('POST', '/locations/3', { name: `Site${suffix}`, l1Id: l1.l1_id, l2Id: l2.l2_id })).body.data;
  return { cc, l1, l2, l3 };
}

// JSON body for POST /sd-master using createMasters() output
function sdBody(m, overrides = {}) {
  return {
    costCenterId: m.cc.cost_center_id, l1Id: m.l1.l1_id, l2Id: m.l2.l2_id, l3Id: m.l3.l3_id,
    landlordStatus: 'Active', buildingStatus: 'Active', floor: '1', agreementValue: '1000000',
    ...overrides,
  };
}

module.exports = { setup, buildXlsx, readXlsx, createMasters, sdBody };
