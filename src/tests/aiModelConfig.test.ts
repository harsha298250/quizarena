import assert from 'node:assert';
import { DEFAULT_GEMINI_MODEL, GEMINI_MODEL, isGeminiModelNotFoundError } from '../server/apiHandler.ts';

console.log('🧪 Running AI Model Configuration & 404 Normalization Tests...');

// 1. Model defaults to gemini-3.8-flash
assert.strictEqual(DEFAULT_GEMINI_MODEL, 'gemini-3.8-flash', 'Default Gemini model must be gemini-3.8-flash');
assert.ok(typeof GEMINI_MODEL === 'string' && GEMINI_MODEL.length > 0, 'GEMINI_MODEL must resolve to a non-empty string');

// 2. 404 / NOT_FOUND detection
assert.strictEqual(isGeminiModelNotFoundError({ status: 404, message: 'Resource not found' }), true);
assert.strictEqual(isGeminiModelNotFoundError(new Error('models/gemini-custom is NOT_FOUND')), true);
assert.strictEqual(isGeminiModelNotFoundError(new Error('404 Not Found: model does not exist')), true);
assert.strictEqual(isGeminiModelNotFoundError({ code: 'NOT_FOUND', message: 'Requested entity was not found.' }), true);
assert.strictEqual(isGeminiModelNotFoundError(new Error('Rate limit exceeded: 429')), false);
assert.strictEqual(isGeminiModelNotFoundError(new Error('Network timeout')), false);
assert.strictEqual(isGeminiModelNotFoundError(null), false);

console.log('✅ AI Model Configuration & 404 Normalization tests passed successfully!');
