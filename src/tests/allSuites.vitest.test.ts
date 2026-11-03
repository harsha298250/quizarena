import { describe, it, expect } from 'vitest';
import { fork } from 'child_process';
import path from 'path';

const suites = [
  'sharedRateLimiter.test.ts',
  'aiModelConfig.test.ts',
  'serverStrikes.test.ts',
  'strictIntegrity.test.ts',
  'analyticsDeterministic.test.ts',
  'certificateSnapshot.test.ts',
  'quizArena.test.ts',
  'resultEmails.test.ts',
  'scoringHardening.test.ts',
  'securityHardeningPhase1.test.ts',
  'multiplayerEnginePhase2.test.ts',
  'scoringHardeningPhase3.test.ts',
  // Note: quizStudioPhase4.vitest.test.ts is run directly by vitest (*.vitest.test.ts pattern)
  // and cannot be forked via tsx because pdfExtractor.ts uses Vite-only ?url imports.
];

describe('QuizArena Comprehensive Test Suites', () => {
  for (const suite of suites) {
    it(`executes ${suite} successfully`, async () => {
      const suitePath = path.resolve(__dirname, suite);
      const exitCode = await new Promise<number>((resolve, reject) => {
        const proc = fork(suitePath, [], {
          execArgv: ['--import', 'tsx'],
          stdio: 'inherit',
        });
        proc.on('close', code => resolve(code ?? 0));
        proc.on('error', err => reject(err));
      });
      expect(exitCode).toBe(0);
    }, 60000);
  }
});

