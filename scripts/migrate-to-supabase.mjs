import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from '../server/node_modules/pg/lib/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const srcUrl =
  process.env.SRC_URL ||
  fs.readFileSync('C:/Users/Admin/eco-db-backups/.pg-url.txt', 'utf8').trim();
const dstUrl = process.env.TARGET_URL;
if (!dstUrl) {
  console.error('TARGET_URL (Supabase direct connection) is required');
  process.exit(1);
}

const src = new pg.Client({ connectionString: srcUrl, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30000 });
const dst = new pg.Client({ connectionString: dstUrl, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30000 });

function topoOrder(tables, deps) {
  const order = [];
  const visited = new Set();
  const visit = (t, stack) => {
    if (visited.has(t)) return;
    if (stack.has(t)) throw new Error(`FK cycle involving ${t}`);
    stack.add(t);
    for (const d of deps[t] || []) visit(d, stack);
    stack.delete(t);
    visited.add(t);
    order.push(t);
  };
  for (const t of tables) visit(t, new Set());
  return order;
}

async function main() {
  await src.connect();
  await dst.connect();
  console.log('Connected to source and target');
  console.log(`Source: ${srcUrl.replace(/:[^:@/]+@/, ':***@')}`);
  console.log(`Target: ${dstUrl.replace(/:[^:@/]+@/, ':***@')}`);

  const schemaPath = path.join(root, 'server', 'sql', 'supabase-schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  console.log('Applying supabase-schema.sql to target...');
  await dst.query(schema);
  console.log('Schema applied');

  const tablesRes = await src.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
  );
  const tables = tablesRes.rows.map((r) => r.table_name);

  const deps = {};
  for (const t of tables) {
    const fk = await src.query(
      `SELECT ccu.table_name AS ref
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1 AND tc.table_schema = 'public'`,
      [t],
    );
    deps[t] = fk.rows.map((r) => r.ref);
  }

  const order = topoOrder(tables, deps);
  console.log('Copy order:', order.join(', '));

  const counts = {};
  for (const t of order) {
    const { rows } = await src.query(`SELECT * FROM "${t}"`);
    counts[t] = rows.length;
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]);
    const colList = cols.map((c) => `"${c}"`).join(', ');
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const insert = `INSERT INTO "${t}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
    for (const row of rows) {
      const vals = cols.map((c) => {
        const v = row[c];
        return v === undefined ? null : v;
      });
      await dst.query(insert, vals);
    }
    console.log(`  ${t}: ${rows.length} rows`);
  }

  for (const t of tables) {
    await dst.query(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'),
        COALESCE((SELECT MAX(id) FROM "${t}"), 1));`,
    );
  }
  console.log('Sequences reset');

  const dstTablesRes = await dst.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
  );
  let ok = true;
  const report = [];
  for (const t of dstTablesRes.rows.map((r) => r.table_name)) {
    if (!counts[t]) continue;
    const c = await dst.query(`SELECT COUNT(*) AS c FROM "${t}"`);
    const equal = Number(c.rows[0].c) === counts[t];
    report.push(`${equal ? 'OK ' : 'MISMATCH '} ${t}: src=${counts[t]} dst=${c.rows[0].c}`);
    if (!equal) ok = false;
  }
  console.log('\nVerification:');
  console.log(report.join('\n'));
  console.log(ok ? '\nALL MATCH' : '\nMISMATCH DETECTED');

  await src.end();
  await dst.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});