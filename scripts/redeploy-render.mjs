/**
 * Trigger EcoHub redeploy on Render.
 * Requires: render login ( ~/.render/cli.yaml )
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SERVICE_ID = process.env.RENDER_SERVICE_ID || 'srv-da7jceqfngtc73fn39g0';
const cliYaml = path.join(process.env.USERPROFILE || '', '.render', 'cli.yaml');
const key = fs.readFileSync(cliYaml, 'utf8').match(/key:\s*(\S+)/)?.[1];
if (!key) throw new Error('Render CLI not logged in. Run: render login');

const res = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/deploys`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ clearCache: 'do_not_clear' }),
});

const text = await res.text();
if (!res.ok) {
  console.error('Deploy failed:', res.status, text.slice(0, 500));
  process.exit(1);
}

const data = JSON.parse(text);
const deploy = data.deploy || data;
console.log('Deploy started:', deploy.id || deploy.status);
console.log('Dashboard: https://dashboard.render.com/web/' + SERVICE_ID);
