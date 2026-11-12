# QuizArena — Setup and Installation Guide

## 1. Prerequisites
- **Node.js**: v18.0.0 or higher (v20+ recommended).
- **npm**: v9.0.0 or higher.
- **Java Runtime Environment (JRE)**: Version 11 or higher (required for Firebase Local Emulator Suite).
- **Google Chrome / Chromium**: Installed for Playwright E2E browser verification.

## 2. Installation
Clone the repository and install dependencies:
```bash
npm install
```

## 3. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Key environment variables:
- `PORT`: Server port (default: `3000` in production, `3001` in dev).
- `NODE_ENV`: `development` | `production`.
- `FIREBASE_PROJECT_ID`: Target Firebase project ID.
- `FIREBASE_SERVICE_ACCOUNT_KEY`: Path or inline JSON of Firebase Admin service account key.
- `GEMINI_API_KEY`: API key for Gemini question generation.
- `GROK_API_KEY`: Optional fallback key for xAI Grok.
- `RESEND_API_KEY`: API key for Resend transactional outbox dispatch.
- `WEBHOOK_SECRET`: Svix webhook signature secret (`whsec_...`).

## 4. Local Emulator Development & Testing
To start the backend with the Firebase Emulator Suite:
```bash
# In terminal 1: Start emulators
firebase emulators:start --only auth,firestore,storage --project demo-quizarena-test

# In terminal 2: Start backend server
npm start
```

## 5. Running Test Suites
```bash
# 1. Normal Vitest Unit Suite (404 tests)
npm test

# 2. Firebase Emulator Integration Suite (19 tests)
npm run test:emulator

# 3. Playwright Browser E2E Suite (7 tests)
node node_modules/@playwright/test/cli.js test --project=chrome

# 4. TypeScript Typecheck
node node_modules/typescript/bin/tsc --noEmit

# 5. Production Vite Build
node node_modules/vite/bin/vite.js build
```

