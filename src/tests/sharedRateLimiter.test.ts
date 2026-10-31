import assert from 'node:assert';
import {
  sharedRateLimiter,
  checkWarmupRateLimit,
  checkGenerateQuizRateLimit,
  checkValidateRateLimit,
  checkBatchValidateRateLimit,
  checkAnswerRateLimit,
  checkIntegrityRateLimit,
  checkHostEmailRateLimit,
} from '../server/sharedRateLimiter.ts';

console.log('🧪 Running Shared Rate Limiter Tests...');

// 1. Warmup Rate Limiting: 10 per minute per client
sharedRateLimiter.reset();
const ip = '127.0.0.1';
for (let i = 0; i < 10; i++) {
  const res = checkWarmupRateLimit(ip);
  assert.strictEqual(res.allowed, true, `Warmup request ${i + 1} should be allowed`);
}
const warmupBlocked = checkWarmupRateLimit(ip);
assert.strictEqual(warmupBlocked.allowed, false, '11th warmup request within 1 min must be blocked');
assert.ok((warmupBlocked.retryAfterSec ?? 0) > 0, 'Retry-After must be positive');

// 2. Generate Quiz Rate Limiting: 10 per minute per user
sharedRateLimiter.reset();
const teacherUid = 'teacher_abc_123';
for (let i = 0; i < 10; i++) {
  const res = checkGenerateQuizRateLimit(teacherUid);
  assert.strictEqual(res.allowed, true, `Quiz generation request ${i + 1} should be allowed`);
}
const genBlocked = checkGenerateQuizRateLimit(teacherUid);
assert.strictEqual(genBlocked.allowed, false, '11th quiz generation request within 1 min must be blocked');

// 3. Batch Validate Rate Limiting: 10 per minute per teacher
sharedRateLimiter.reset();
for (let i = 0; i < 10; i++) {
  const res = checkBatchValidateRateLimit(teacherUid);
  assert.strictEqual(res.allowed, true, `Batch validate ${i + 1} should be allowed`);
}
const batchBlocked = checkBatchValidateRateLimit(teacherUid);
assert.strictEqual(batchBlocked.allowed, false, '11th batch validate request within 1 min must be blocked');

// 4. Answer Rate Limiting: 10 per 10s window per player
sharedRateLimiter.reset();
const playerId = 'player_xyz_456';
for (let i = 0; i < 10; i++) {
  const res = checkAnswerRateLimit(playerId);
  assert.strictEqual(res.allowed, true, `Answer submission ${i + 1} should be allowed`);
}
const ansBlocked = checkAnswerRateLimit(playerId);
assert.strictEqual(ansBlocked.allowed, false, '11th answer within 10s must be rate limited');

// 5. Integrity Rate Limiting: 2 per second per player
sharedRateLimiter.reset();
const t0 = 1000000;
assert.strictEqual(checkIntegrityRateLimit(playerId, t0).allowed, true);
assert.strictEqual(checkIntegrityRateLimit(playerId, t0 + 100).allowed, true);
assert.strictEqual(checkIntegrityRateLimit(playerId, t0 + 200).allowed, false, '3rd integrity event within 1s must be rate-limited');
assert.strictEqual(checkIntegrityRateLimit(playerId, t0 + 1100).allowed, true, 'Integrity event after 1s window resets');

console.log('✅ All Shared Rate Limiter tests passed successfully!');
