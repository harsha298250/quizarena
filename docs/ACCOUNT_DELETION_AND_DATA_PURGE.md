# QuizArena — Account Deletion & Complete Data Purge (Phase 4)

## 1. Account Deletion Architecture

Phase 4 replaces the legacy single-shot purge with a persistent, staged, transactional, and resumable account deletion pipeline:

- **Engine**: `src/server/accountDeletionEngine.ts`
- **HTTP Handlers**: `src/server/userDataPurgeHandler.ts`
- **Routes**: `server.ts`
- **Security Rules**: `firestore.rules`
- **Frontend Flow**: `src/components/common/SettingsModal.tsx`, `src/services/quizService.ts`, `src/App.tsx`

---

## 2. Deletion Lifecycle

Every deletion request creates or resumes a persistent `accountDeletionJobs/{jobId}` document protected by a deterministic per-user lock `accountDeletionLocks/{sha256(uid)}`:

- `requested` → `processing` → `completed` | `failed`

Ordered idempotent stages (`ALL_DELETION_STAGES`):
1. `mark_pending` — Marks `users/{uid}.status = 'deletion_pending'`, records one-way `accountDeletionEmailBlocks/{sha256(email)}`, and revokes Firebase refresh tokens (`adminAuth.revokeRefreshTokens(uid)`).
2. `purge_personal_content` — Paginated 400-op batch deletion of `quizzes`, `questionBank`, `emailTemplates`, and `competitions` owned by `uid`.
3. `purge_mail_outbox` — Cancels and scrubs PII from pending/queued/processing `mail` docs and deletes completed user-owned `mail` docs.
4. `handle_tournaments` — Withdraws from `registration_open` tournaments, cancels `registration_open`/`active` hosted tournaments (`cancelReason: 'host_account_deleted'`), deletes `draft` hosted tournaments, and anonymizes completed tournament matches/results/registrations with a one-way pseudonymous ID (`deleted_<hash>`).
5. `handle_games` — Deletes solo/unshared hosted games and all subcollections (`players`, `answers`, `secrets`, `kickedPlayers`, `guestEmails`, `flags`, `questionsQA`); anonymizes shared or tournament-linked games and player/answer/flag/Q&A records while deleting `guestEmails/{uid}` and `kickedPlayers/{uid}`.
6. `handle_certificates` — Anonymizes recipient PII on owned `certificates` and `certificateVerification` snapshots **while preserving certificate validity/status**; anonymizes issuer metadata on certificates issued to other users without revoking them.
7. `purge_storage` — Deletes `users/{uid}/` objects via `adminStorage`. **Unavailable `adminStorage` fails the stage** rather than reporting false completion.
8. `delete_auth_and_profile` — Deletes `users/{uid}` and calls `adminAuth.deleteUser(uid)` (treating `auth/user-not-found` idempotently).
9. `finalize_job` — Marks `accountDeletionJobs/{jobId}` and `accountDeletionLocks/{uidHash}` as `completed`, scrubs plaintext `uid` to `'[purged]'`, and clears `recoveryTokenHash`.

---

## 3. API Endpoints

- `POST /api/account/delete` — Authenticated owner-only deletion request (rate-limited: 5 requests / 10m per UID). Never trusts client-supplied UID. Returns `200` only when `status === 'completed'`, `202` on duplicate active job, or `500` with `jobId` and `recoveryToken` on failure.
- `GET /api/account/delete/status` — Returns sanitized job status for owner, admin (`?uid=`), or `recoveryToken` holder.
- `POST /api/account/delete/retry` — Resumes a `failed` job from the last incomplete stage. Authorizes via `recoveryToken`, admin token, `x-worker-secret`, or owner token — **does not depend on the deleted account's Firebase token**.
- `POST /api/admin/users/:uid/delete` — Administrator-only deletion endpoint (`isAdminUser` required; `403` otherwise).
- `POST /api/purge-user-data` — Delegates to the Phase 4 staged engine for backward compatibility.

---

## 4. Authentication, Authorization & Active-Account Enforcement

- UID is derived strictly from `adminAuth.verifyIdToken(...)`. Anonymous users are rejected (`403`).
- `assertAccountActive(adminDb, uid)` rejects `deletion_pending` or locked accounts (`403`) across protected tournament and certificate handlers without affecting unrelated users.
- `handleProcessOutbox` checks `isAccountDeletionPending` and `isEmailBlockedForDeletion` immediately before sending each queued email, permanently cancelling messages for deleted/deletion-pending accounts.

---

## 5. Collection-by-Collection Ownership & Deletion Matrix

| Collection | Owner | Policy | Reason |
|---|---|---|---|
| `users/{uid}` | User | Mark `deletion_pending`, then Delete | Blocks stale sessions/recreation; removes profile PII |
| `accountDeletionJobs/{jobId}` | System | Retain 90 days (sanitized, `uid: '[purged]'`) | Idempotency, audit, and retry recovery |
| `accountDeletionLocks/{uidHash}` | System | Retain 90 days (`sha256(uid)` key) | Prevents concurrent/duplicate deletion runs |
| `accountDeletionEmailBlocks/{emailHash}` | System | Retain (`sha256(email)` key) | Prevents outbox workers from emailing deleted users |
| `quizzes` / `questionBank` / `emailTemplates` / `competitions` | User | Delete | User-owned personal content |
| `mail` | User / System | Cancel & scrub pending; Delete completed | Prevents sending or recreating PII |
| `tournaments` & subcollections | Host / Shared | Delete drafts; cancel active hosted; anonymize shared/completed | Preserves competition & leaderboard integrity |
| `games` & subcollections | Host / Shared | Delete solo; anonymize shared/linked; delete `guestEmails`/`kickedPlayers` | Preserves cohort analytics & other players' records |
| `certificates` & `certificateVerification` | Recipient / Issuer | Anonymize PII; preserve validity/status | Preserves verification consistency without exposing PII |
| Firebase Storage (`users/{uid}/`) | User | Delete prefix | Removes uploaded user files (fails if unavailable) |
| Firebase Authentication | User | Delete via `adminAuth.deleteUser` | Permanently removes login identity |

---

## 6. Retention Policy for Minimal Deletion-Job Metadata

`accountDeletionJobs/{jobId}` and `accountDeletionLocks/{uidHash}` retain only `jobId`, `uidHash` (non-reversible SHA-256), `status`, `completedStages`, `attempts`, timestamps, `counts`, and sanitized error messages for **90 days** (`retentionExpiresAt`). No passwords, tokens, emails, names, or plaintext UIDs are retained after completion.

---

## 7. Test Coverage & Known Limitations

- **Test Suite**: `src/tests/phase4AccountDeletion.vitest.test.ts` (`[P4-01]`–`[P4-08]`) covers auth/admin/spoofing, deterministic locking & concurrency, shared game/tournament/certificate anonymization, deletion-pending blocking, outbox worker cancellation, unavailable storage failure, post-Auth-deletion recovery via `recoveryToken`, and static `firestore.rules` checks.
- **Limitations**:
  - Local Firebase Firestore Emulator and live Firebase Auth/Storage services are not available in this environment; tests run against an in-process stateful Firestore transaction simulator and mocked Auth/Storage.
  - Run `firebase emulators:exec --only firestore` and stage-environment manual verification with real Firebase Auth + Storage before production deployment.

