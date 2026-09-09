import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultUrlFile = 'C:/Users/Admin/eco-db-backups/.pg-url.txt';

let url = process.env.PG_URL;
if (!url) {
  url = readFileSync(defaultUrlFile, 'utf8').trim();
}
const stamp = new Date().toISOString().slice(0, 10);
const defaultOutFile = path.join(
  'C:/Users/Admin/eco-db-backups',
  `ecohub-manual-${stamp}.sql`,
);
const outFile = process.env.DUMP_PATH || defaultOutFile;

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30000 });
await client.connect();

const schemaPath = process.env.SCHEMA_PATH || path.join(__dirname, 'sql', 'supabase-schema.sql');
const schema = existsSync(schemaPath) ? readFileSync(schemaPath, 'utf8') : '';

// tables in FK-safe order
const tables = ['users', 'items', 'recycling_points', 'eco_transactions', 'recycling_submissions', 'item_wants', 'item_favorites', 'chat_messages'];

const lines = [];
lines.push('-- EcoHub PostgreSQL dump (generated ' + new Date().toISOString() + ')');
lines.push('-- Schema + data, restorable on any PostgreSQL 13+');
lines.push('SET statement_timeout = 0;');
lines.push('SET client_encoding = \'UTF8\';');
lines.push('');
lines.push(schema.trimEnd());
lines.push('');

// sequence reset helper
const resetSeq = [];
for (const t of tables) {
  const colInfo = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='${t}' AND column_name='id'`);
  if (colInfo.rows.length) {
    resetSeq.push(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1));`);
  }
}

const dumpTable = async (t) => {
  const res = await client.query(`SELECT * FROM ${t} ORDER BY id`);
  const rows = res.rows;
  if (!rows.length) return;
  lines.push(`-- Table: ${t} (${rows.length} rows)`);
  const cols = Object.keys(rows[0]);
  const colList = cols.map((c) => `"${c}"`).join(', ');
  for (const row of rows) {
    const vals = cols.map((c) => {
      const v = row[c];
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'number') return String(v);
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      const s = String(v).replace(/'/g, "''");
      return `'${s}'`;
    });
    lines.push(`INSERT INTO ${t} (${colList}) VALUES (${vals.join(', ')});`);
  }
  lines.push('');
};

for (const t of tables) {
  await dumpTable(t);
}

const metaRes = await client.query('SELECT * FROM meta ORDER BY key');
if (metaRes.rows.length) {
  lines.push(`-- Table: meta (${metaRes.rows.length} rows)`);
  for (const row of metaRes.rows) {
    const kv = ['key', 'value'].map((c) => {
      const v = row[c];
      if (v === null || v === undefined) return 'NULL';
      const s = String(v).replace(/'/g, "''");
      return `'${s}'`;
    });
    lines.push(`INSERT INTO meta (key, value) VALUES (${kv.join(', ')});`);
  }
  lines.push('');
}

lines.push('-- Reset sequences');
for (const r of resetSeq) lines.push(r);

lines.push('');
lines.push('-- Dump complete');
mkdirSync(path.dirname(outFile) || '.', { recursive: true });
writeFileSync(outFile, lines.join('\n'), 'utf8');
console.log('DONE -> ' + outFile);
console.log('Bytes: ' + readFileSync(outFile).length);
await client.end();