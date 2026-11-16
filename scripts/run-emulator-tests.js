/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Runs Firebase emulator test suites with sanitized proxy environment variables
 * so cross-service emulator communication (Storage -> Firestore) and gRPC do not route through localhost proxies.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

// Ensure configstore writes to a writable temporary directory in sandbox/Windows environments
const tempConfigDir = path.join(os.tmpdir(), 'quizarena-firebase-config');
try {
  fs.mkdirSync(tempConfigDir, { recursive: true });
} catch {}
process.env.XDG_CONFIG_HOME = tempConfigDir;

// Ensure localhost emulator traffic never routes through external/sandbox proxies
process.env.NO_PROXY = 'localhost,127.0.0.1,::1';
process.env.no_proxy = 'localhost,127.0.0.1,::1';
delete process.env.HTTP_PROXY;
delete process.env.http_proxy;
delete process.env.HTTPS_PROXY;
delete process.env.https_proxy;
delete process.env.GRPC_PROXY;
delete process.env.grpc_proxy;
process.env.NO_UPDATE_NOTIFIER = '1';

const firebaseCmd = path.join(process.env.APPDATA || '', 'npm', 'firebase.cmd');
const testArgs = process.argv.slice(2).join(' ');
const innerCmd = testArgs ? `node node_modules/vitest/vitest.mjs run ${testArgs} --config vitest.emulator.config.ts` : 'node node_modules/vitest/vitest.mjs run --config vitest.emulator.config.ts';

const args = [
  'emulators:exec',
  '--project', 'demo-quizarena-test',
  '--only', 'auth,firestore,storage',
  `"${innerCmd}"`,
];

const proc = spawn(firebaseCmd, args, {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

proc.on('close', (code) => {
  process.exit(code ?? 0);
});

