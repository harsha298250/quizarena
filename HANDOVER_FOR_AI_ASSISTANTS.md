# QuizArena — Engineering Handover for AI Coding Assistants

> **CONFIDENTIAL & AUTHORITATIVE HANDOVER DOCUMENT**  
> **Target Audience:** Incoming AI Coding Assistants, Software Architects, and Security Auditors.  
> **Source Repository:** `https://github.com/harsha298250/quizarena` (Branch: `main`)  
> **Source Git Commit:** `df06f4962f039bfc09c28febc55a48f0b383b973`  
> **Handover Date:** November 12, 2026  
> **Live Production URL:** `https://quizarena-c88m.onrender.com/`

---

## 1. Project Overview & Architecture

### 1.1 Purpose
**QuizArena** is an enterprise-grade, real-time multiplayer competition, live classroom engagement, and AI-powered quiz assessment platform. It enables educators, hosts, and tournament organizers to author quizzes, generate questions using large language models or PDF extraction, run synchronized multiplayer live matches, conduct multi-stage bracketed tournaments, issue cryptographic verifiable certificates, and maintain persistent analytics.

### 1.2 Technology Stack
- **Frontend Core:** React 19 (`19.0.0`), TypeScript (`~5.7.2`), Vite (`^6.2.0`), Tailwind CSS (`^3.4.17`), Lucide Icons, Canvas Confetti.
- **Backend Core:** Node.js (v20+ recommended), Express 4 (`^4.21.2`), TypeScript via `tsx` (`^4.19.3`).
- **Identity & Security:** Firebase Authentication (Email/Password, Google OAuth), Firebase Admin SDK (`^13.1.0`), strict Firestore Security Rules.
- **Database & Real-Time Sync:** Cloud Firestore (Real-time document listeners via onSnapshot, batch operations, distributed transactions).
- **Storage:** Cloud Storage for Firebase (`storage.rules`).
- **AI Assessment Engine:** Google Gemini (`gemini-3.8-flash` primary via `@google/genai`), xAI Grok fallback, resilient heuristic procedural fallback.
- **Notification & Email Outbox:** Durable Firestore outbox (`email_outbox` collection) with leased background workers, idempotent retry with exponential backoff, supporting Resend API (`resend`), Brevo API (`@getbrevo/brevo`), and standard SMTP (`nodemailer`).
- **Testing & Verification:** Vitest (`^3.0.7`), Playwright (`^1.50.1`), Firebase Emulator Suite (`firebase-tools ^13.31.1`).
- **Production Host:** Render (Web Service running Node.js + Express serving built SPA with API reverse proxy), Vercel configuration (`vercel.json`), GitHub Actions CI (`.github/workflows/ci.yml`).

### 1.3 Architectural Division of Responsibilities
```
┌────────────────────────────────────────────────────────────────────────┐
│                        QuizArena Client (SPA)                          │
│  React 19 + TypeScript + Vite + Tailwind CSS + Firestore onSnapshot   │
│  - PlayerShell: Student Dashboard, Solo Practice, Live Arena, Trophy   │
│  - HostShell: Host Dashboard, Quiz Studio, Live Host Arena, Tournaments│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS / REST & SSE / onSnapshot
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      Express Backend (Node.js)                         │
│  - Authoritative Game Control & Score Compute: src/server/             │
│  - AI Provider Adapter (Gemini -> Grok -> Heuristic)                   │
│  - Durable Outbox Lease Engine & Background Worker (Cron / Poller)     │
│  - Account Deletion & Storage Purge Engine (9-Stage Transactional)     │
│  - Cryptographic Certificate Engine & Snapshot Verifier                │
│  - Tournament Elimination & Round Robin Engine                         │
│  - Strict IP & Route Rate Limiter (sharedRateLimiter.ts)               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Firebase Admin SDK
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               Cloud Firestore & Firebase Auth Infrastructure           │
│  - Strict Security Rules (firestore.rules & storage.rules)             │
│  - Collections: users, quizzes, game_sessions, game_answers,           │
│    tournaments, certificates, email_outbox, strikes, rate_limits       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Current Implementation Status

### 2.1 Authentication & User Roles
- **Dual Shell Architecture:** Dedicated role-based UI separation:
  - `PlayerShell.tsx`: Tailored for learners, displaying quick join PIN modal, personal achievements, study history, certificate gallery, and solo practice.
  - `HostShell.tsx`: Dedicated workspace for quiz authors and administrators with live game session controls, tournament orchestrator, email outbox monitor, and analytics dashboard.
- **Role Enforcement:** Client shell routing synchronizes with Firestore user profile role (`host`, `player`, `admin`). Sensitive backend endpoints (`/api/admin/*`, `/api/outbox/*`) enforce token authorization checks and worker secret validation.

### 2.2 Quiz Authoring & AI Generation
- **QuizBuilder:** Manual question authoring with Markdown support, multiple choice, true/false, open-ended, time limits, point weights, and penalty scoring.
- **AI Quiz Studio:** Integrates `src/server/aiProviderAdapter.ts` with multi-tier fallback:
  1. Primary: Google Gemini (`gemini-3.8-flash`) via structured JSON schema parsing.
  2. Fallback: xAI Grok provider upon Gemini rate-limit (HTTP 429) or transient outage (502/503/504).
  3. Fail-Safe: Procedural heuristic quiz generator preventing player disruption during network partition.
- **PDF Extraction:** `src/services/pdfExtractor.ts` extracts raw text from user-uploaded PDFs to dynamically seed AI quiz generation prompts.

### 2.3 Live Multiplayer Arena
- **Real-Time Synchronization:** `src/services/networkSync.ts` and `src/components/arena/HostArena.tsx` / `PlayerArena.tsx` communicate using Firestore real-time snapshots.
- **Watermarked Anti-Cheat Canvas:** `WatermarkedQuestionCanvas.tsx` renders randomized dynamic question canvases watermarked with the player's UID and timestamp to discourage unauthorized screen capture.
- **Authoritative Server Scoring:** `src/server/scoringHardening.ts` and `answerSubmissionHandler.ts` calculate points based on server response latency, base score, difficulty multiplier, streak bonuses, and wrong-answer penalties. Submissions after question expiration are rejected.
- **Integrity Monitor:** `src/hooks/useIntegrityGuard.ts` detects tab-switching, devtools inspection, focus loss, and suspicious extensions, logging infractions to `strikes` collection.

### 2.4 Tournaments & Brackets
- **Engine:** `src/server/tournamentEngine.ts` supports Single Elimination, Double Elimination, and Round Robin formats with automatic bye handling, match generation, stage advancement, and seed tracking.
- **Concurrency Protections:** Firestore atomic transactions prevent double-registration, concurrent match claiming, or illegal match result tampering.

### 2.5 Verifiable Certificates
- **Issuance:** `src/server/certificateEngine.ts` generates deterministic certificate snapshots containing student identity, quiz/tournament metadata, final score, percentile, and SHA-256 verification hash.
- **Gallery & Verification:** `CertificateGallery.tsx` and public verification endpoints allow third-party validation of student credentials.

### 2.6 Durable Email Outbox
- **Queueing Engine:** `src/server/emailOutboxEngine.ts` persists outbound emails to the `email_outbox` Firestore collection within application transactions.
- **Lease Fencing & Worker:** `src/server/emailOutboxWorker.ts` utilizes atomic leases (`lockedUntil`, `nextRetryAt` with strongly typed null-clearing) to prevent split-brain delivery across horizontal instances.
- **Provider Multi-Tenancy:** Pluggable dispatch via Resend API, Brevo API/SMTP, or standard SMTP, with automated fallback and webhook receipt confirmation.

### 2.7 Account Deletion & Data Purge
- **9-Stage Cascade Purge:** `src/server/accountDeletionEngine.ts` executes an orderly purge:
  1. Verification of identity and host ownership check.
  2. Anonymization or deletion of hosted quizzes.
  3. Pruning of active game sessions.
  4. Deletion of player game answers.
  5. Removal of tournament registrations and brackets.
  6. Revocation of user certificates and verification records.
  7. Purge of Cloud Storage profile and uploaded media.
  8. Deletion of Firestore `users/{uid}` profile document.
  9. Revocation of Firebase Authentication record via Admin SDK.

---

## 3. Local Setup & Execution Guide

### 3.1 Prerequisites
- **Node.js:** v20.x or v22.x LTS (tested on v20.19.0).
- **Package Manager:** `npm` (v10+) or `bun`.
- **Java Runtime Environment (JRE):** Java 17+ (required for Firebase Local Emulator Suite).

### 3.2 Installation Commands
```bash
# Clone the repository
git clone https://github.com/harsha298250/quizarena.git
cd quizarena

# Install dependencies
npm install
```

### 3.3 Environment Setup
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Populate `.env` with non-production test placeholders or your local Firebase emulator project credentials. **NEVER enter real production API keys or SMTP secrets into version control.**

### 3.4 Running the Application
```bash
# Development mode (concurrently starts Express backend on :3001 and Vite frontend on :5173)
npm run dev

# Full production build (compiles Vite SPA and validates TypeScript)
npm run build

# Start production server locally (serves dist/ on PORT or 3001)
npm start
```

### 3.5 Verification & Test Suites
```bash
# 1. Run all 404 standard unit and integration tests (Vitest)
npm test

# 2. Run TypeScript compiler diagnostics
npm run typecheck   # or: npx tsc --noEmit

# 3. Run Firebase Local Emulator Suite tests (19 integration tests)
# Requires Java installed and internet access for initial emulator binary download
npm run test:emulator

# 4. Run Playwright End-to-End E2E Suite (12 browser tests)
npx playwright test --project=chrome
```

---

## 4. Test Evidence & Reliability Baseline

Every automated test has been verified against the codebase:

| Test Harness | Total Tests | Status | Scope Covered |
|---|---|---|---|
| **Vitest Unit/Integration** | **404 / 404** | **100% Passed** | Scoring rules, AI adapters, rate limits, outbox state machine, integrity guard, certificates, analytics, game engine, UI components. |
| **Firebase Emulator Suite** | **19 / 19** | **100% Passed** | Real Firestore emulator rules (`firestore.rules`), tournament concurrency, 9-stage account deletion, outbox lease locking. |
| **Playwright E2E** | **12 / 12** | **100% Passed** | Headless Chrome end-to-end browser workflows: player join, solo practice, quiz creation, live arena, settings, account deletion UI. |
| **TypeScript (tsc)** | **0 Errors** | **100% Passed** | Strict compiler verification across all frontend and backend modules. |
| **Production SPA Build** | **Success** | **100% Passed** | 886 modules transformed, PWA service worker precaching 84 assets cleanly. |

> **IMPORTANT TESTING NOTE FOR AI CODING ASSISTANTS:**  
> The 19 emulator tests and mocked outbox tests verify architectural durability, database rules, and concurrent state machine safety. They do **not** prove that unconfigured third-party production credentials (such as live Brevo or Resend accounts) are active or that external mail delivery will succeed without valid credentials in production secrets.

---

## 5. Deployment Architecture & Operations

### 5.1 Render Web Service Architecture
- **Service Name:** `quizarena` (Render ID: `srv-cuvd5453e10c739uh8ag`)
- **Hosting Tier:** Render Web Service (Node.js runtime).
- **Public URL:** `https://quizarena-c88m.onrender.com/`
- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm start`
- **Health Probes:**
  - `GET /` — Returns 200 OK with cached SPA HTML shell.
  - `GET /health` — Returns JSON `{ status: "ok", timestamp: "..." }`.
  - `GET /api/health` — Authoritative backend probe validating Firebase Admin connectivity.

> **CRITICAL DIRECTIVE FOR RECEIVING AI ASSISTANT:**  
> **DO NOT** trigger a deployment, modify Render dashboard settings, restart live services, or alter production environment secrets without explicit instruction from the project owner.

---

## 6. Known Limitations & Recommendations

1. **Email SMTP on Render Free Tier:** Render blocks outbound SMTP connections on ports 25, 465, and 587 on their Free plan. For production cloud deployments without a paid outbound network tier, use the Resend HTTPS API (`EMAIL_PROVIDER="resend"`) or Brevo HTTPS API.
2. **AI Provider Quota:** Free-tier Gemini keys have strict rate limits (RPM/RPD). The architecture includes Grok fallback and procedural heuristic fallback, but production deployments require monitored API quotas.
3. **PWA Offline Mode:** The client caches core application assets and solo practice quizzes offline. However, live multiplayer arena and real-time tournament matches strictly require an active internet connection to synchronize with Firestore.
4. **Firebase Admin SDK in Production:** Requires either `FIREBASE_SERVICE_ACCOUNT_KEY` environment variable (inline JSON string) or a securely hosted credential file. In local emulator mode, `FIRESTORE_EMULATOR_HOST` bypasses credential checks.

---

## 7. Handover Checklist & Git Lineage

- **Git Remote:** `https://github.com/harsha298250/quizarena.git`
- **Tracked Branch:** `main`
- **Baseline Git Commit:** `df06f4962f039bfc09c28febc55a48f0b383b973`
- **Commit History Ahead of Initial State:**
  - `ad3d875` — checkpoint: phase 1 security hardening
  - `d30cf70` — feat: implement persistent certificate management
  - `a66fef4` — feat: implement persistent tournament management
  - `031a2ed` — feat: implement secure account deletion and data purge
  - `fc2282c` — feat: implement durable email outbox
  - `19f65db` — feat: complete AI reliability and security hardening
  - `0c3b368` — test(phase8): add Playwright E2E suite, Firebase emulator integration tests, and outbox type hardening
  - `df06f49` — docs(capstone): add architectural specifications, API docs, viva guide, and Phase 8 audit report
- **Included Documentation:** Check `docs/` directory for full architectural specs, API references, testing guides, and viva prep guides.

