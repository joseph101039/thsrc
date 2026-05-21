'use strict';

const { execSync, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');

const COMPOSE_FILE = path.resolve(__dirname, '../../../docker-compose.test.yml');
const PROJECT = 'thsrc-test';
const SERVER_URL = 'http://localhost:8081';
const UI_URL = 'http://localhost:8082';
const MAX_WAIT_MS = 60000;
const POLL_INTERVAL_MS = 2000;

function composeCmd(args) {
  return `docker compose -p ${PROJECT} -f ${COMPOSE_FILE} ${args}`;
}

function httpGet(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on('error', () => resolve(null));
  });
}

async function waitForUrl(url, label) {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    const code = await httpGet(url);
    if (code && code < 500) {
      console.log(`[docker] ${label} ready (${code})`);
      return;
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`[docker] ${label} did not become ready within ${MAX_WAIT_MS}ms`);
}

async function setup() {
  console.log('[docker] Starting test environment...');
  execSync(composeCmd('up -d --build'), { stdio: 'inherit' });
  await waitForUrl(`${SERVER_URL}/healthz`, 'server');
  await waitForUrl(UI_URL, 'ui');
  console.log('[docker] Test environment ready');
}

async function teardown() {
  console.log('[docker] Tearing down test environment...');
  spawnSync('docker', ['compose', '-p', PROJECT, '-f', COMPOSE_FILE, 'down', '-v'], { stdio: 'inherit' });
  console.log('[docker] Done');
}

module.exports = { setup, teardown };
