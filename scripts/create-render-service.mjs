/**
 * Create EcoHub web service on Render (Docker from GitHub repo).
 * Usage: node scripts/create-render-service.mjs <github-repo-url>
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });

const repoUrl = process.argv[2];
if (!repoUrl) {
  console.error('Usage: node scripts/create-render-service.mjs https://github.com/USER/eco-grodno');
  process.exit(1);
}

const cliYaml = path.join(process.env.USERPROFILE || '', '.render', 'cli.yaml');
const key = fs.readFileSync(cliYaml, 'utf8').match(/key:\s*(\S+)/)?.[1];
const ownerId = fs.readFileSync(cliYaml, 'utf8').match(/workspace:\s*(\S+)/)?.[1];
if (!key || !ownerId) throw new Error('render login required');

const botToken = process.env.BOT_TOKEN;
if (!botToken) throw new Error('BOT_TOKEN missing in .env');

const body = {
  type: 'web_service',
  name: 'ecohub',
  ownerId,
  repo: repoUrl,
  autoDeploy: 'yes',
  branch: 'main',
  serviceDetails: {
    runtime: 'docker',
    plan: 'free',
    region: 'frankfurt',
    healthCheckPath: '/health',
    dockerContext: '.',
    dockerfilePath: './Dockerfile',
    envVars: [
      { key: 'NODE_ENV', value: 'production' },
      { key: 'BOT_TOKEN', value: botToken },
      { key: 'JWT_SECRET', value: process.env.JWT_SECRET || 'ecohub-change-me-' + Date.now() },
      {
        key: 'DATABASE_URL',
        fromDatabase: { name: 'ecohub-db', property: 'connectionString' },
      },
    ],
  },
};

const res = await fetch('https://api.render.com/v1/services', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  body: JSON.stringify(body),
});

const text = await res.text();
console.log(res.status, text.slice(0, 2000));
if (!res.ok) process.exit(1);

const data = JSON.parse(text);
const svc = data.service || data;
const id = svc.id || data.id;
console.log('Service ID:', id);
console.log('Dashboard:', svc.serviceDetails?.url || svc.dashboardUrl || 'check Render dashboard');
