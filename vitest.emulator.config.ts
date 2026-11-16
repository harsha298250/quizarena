// Ensure localhost emulator traffic never routes through external/sandbox proxies
process.env.NO_PROXY = 'localhost,127.0.0.1,::1';
process.env.no_proxy = 'localhost,127.0.0.1,::1';
delete process.env.HTTP_PROXY;
delete process.env.http_proxy;
delete process.env.HTTPS_PROXY;
delete process.env.https_proxy;
delete process.env.GRPC_PROXY;
delete process.env.grpc_proxy;

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/tests/**/*.emulator.test.ts'],
    fileParallelism: false,
    testTimeout: 45000,
    hookTimeout: 45000,
  },
});

