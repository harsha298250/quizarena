# QuizArena — System Architecture

## 1. System Overview & Dual-Tier Design

```
┌─────────────────────────────────────────────────────────────┐
│                       Client Browser                        │
│   (React 19, Vite, PlayerShell / HostShell, Tailwind CSS)   │
└──────────────┬──────────────────────────────┬───────────────┘
               │ HTTPS / JSON                 │ Firebase SDK Listeners
               ▼                              ▼
┌──────────────────────────────┐ ┌────────────────────────────┐
│      Express 4 Backend       │ │   Google Cloud Firestore   │
│   (Server-Authoritative SDK) │ │ (Security Rules Guarded)   │
└──────────────┬───────────────┘ └────────────────────────────┘
               │
      ┌────────┴────────┬───────────────────┬─────────────────┐
      ▼                 ▼                   ▼                 ▼
┌───────────┐     ┌───────────┐       ┌───────────┐     ┌───────────┐
│  Firebase │     │  Gemini   │       │   Svix    │     │  Resend   │
│   Auth    │     │  / Grok   │       │ Webhooks  │     │  Outbox   │
└───────────┘     └───────────┘       └───────────┘     └───────────┘
```

## 2. Authentication Flow & Role Boundaries
- **Firebase Auth**: Verifies ID tokens server-side via `adminAuth.verifyIdToken(token, true)` enforcing revocation checks.
- **Role Isolation**:
  - `student` / `player`: Access to `/api/join`, `/api/answer`, `/api/tournaments/register`, `/api/tournaments/cancel-registration`.
  - `host`: Access to `/api/game/create`, `/api/game/advance`, `/api/game/end`, `/api/tournaments/create`, `/api/tournaments/start-round`, `/api/tournaments/finalize-match`.
- **Security Rules**: Enforces client write locks (`allow write: if false;`) on sensitive subcollections (`/secrets`, `/matches`, `/registrations`, `/results`, `/mail`).

## 3. Persistent Tournament Bracket Lifecycle
1. **Creation**: `/api/tournaments/create` seeds root document in `registration_open` status.
2. **Registration**: `/api/tournaments/register` executes inside `adminDb.runTransaction`, checking `maxParticipants` and assigning contiguous `seed: maxActiveSeed + 1`.
3. **Round Start & Bracket**: `/api/tournaments/start-round` validates minimum participants and generates single-elimination bracket with byes, saving match records into `/tournaments/{id}/matches/*`.
4. **Authoritative Finalization**: `/api/tournaments/finalize-match` inspects linked multiplayer game session `/games/{gameId}/players/*` to derive true scores and break ties deterministically.
5. **Completion & Standings**: Tournament advances to `completed`, writes `/tournaments/{id}/results/*` documents, and protects private tournament standings via `isTournamentReadable`.

## 4. Multi-Provider AI Architecture & Fallback Flow
```
Client Request -> Check Rate Limits (IP + UID)
                      │
                      ▼
              Primary: Gemini 2.5 Flash
                      │ (Transient Error, 429 Retry-After, or 5xx)
                      ▼
              Secondary: xAI Grok-2-mini
                      │ (Complete API Outage or Missing Keys)
                      ▼
         Deterministic Pedagogical Heuristic Engine
              (Zero Failure, Option Shuffle & Sync)
```

## 5. Durable Email Outbox Engine
- **Transactional Outbox**: Emails enqueued into Firestore `/emailOutbox` inside atomic transactions with scoped idempotency hashes.
- **Worker Leases & Fencing**: Background workers acquire jobs with transactional `lockedUntil` and `leaseVersion`. Stale workers attempting to complete expired leases are fenced out.
- **Webhook Replay Protection**: Official Svix HMAC-SHA256 signatures verified over raw body bytes; duplicate `svix-id` events ignored.

## 6. Privacy & 9-Stage Account Deletion
1. Deletion job queued with `status: 'deletion_pending'`.
2. Auth profile purged.
3. Firestore personal user documents purged.
4. Storage avatar files purged (`users/{uid}/*`, `avatars/{uid}/*`).
5. Multiplayer player documents anonymized.
6. Email outbox records cancelled and PII scrubbed (`[deleted]`).
7. Tournaments anonymized (host ID replaced with pseudo-identifier; status marked `cancelled` if active).
8. Completed tournament standings records preserved with anonymized labels.
9. Deletion job finalized to `status: 'completed'`.

