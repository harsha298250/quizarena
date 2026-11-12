# QuizArena — Project Overview

## 1. Project Purpose
QuizArena is an enterprise-grade real-time multiplayer quiz competition and assessment management platform. It combines live interactive quizzes, single-elimination tournament bracket progression, verifiable digital certificates, multi-provider AI quiz generation with graceful heuristic fallbacks, and a durable transactional email delivery outbox.

## 2. Key Capabilities
- **Multiplayer Live Arena**: Server-authoritative state progression, secret answer-key isolation in Firestore, sub-second latency tracking, and strict anti-cheat scoring.
- **Persistent Tournament Progression**: Single-elimination tournaments with atomic seed allocation, capacity limits, bracket generation with byes, linked-game score derivation, deterministic tie-breaking, and post-tournament standings.
- **Multi-Provider AI Quiz Studio**: Gemini 2.5 Flash as primary generation engine, Grok 2 as secondary fallback, and a deterministic pedagogical heuristic engine ensuring 100% question availability even during complete provider outages.
- **Durable Email Outbox**: Transactional outbox pattern backed by Firestore, worker concurrency with lease renewal, stale-worker fencing, and Svix webhook signature verification for delivery/bounce reporting.
- **Comprehensive Privacy & Account Deletion**: 9-stage transactional deletion engine purging Auth, Firestore user collections, Storage avatars, and scrubbing PII from historical tournament and outbox records.

## 3. Technology Stack
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Lucide icons.
- **Backend**: Node.js, Express 4, TypeScript (`tsx`).
- **Authentication & Database**: Firebase Authentication, Google Cloud Firestore, Firebase Admin SDK.
- **Storage**: Firebase Storage (user profile avatars).
- **AI Engines**: Google Gemini API (`gemini-2.5-flash`), xAI Grok API (`grok-2-mini`), local pedagogical heuristic engine.
- **Email Delivery**: Resend HTTPS API, Brevo API, SMTP transport.
- **Testing & Verification**: Vitest unit suite, Firebase Emulator integration suite (`auth`, `firestore`, `storage`), Playwright browser E2E test suite (`chrome`).

