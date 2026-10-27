# QuizArena ⚡
**Real-Time Multiplayer Quiz & Competition Platform**

QuizArena is a real-time multiplayer assessment and competition engine designed with a tactile, anti-AI-slop **"Playful Paper"** design system (#FFF6E5 paper, #16120E ink, #FF5A36 tomato, #FFC83D sunshine, hard offset shadows, and snappy physical button interactions).

It features real-time synchronization via **Firebase Firestore**, an AI Quiz Generator with in-browser **PDF text extraction**, fair latency-compensated scoring, cryptographic **SHA-256 audit logs**, Course Outcome (CO) attainment diagnostics, and is installable as an offline-capable **Progressive Web App (PWA)**.

---

## 🚀 Features

1. **Multiplayer Live Arena**:
   - Real-time 6-digit game PIN join via QR code deep links.
   - Host projector mode with live distribution bars, timer acceleration, and keyboard shortcuts (`Space`=Next, `R`=Reveal, `P`=Pause).
   - Phone-first player experience with chunky shape-coded answer buttons (Triangle, Diamond, Circle, Square).
   - In-game power-ups (50/50, 2x points, time freeze) and personal accessibility accommodations (dyslexia font, TTS read-aloud, fewer options).
   - Developer-grade **Simulate Players** tool (20–100 players) for instant testing.

2. **AI Quiz Generator (Flagship)**:
   - In-browser text extraction from uploaded PDF textbooks and lecture slides using `pdfjs-dist` (no server file upload needed).
   - Powered by `@google/genai` and `gemini-3.8-flash`.
   - Pedagogical mapping to **Bloom's Taxonomy** (Remember, Understand, Apply, Analyze, Evaluate) and Course Outcome (CO) tags.
   - Interactive teacher review card: Accept, Reject, Edit, Convert to Scenario, Make Easier/Harder.

3. **Latency-Fair Scoring & Cryptographic Integrity**:
   - Measures player round-trip latency and clock offsets to prevent network bias.
   - Tamper-evident **SHA-256 hash chaining** across all answer events with an in-app "Verify Integrity" audit tool.

4. **Competition & Tournament Manager**:
   - Multi-round tournament brackets (Qualifiers, Semi-finals, Grand Finale).
   - Jury override panel (void questions, point adjustments).
   - Appeals dispute resolution workflow.
   - Elo rating leaderboard and PDF certificate generation via `jsPDF`.

5. **Analytics & Automatic Email Outbox**:
   - Course Outcome (CO) threshold attainment diagnostics with Recharts.
   - "Reteach Pack" generator from cohort misconceptions.
   - Asynchronous queueing of student report cards to Firestore `/mail` collection (compatible with Firebase Trigger Email extension).

---

## 🛠️ Tech Stack & Architecture

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS v4, Motion, Recharts.
- **PWA**: `vite-plugin-pwa`, Web App Manifest, Service Worker runtime caching for Google Fonts, in-app install prompt.
- **Audio & Haptics**: Native Web Audio API procedural sound synthesizers (zero external audio file dependencies) and `navigator.vibrate`.
- **Backend / AI**: Node.js Express server (`server.ts`) with `@google/genai` SDK using `gemini-3.8-flash` on `/api/generate-quiz`.
- **Database & Realtime**: Firebase Firestore (`onSnapshot` listeners) with fallback BroadcastChannel for local cross-tab demonstration.

---

## 📦 Getting Started

### 1. Installation
```bash
npm install
```
*(Note: `esbuild` was removed from `devDependencies` so `npm install` runs smoothly without version conflicts).*

### 2. Environment Variables
Copy `.env.example` to `.env`:
```bash
# Gemini AI API Key (required for AI Quiz Generator)
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"

# Firebase Client Configuration (points to quizarena-975e4)
VITE_FIREBASE_PROJECT_ID="quizarena-975e4"
VITE_FIREBASE_API_KEY="AIzaSy..."
VITE_FIREBASE_AUTH_DOMAIN="quizarena-975e4.firebaseapp.com"
VITE_FIREBASE_STORAGE_BUCKET="quizarena-975e4.firebasestorage.app"
VITE_FIREBASE_MESSAGING_SENDER_ID="YOUR_SENDER_ID"
VITE_FIREBASE_APP_ID="YOUR_APP_ID"
VITE_FIREBASE_DATABASE_ID="(default)"

# Server Ports
PORT="3000"        # Frontend port in dev / full app port in prod
API_PORT="3001"    # Express backend port during local dev
```

### 3. Run Development Server (Frontend + Express API Together)
```bash
npm run dev
```
- **Express Backend:** Starts on `http://localhost:3001` handling `/api/answer`, `/api/time`, `/api/advance-question`, and `/api/generate-quiz`.
- **Vite Frontend:** Starts on `http://localhost:3000` and automatically proxies all `/api/*` traffic to port 3001.

### 4. Build & Production Start
```bash
npm run build
npm run start
```

---

## 🔐 Firebase Configuration & Deployment (`quizarena-975e4`)

### 1. Pointing to Your Own Firebase Project

To connect QuizArena to your Firebase project `quizarena-975e4`:

#### A. `.firebaserc`
Set `quizarena-975e4` as your default deployment project:
```json
{
  "projects": {
    "default": "quizarena-975e4"
  }
}
```

#### B. `firebase.json`
Ensures single-page app routing on Firebase Hosting and binds the security rules:
```json
{
  "hosting": {
    "public": "dist",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  },
  "firestore": {
    "rules": "firestore.rules"
  }
}
```

### 3. Deploying Firestore Security Rules to `quizarena-975e4`

You can deploy the hardened `firestore.rules` file to your Firebase project `quizarena-975e4` using either the **Firebase CLI** or the **Firebase Console**:

#### Option 1: Via Firebase CLI (Recommended)
1. Install the Firebase CLI if you haven't already:
   ```bash
   npm install -g firebase-tools
   ```
2. Log in with your Google account associated with `quizarena-975e4`:
   ```bash
   firebase login
   ```
3. Verify or switch to `quizarena-975e4`:
   ```bash
   firebase use quizarena-975e4
   ```
4. Deploy **only** the Firestore security rules:
   ```bash
   firebase deploy --only firestore:rules
   ```
   *(Or deploy both rules and hosting together: `firebase deploy --only firestore:rules,hosting`)*

#### Option 2: Via Firebase Console Web UI
1. Open the [Firebase Console](https://console.firebase.google.com/).
2. Select your project **quizarena-975e4**.
3. In the left navigation sidebar, navigate to **Build** ➔ **Firestore Database**.
4. Click on the **Rules** tab at the top.
5. Copy the entire contents of [`firestore.rules`](file:///c:/Users/harsh/Downloads/quizarena---real-time-multiplayer-quiz-&-competition-platform/firestore.rules) in this repository and paste it into the editor.
6. Click **Publish**. The updated rules will take effect within seconds across all clients.

---

#### C. Frontend App Config (`firebase-applet-config.json` or `.env`)
Obtain your Web App configuration from:
> **Firebase Console** ➔ **Project Settings** (`⚙️`) ➔ **General** ➔ **Your apps** ➔ **Web app** (`</>`)

Update `firebase-applet-config.json`:
```json
{
  "projectId": "quizarena-975e4",
  "appId": "YOUR_APP_ID",
  "apiKey": "YOUR_WEB_API_KEY",
  "authDomain": "quizarena-975e4.firebaseapp.com",
  "firestoreDatabaseId": "(default)",
  "storageBucket": "quizarena-975e4.firebasestorage.app",
  "messagingSenderId": "YOUR_MESSAGING_SENDER_ID"
}
```
*(Or specify the identical values via `VITE_FIREBASE_*` environment variables in your `.env` file).*

---

### 2. Firebase Admin SDK Credentials (Server-Side Authentication & Firestore)

The Express backend uses `firebase-admin` to verify Firebase ID tokens on `/api/answer`, execute atomic Firestore transactions, and enforce anti-cheat validation.

#### Local Development Setup
1. Go to the **Firebase Console** ➔ **Project Settings** ➔ **Service accounts**.
2. Click **Generate new private key** and confirm.
3. Save the downloaded JSON file as `serviceAccountKey.json` in the root folder of this repository (it is excluded by `.gitignore`).
4. **Auto-detection:** `server.ts` automatically detects and loads `serviceAccountKey.json` if it exists in the root!
5. *Alternative:* Export the path in your environment:
   ```bash
   # Windows (PowerShell)
   $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\serviceAccountKey.json"

   # macOS / Linux
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"
   ```

#### Deployed Environments Setup

##### Option A: Google Cloud / Cloud Run / App Engine (Recommended)
- **Zero Config (Application Default Credentials):** Cloud Run and GCP services automatically inject Application Default Credentials (ADC).
- Ensure the Cloud Run runtime service account has the **Cloud Datastore User** and **Firebase Authentication Viewer** IAM roles. `server.ts` will authenticate automatically via `initializeApp({ projectId: "quizarena-975e4" })`.

##### Option B: Render / Vercel / Railway / Heroku / Docker
- In your hosting provider's dashboard, add an environment variable named `FIREBASE_SERVICE_ACCOUNT_KEY`.
- Paste the entire contents of your `serviceAccountKey.json` directly as a single-line JSON string:
  ```env
  FIREBASE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"quizarena-975e4","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...","client_email":"firebase-adminsdk-...@quizarena-975e4.iam.gserviceaccount.com"}'
  ```
- `server.ts` automatically checks `process.env.FIREBASE_SERVICE_ACCOUNT_KEY`, parses the JSON, and initializes `cert(...)`.

---

### 3. SMTP Email Configuration (Results Delivery via Nodemailer)

QuizArena delivers beautiful scorecard reports to students and summary reports to teachers after each game session without requiring a paid Firebase Blaze plan or paid extensions. The Express backend sends emails through standard SMTP or Brevo's free tier.

Configure your credentials in `.env`:

#### Option A: Gmail SMTP with App Password (Personal / School Accounts)
1. Go to your **Google Account** ➔ **Security**.
2. Under "How you sign in to Google", ensure **2-Step Verification** is turned ON.
3. Search for **App passwords** (or go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)).
4. Create an App Password with name `QuizArena`. Google will generate a 16-character code (e.g. `abcd efgh ijkl mnop`).
5. Add to `.env`:
   ```env
   SMTP_HOST="smtp.gmail.com"
   SMTP_PORT="587"
   SMTP_USER="your-email@gmail.com"
   SMTP_PASS="abcdefghijklmnop"
   SMTP_FROM="QuizArena <your-email@gmail.com>"
   ```

#### Option B: Brevo (formerly Sendinblue) Free Tier (300 Free Emails / Day)
1. Sign up for a free account at [brevo.com](https://www.brevo.com/).
2. In the top right menu, navigate to **SMTP & API** ➔ **SMTP**.
3. Click **Generate a new SMTP key** and copy the generated key.
4. Add to `.env`:
   ```env
   SMTP_HOST="smtp-relay.brevo.com"
   SMTP_PORT="587"
   SMTP_USER="your-brevo-account-email@example.com"
   SMTP_PASS="your-brevo-smtp-key"
   SMTP_FROM="QuizArena <your-verified-brevo-sender@example.com>"
   ```
*(Note: If no SMTP credentials are provided in dev mode, result dispatch runs in simulation mode, recording entries in the Outbox without failing).*

---

## 📄 PDF Text Extraction (Bundled Locally)
PDF parsing in the AI Quiz Generator uses `pdfjs-dist`. The worker script is bundled locally as an asset in `dist/assets/pdf.worker.min-*.mjs` via Vite's `?url` asset pipeline:
- **No external CDN dependencies** (e.g. cdnjs or unpkg).
- Functions completely offline in PWA standalone mode.

---

## 📱 PWA Installation Instructions

- **Chrome / Android / Desktop**: Click the **"Install App"** button located in the top navigation bar.
- **iOS Safari**: Tap the **Share** button in the Safari toolbar, scroll down, and select **"Add to Home Screen"**.

