# QuizArena — Rate Limiting & AI Correctness Architecture (Phase 6)

## 1. Rate-Limiting Policies & Limitations

All API rate limiting is consolidated on `SharedRateLimiter` (`src/server/sharedRateLimiter.ts`), which enforces bounded memory (`maxEntries = 10000`, pruning expired windows and evicting the oldest key at capacity) and returns standardized HTTP `429` responses with `Retry-After` headers via `sendRateLimitResponse`.

### Endpoint Limits
- **`GET /api/ai-warmup`**: `10` requests / `60s` per client IP (`extractClientIp(req)` using Express `req.ip`, respecting `trust proxy` and never reading raw `X-Forwarded-For` directly).
- **`POST /api/generate-quiz` (Authenticated)**: `10` requests / `60s` per UID.
- **`POST /api/generate-quiz` (Anonymous)**: `5` requests / `10m` per anonymous UID **and** `15` requests / `10m` per IP (`checkAnonymousGenerateQuizIpRateLimit`) to prevent UID rotation abuse without unfairly blocking shared campus/NAT IPs.
- **`POST /api/validate-question`**: `30` requests / `60s` per UID.
- **`POST /api/batch-validate-questions`**: `10` requests / `60s` per UID (max `50` questions per batch).
- **`POST /api/answer`**: `10` answers / `10s` per player ID.
- **`POST /api/integrity-event`**: `2` events / `1s` per player ID (`lastEventMap` bounded to `5000` entries).
- **`POST /api/send-results`**: `5` requests / `60s` per host UID.
- **`POST /api/send-test-email`**: `3` requests / `1h` per host UID.
- **`POST /api/outbox/enqueue`**: `10` requests / `60s` per UID (isolated bucket `outbox_enq_<uid>`).
- **`POST /api/account/delete` & `/retry`**: `5` requests / `10m` per UID / `uidHash`.
- **Game session create / join / recovery**: `20` requests / `60s` per UID.
- **Tournament mutations / standings**: `20` mutations / `60s` per UID; `60` standings reads / `60s` per IP.
- **Certificate issue / revoke / public verify**: `20` issue/revoke / `60s` per UID; `60` public verify lookups / `60s` per IP.

> **Important Limitation — Process-Local Rate Limiter:**
> `SharedRateLimiter` stores window counters in Node.js process memory. It is **process-local and is NOT distributed across multiple server instances or containers**. In a horizontally scaled multi-instance deployment behind a load balancer, each instance enforces these limits independently unless backed by a shared external store (e.g., Redis).

---

## 2. AI Provider Fallback Sequence & Model Configuration

- **Single Source of Truth**: `DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'` (`src/server/aiProviderAdapter.ts`), with `GEMINI_MODEL` env override and candidate fallback list `['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro']`. Legacy defaults in `apiHandler.ts`, `envValidator.ts`, and `aiService.ts` are aligned to `'gemini-2.5-flash'`.
- **Quiz Generation (`/api/generate-quiz`)**:
  1. **Primary** (`AI_PRIMARY_PROVIDER`, default `gemini`): Tries configured Gemini candidate models (stepping to the next model on `404` / timeout).
  2. **Secondary Fallback** (`AI_FALLBACK_ENABLED !== 'false'`): Falls back to xAI Grok (`XAI_MODEL || 'grok-2-latest'`) if `XAI_API_KEY` is configured.
  3. **Heuristic Fallback** (`generateHeuristicQuestions`): Generates structurally valid draft questions from source lines with Fisher-Yates shuffled options and synchronized `correctAnswerIndex`. Explicitly sets `aiVerified: false`.
- **Question Validation (`/api/validate-question`, `/api/batch-validate-questions`)**:
  1. **Gemini Primary** -> **Grok Fallback** -> **Structural-Only Fallback** (`providerUsed: 'structural'`, `validationScope: 'structural_only'`).
  2. User-supplied question text, options, and quotes are delimited as untrusted data (`--- BEGIN UNTRUSTED QUESTION DATA ---`) with explicit anti-injection system instructions.

---

## 3. Retry, Timeout & JSON Parsing Behavior

- **Transient Retries (`withTransientRetry`)**: Retries HTTP `429`, `502`, `503`, `504`, `RESOURCE_EXHAUSTED`, and network timeouts up to `maxRetries = 2` (3 total attempts) using exponential backoff (`baseDelayMs = 400ms`) with jitter, respecting `Retry-After` headers (capped at `15000ms`) and an overall `45000ms` deadline.
- **Non-Retryable Errors**: Permanent `4xx` errors (`400`, `401`, `403`, `404`) and malformed/empty JSON parse errors are never retried.
- **Frontend Client (`src/services/aiService.ts`)**: `fetchBatchWithRetry` does not retry `400`, `401`, `403`, `422`, or `429` responses, surfacing `Retry-After` wait durations directly.
- **JSON Parsing (`parseAIJsonResponse`)**: Safely strips Markdown code fences (` ```json ... ``` `) and rejects empty strings, empty fences, malformed JSON, and non-object/non-array primitives.

---

## 4. Structural Validation vs. AI-Assisted Review vs. Factual Verification

1. **Structural Validation (`validateAndFilterGeneratedQuestions`, `validateQuestionStructure`)**:
   - Deterministic checks: non-empty prompt (`<= 600` chars), `2..8` non-empty options with no normalized duplicates, explicit integer `correctAnswerIndex` in `[0, options.length - 1]` (never coerced to `0`).
   - `/api/generate-quiz` excludes invalid or duplicate items and returns **HTTP `422`** if zero valid unique questions remain (never returning malformed questions with HTTP `200`).
2. **AI-Assisted Review (`validationScope: 'ai_assisted_review'`)**:
   - Evaluates pedagogical clarity, distractor plausibility, and source-quote alignment when Gemini or Grok is available.
   - Missing or failed validation results default to `'needs_review'` (never `'good'`).
3. **Factual Verification (`factuallyVerified: false`)**:
   - **QuizArena does NOT perform automated external factual truth verification.** Both structural validation and AI-assisted review return `factuallyVerified: false`; instructors must review draft questions before publishing.

---

## 5. Duplicate Detection & Input Limits

- **Normalization (`normalizeQuestionText`)**: NFKC Unicode normalization, lowercasing, contraction expansion, punctuation stripping, and whitespace collapsing while preserving numbers, dates, names, and question-intent words.
- **Fingerprinting & False-Positive Guards (`buildQuestionFingerprint`, `compareQuestionFingerprints`)**:
  - Filters filler stopwords and applies light plural stemming (`-ies`, `-es`, `-s`).
  - Similarity threshold: **`0.65`** (`DEFAULT_DUPLICATE_SIMILARITY_THRESHOLD`).
  - Rejects duplicate matches (`0` similarity) when explicit question intent differs (`who/person` vs `when/time` vs `where/place` vs `why/reason` vs `how/manner`), negation polarity differs (`not`/`never`/`except`), or explicit numeric/year/code tokens differ (`429` vs `404`, `2020` vs `2024`).
- **Existing-Question-Bank Bounds**: Optional `existingQuestionTexts` is sanitized as untrusted input and capped at **`200` items** and **`600` characters** per item (`sanitizeExistingQuestionTexts`). Uses inverted token indexes to avoid quadratic scans.

---

## 6. Known Limitations & Unverified Integrations

- **In-memory rate limiting** is single-process only (not shared across multiple server replicas).
- **Live external AI providers (Gemini, xAI Grok)** and **live Firebase Auth / Firestore** calls were not executed in the offline test sandbox; adapter retry, fallback, parsing, and rate-limit behaviors were verified via deterministic unit and mocked integration tests.
- **Database-backed duplicate detection** across persisted Firestore quizzes is not performed automatically on the server; callers supply bounded `existingQuestionTexts`.

