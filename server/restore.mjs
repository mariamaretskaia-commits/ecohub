import { readFileSync } from 'fs';
import pg from 'pg';

const url = process.env.PG_URL;
const file = process.argv[2];

if (!url || !file) {
  console.error('Usage: PG_URL=<target connection string> node server/restore.mjs <dump.sql>');
  process.exit(1);
}

const sql = readFileSync(file, 'utf8');
const statements = splitStatements(sql);

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
});
await client.connect();

let ok = 0;
for (const st of statements) {
  try {
    await client.query(st.endsWith(';') ? st : st + ';');
    ok++;
  } catch (e) {
    console.error('FAILED statement: ' + st.slice(0, 160).replace(/\n/g, ' '));
    console.error(e.message);
    await client.end();
    process.exit(1);
  }
}

console.log(`Restored ${ok} statements from ${file}`);
await client.end();

function splitStatements(sql) {
  const stmts = [];
  let cur = '';
  let inStr = false;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      cur += ch;
      if (inStr && sql[i + 1] === "'") {
        cur += "'";
        i += 2;
        continue;
      }
      inStr = !inStr;
      i++;
      continue;
    }
    if (!inStr && ch === '-' && sql[i + 1] === '-') {
      const idx = sql.indexOf('\n', i);
      if (idx === -1) {
        i = sql.length;
      } else {
        i = idx + 1;
      }
      continue;
    }
    if (!inStr && ch === ';') {
      stmts.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur.trim()) stmts.push(cur.trim());
  return stmts.filter((s) => s && !/^--/.test(s) && !/^SET\s/.test(s));
}