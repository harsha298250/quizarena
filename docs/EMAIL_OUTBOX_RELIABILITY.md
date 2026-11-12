# QuizArena — Durable Email Outbox & Reliable Delivery (Phase 5)

## 1. Architecture

Phase 5 replaces process-local in-memory email queues in production with a Firestore-backed durable outbox engine (`src/server/emailOutboxEngine.ts`) wired into `notificationHandler.ts`, `resultEmailsHandler.ts`, and `server.ts`.

Legacy synchronous exports in `src/server/emailOutboxWorker.ts` are preserved strictly for legacy Phase 7/10 unit tests; in non-test environments (`NODE_ENV !== 'test'`), production handlers fail closed (`503`) if transactional `adminDb` is unavailable.

---

## 2. Firestore Schema (Admin SDK Only)

All Phase 5 collections are locked down in `firestore.rules` with `allow read, write: if false;`:

1. **`emailOutbox/{jobId}`**: Durable `EmailOutboxJob` documents (`id`, `idempotencyKey`, `idempotencyScope`, `ownerId`, `recipientEmail`, `recipientName`, `recipientUid`, `eventType`, `subject`, `htmlContent`, `textContent`, `status`, `attempts`, `maxAttempts`, `nextRetryAt`, `lockedUntil`, `leaseVersion`, `workerId`, `provider`, `providerMessageId`, `errorCategory`, `lastErrorMessage`, `createdAt`, `updatedAt`, `sentAt`, `deliveredAt`, `cancelledAt`).
2. **`emailOutboxIdempotency/{scopedKeyHash}`**: SHA-256 hash of `${scope}::${eventType}::${rawKey}` preventing cross-user/cross-event collisions and avoiding raw key exposure.
3. **`emailWebhookEvents/{eventKey}`**: Deduplicates processed webhook events (`svix-id` or provider event key) inside Firestore transactions.
4. **`emailOutboxMetrics/summary`**: Maintained O(1) counters (`pending`, `processing`, `retrying`, `accepted`, `delivered`, `bounced`, `rejected`, `failed`, `cancelled`, `ambiguous`, `failureCategories`).

---

## 3. Queue Lifecycle, Leases & Fencing

- **States**: `pending` → `processing` → `accepted` → (`delivered` | `bounced` | `rejected`), or `retrying` / `failed` / `cancelled` / `ambiguous`.
- **Worker Lease & Fencing**: Claiming a job inside `runTransaction` increments a monotonic `leaseVersion` fencing token and sets `lockedUntil = now + 120_000ms` and `workerId`. Long-running workers can extend leases via `renewOutboxLeasePersistent`. All completion/retry transitions (`completeClaimedOutboxJobPersistent`) verify `status === 'processing' && workerId === claimedWorkerId && leaseVersion === claimedLeaseVersion`, rejecting stale workers whose lease expired.

---

## 4. Retry Policy, Provider Ambiguity & Idempotency Limitations

- **Backoff & Jitter**: Bounded exponential backoff (`min(300_000ms, 1000ms * 2^(attempts-1)) + randomJitter`), respecting provider `Retry-After` headers on HTTP `429`.
- **Provider Idempotency vs. Delivery Guarantees**:
  - Queue-level idempotency prevents duplicate outbox records and duplicate worker acquisition, **not** universal exactly-once email delivery across all providers.
  - **Resend**: Receives `Idempotency-Key` header on `POST https://api.resend.com/emails`, allowing safe retries on transient `5xx`/timeouts.
  - **Brevo & SMTP**: Lack reliable provider-side idempotency keys; network/socket timeouts (`ETIMEDOUT`, `AbortError`, `ECONNRESET`) transition the job to **`ambiguous`** (`errorCategory: 'ambiguous'`) rather than blindly retrying or falsely marking `accepted`/`failed`.
- **Accepted vs. Delivered**: Provider HTTP `200`/`202` or SMTP `250 OK` marks a job `accepted` only. Only a verified webhook event transitions `accepted` → `delivered`.

---

## 5. Webhook Security & Account Deletion Integration

- `POST /api/outbox/webhook` verifies Resend Svix signatures (`svix-id`, `svix-timestamp` ±5m, `svix-signature`) against raw request bytes (`req.rawBody`), deduplicates via `emailWebhookEvents`, protects terminal states against out-of-order events, and fails closed (`501` for Brevo/SMTP, `503` when `WEBHOOK_SECRET` is unset).
- `enqueueOutboxJobPersistent` and `processOutboxBatchPersistent` enforce Phase 4 `isAccountDeletionPending` and `isEmailBlockedForDeletion` checks before persistence and immediately before dispatch, cancelling blocked jobs and scrubbing PII.

---

## 6. Monitoring, Reconciliation & Environment Variables

- `GET /api/outbox/metrics` (protected by `OUTBOX_WORKER_SECRET` or verified admin token) returns O(1) maintained counters from `emailOutboxMetrics/summary` plus bounded (`limit(50)`) queries for `oldestPendingAgeMs` and `expiredLeases` — avoiding unbounded full-collection scans.
- `reconcileOutboxMetricsPersistent(adminDb)` rebuilds `emailOutboxMetrics/summary` using paginated 400-doc reads (`limit(400)` + `startAfter`) and checks `reconciliationVersion` + `updatedAt` inside the final commit transaction so concurrent counter transitions are never silently overwritten. Reconciled counts are exact as of reconciliation start/completion when no concurrent transitions occur, and eventually consistent under concurrent worker activity.
- **Environment Variables**: `EMAIL_PROVIDER` (`resend` | `brevo` | `smtp` | `none`), `RESEND_API_KEY`, `BREVO_API_KEY`, `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`, `EMAIL_FROM`, `OUTBOX_WORKER_SECRET`, `WEBHOOK_SECRET`.

---

## 7. Known Limitations

- Local Firebase Firestore Emulator and live provider credentials (Resend/Brevo/SMTP) were not available in this environment; tests verify behavior against an in-process stateful Firestore transaction simulator and mocked provider transports.
- If `emailOutboxMetrics/summary` is ever edited manually out-of-band, counters only reflect transactional transitions going forward.

