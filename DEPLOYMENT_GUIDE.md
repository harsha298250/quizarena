# QuizArena — Production Deployment & Operations Guide

This guide describes the end-to-end production deployment, configuration, security hardening, and operational procedures for **QuizArena**.

---

## 1. System Architecture Overview

```
                      +-----------------------------+
                      |       Web Endpoints         |
                      | (Student & Host Browsers)   |
                      +--------------+--------------+
                                     |
               +---------------------+---------------------+
               | HTTPS                                     | HTTPS / WSS
               v                                           v
+-------------------------------+             +-------------------------------+
|       Frontend (SPA)          |             |       Backend API Engine      |
| Host: Vercel                  |             | Host: Render (Node Web Svc)   |
| Engine: Vite / React 19       |             | Engine: Express / Node 22+    |
| Config: vercel.json           |             | Config: render.yaml           |
+---------------+---------------+             +---------------+---------------+
                |                                             |
                |                                             |
                +----------------------+----------------------+
                                       |
                                       v
                     +-----------------------------------+
                     |       Firebase Cloud Suite        |
                     +-----------------------------------+
                     | 1. Firebase Authentication        |
                     | 2. Cloud Firestore (Data & Rules) |
                     | 3. Firebase Storage (Media/PDFs)  |
                     +-----------------------------------+
```

---

## 2. Infrastructure Components

| Layer | Provider | Deployment Tool | Key Configuration |
|---|---|---|---|
| **Frontend SPA** | Vercel | Vercel Git Integration / CLI | `vercel.json` (SPA rewrites, security headers, cache headers) |
| **Backend API** | Render | Render Blueprint (`render.yaml`) | Node 22+, Dynamic `PORT`, keep-alive timeouts, `GET /health` |
| **Database** | Firebase Firestore | Firebase CLI | `firestore.rules`, `firestore.indexes.json` |
| **Media Storage**| Firebase Storage | Firebase CLI | `storage.rules` (10MB limit, mime validation) |
| **AI Quiz Studio**| Google Gemini | Direct SDK integration | `gemini-3.8-flash` primary with automatic fallback |
| **Email Outbox** | Resend / Brevo / SMTP | Protected Express handler | `/api/outbox/process` triggered by periodic scheduler |

---

## 3. Deployment Steps

### Step 3.1: Firebase Infrastructure Configuration

1. Install and authenticate the Firebase CLI:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use <YOUR_FIREBASE_PROJECT_ID>
   ```
2. Deploy Firestore security rules and composite indexes:
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes
   ```
3. Deploy Firebase Storage security rules:
   ```bash
   firebase deploy --only storage:rules
   ```
4. Verify deployment in the Firebase Console under **Firestore Rules** and **Storage Rules**.

### Step 3.2: Backend Deployment on Render

1. Connect the GitHub repository in the **Render Dashboard**.
2. Select **New Web Service** and link the repository, or apply `render.yaml` via Render Blueprint.
3. Configure the build and start commands:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health`
4. Set required Environment Variables in Render:
   - `NODE_ENV`: `production`
   - `PORT`: `10000` (Render default)
   - `FIREBASE_SERVICE_ACCOUNT_KEY`: Paste the full raw JSON content of your downloaded Firebase service account key.
   - `GEMINI_API_KEY`: Your Google Gemini API key.
   - `CORS_ALLOWED_ORIGINS`: Comma-separated list including your Vercel domains (e.g. `https://quizarena.vercel.app,https://*.vercel.app`).
   - `OUTBOX_WORKER_SECRET`: High-entropy random secret (e.g., 32+ bytes hex string) for authenticating outbox processing requests.
   - `RESEND_API_KEY` (or `BREVO_API_KEY` / `SMTP_*`): Mail credentials.

### Step 3.3: Frontend Deployment on Vercel

1. Import the repository into the **Vercel Dashboard**.
2. Select **Vite** framework preset.
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
3. Configure Environment Variables in Vercel:
   - `VITE_API_BASE_URL`: The URL of your deployed Render backend (e.g., `https://quizarena-backend.onrender.com`).
   - `VITE_FIREBASE_API_KEY`: Firebase web API key.
   - `VITE_FIREBASE_AUTH_DOMAIN`: `<project-id>.firebaseapp.com`.
   - `VITE_FIREBASE_PROJECT_ID`: Firebase project ID.
   - `VITE_FIREBASE_STORAGE_BUCKET`: `<project-id>.firebasestorage.app`.
   - `VITE_FIREBASE_APP_ID`: Firebase web app ID.
4. Deploy and verify that client route refreshes (e.g., `/verify`, `/dashboard`) correctly resolve via `vercel.json` rewrites.

---

## 4. Background Email Outbox Scheduler

To process pending assessment reports and certificate emails reliably without keeping state in long-lived memory:

1. Configure an external cron job (Render Cron Job, GitHub Actions Scheduled Workflow, or Vercel Cron):
   - **Frequency**: Every 2 to 5 minutes (`*/5 * * * *`)
   - **HTTP Call**:
     ```bash
     curl -X POST https://your-backend.onrender.com/api/outbox/process \
          -H "Authorization: Bearer YOUR_OUTBOX_WORKER_SECRET" \
          -H "Content-Type: application/json" \
          -d '{"batchSize": 10}'
     ```
2. The endpoint checks exponential backoff, records provider delivery status, and isolates failed messages without blocking subsequent mail jobs.

---

## 5. Rollback & Disaster Recovery Procedures

### 5.1 Frontend Rollback
- In Vercel Dashboard: Navigate to **Deployments** -> select previous stable build -> click **Promote to Production** (takes < 10 seconds).

### 5.2 Backend Rollback
- In Render Dashboard: Navigate to **Deploys** -> select previous stable commit -> click **Rollback to this deploy**.

### 5.3 Database & Rules Rollback
- Firestore rules and indexes can be rolled back to any previous commit:
  ```bash
  git checkout <STABLE_COMMIT_HASH> -- firestore.rules firestore.indexes.json
  firebase deploy --only firestore:rules,firestore:indexes
  ```
- **Automated Nightly Backups**: Enable managed Cloud Firestore daily backups via Google Cloud Console:
  ```bash
  gcloud firestore backups schedules create --database='(default)' --retention=30d --recurrence=daily
  ```

---

## 6. Health & Operational Monitoring

- **Operational Health Endpoint**: `GET /health`
  - Returns HTTP 200 with JSON status:
    ```json
    {
      "status": "healthy",
      "timestamp": "2026-11-03T21:40:00.000Z",
      "uptime": 86400,
      "environment": "production",
      "version": "1.0.0",
      "service": "quizarena-backend",
      "dependencies": {
        "firestore": "ready",
        "auth": "ready",
        "gemini": "configured",
        "email": "configured"
      }
    }
    ```
  - Zero sensitive credentials or tokens are exposed in `/health`.
  - HTTP 503 is returned if vital credentials (e.g. Firebase Admin) are missing in production.

---

## 7. Troubleshooting & Frequently Asked Questions

1. **CORS Error in Browser Console:**
   - Verify `CORS_ALLOWED_ORIGINS` on Render matches the exact origin of the Vercel frontend (including protocol and port if non-standard).
2. **"Firebase Admin Credentials Missing" on Render Boot:**
   - Ensure `FIREBASE_SERVICE_ACCOUNT_KEY` environment variable contains the valid service account JSON string or a path to a mounted secret file.
3. **SPA 404 on Page Refresh on Vercel:**
   - Verify `vercel.json` exists in project root with the rewrite rule routing non-static paths to `/index.html`.
4. **Email Queue Not Draining:**
   - Ensure the outbox cron is actively hitting `POST /api/outbox/process` with the correct `Bearer` secret. Check backend logs for SMTP or Resend/Brevo rejection notices.

