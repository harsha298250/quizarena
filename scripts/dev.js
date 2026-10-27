/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const apiPort = process.env.API_PORT || '3001';
const clientPort = process.env.PORT || '3000';

console.log('⚡ Starting QuizArena Fullstack Development Environment...');
console.log(`📡 Backend API target: http://localhost:${apiPort}`);
console.log(`🌐 Frontend client:   http://localhost:${clientPort}\n`);

// Locate tsx and vite binaries reliably across platforms
const tsxCli = fs.existsSync(path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs'))
  ? path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  : 'tsx';

const viteCli = fs.existsSync(path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js'))
  ? path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')
  : 'vite';

// 1. Spawn Express Server
const serverEnv = {
  ...process.env,
  PORT: apiPort,
  NODE_ENV: 'development',
};

const serverProcess = spawn(
  process.execPath,
  [tsxCli, 'server.ts'],
  {
    cwd: rootDir,
    env: serverEnv,
    stdio: 'inherit',
  }
);

// 2. Spawn Vite Frontend Dev Server
const viteProcess = spawn(
  process.execPath,
  [viteCli, `--port=${clientPort}`, '--host=0.0.0.0'],
  {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
  }
);

// Handle clean shutdown of both processes
function cleanup() {
  console.log('\n🛑 Shutting down development processes...');
  try {
    serverProcess.kill('SIGTERM');
  } catch {}
  try {
    viteProcess.kill('SIGTERM');
  } catch {}
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

serverProcess.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`⚠️ Express server exited with code ${code}`);
  }
});

viteProcess.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`⚠️ Vite server exited with code ${code}`);
  }
});
