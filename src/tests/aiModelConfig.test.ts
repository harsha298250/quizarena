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

// 3. Fallback mechanism: When primary model fails with 404, automatically try available fallback
import { generateContentWithFallback, FALLBACK_GEMINI_MODELS } from '../server/apiHandler.ts';

async function testFallback() {
  const attemptedModels: string[] = [];
  const mockAi: any = {
    models: {
      generateContent: async ({ model }: { model: string }) => {
        attemptedModels.push(model);
        if (model === 'gemini-3.8-flash') {
          const err: any = new Error('models/gemini-3.8-flash is not found for API version v1beta');
          err.status = 404;
          throw err;
        }
        return { text: JSON.stringify([{ question: 'Test question?' }]) };
      },
    },
  };

  const res = await generateContentWithFallback(mockAi, 'gemini-3.8-flash', { contents: 'test' });
  assert.ok(res.text.includes('Test question?'), 'Must return valid response from fallback model');
  assert.strictEqual(attemptedModels[0], 'gemini-3.8-flash', 'Must attempt primary model first');
  assert.strictEqual(attemptedModels[1], FALLBACK_GEMINI_MODELS[0], 'Must fall back to gemini-2.5-flash on 404');
}

await testFallback();

console.log('✅ AI Model Configuration, 404 Normalization & Automatic Fallback tests passed successfully!');

