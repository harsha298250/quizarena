# QuizArena — Persistent Certificate System (Phase 2)

## 1. Firestore Collection Structure

All production certificate operations use Firestore via Firebase Admin SDK (`src/server/certificateEngine.ts` + `src/server/notificationHandler.ts`):

1. **`certificates/{certificateId}`**
   - Authoritative certificate record (`id`, `verificationId`, `ownerId`, `recipientName`, `assessmentType`, `assessmentId`, `assessmentTitle`, `type`, `score`, `rank`, `totalParticipants`, `accuracy`, `issuerId`, `issuerName`, `issueDate`, `status`, `reissueCount`, and optional `revocationReason`, `revokedAt`, `revokedBy`).
   - **Security Rule (`firestore.rules`)**: Client reads allowed **only** for signed-in users where `resource.data.ownerId == request.auth.uid || resource.data.issuerId == request.auth.uid`. Direct client writes are blocked (`allow write: if false`).
2. **`certificateVerification/{verificationId}`**
   - Public verification lookup pointer (`verificationId`, `certificateId`, `assessmentType`, `assessmentId`, `status`: `'valid' | 'revoked' | 'superseded'`, `createdAt`, optional `revokedAt` / `supersededBy`).
   - **Zero PII**: Contains no `ownerId`, email, or score.
   - **Security Rule (`firestore.rules`)**: `allow read, write: if false` (server Admin SDK only).
3. **`certificateIdempotency/{idempotencyKey}`**
   - Prevents duplicate issuance under concurrent or retried requests.
   - Key format: `${assessmentType}_${assessmentId}_${ownerId}`.
   - Stores `{ idempotencyKey, certificateId, ownerId, issuerId, assessmentType, assessmentId, createdAt, updatedAt }`.
   - **Security Rule (`firestore.rules`)**: `allow read, write: if false` (server Admin SDK only).

---

## 2. Atomic Workflows

### Issuance (`POST /api/certificates/issue`)
1. Authenticates caller via Firebase ID token (`adminAuth.verifyIdToken`).
2. Validates `ownerId` and `assessmentId`, then reads authoritative assessment (`games/{id}` or `tournaments/{id}`) and participant records (`players/{ownerId}` or `registrations/{ownerId}`).
3. Derives `issuerId`, `score`, `rank`, `totalParticipants`, `accuracy`, and `type` strictly on the server (ignoring client-supplied values).
4. Restricts `reissue=true` strictly to the assessment host or an administrator.
5. Executes `adminDb.runTransaction`:
   - Reads `certificateIdempotency/{key}` first; if present and `!reissue`, returns the existing certificate (`isDuplicate: true`).
   - Generates a random `QA-V-XXXX-XXXX-XXXX` verification ID and verifies `certificateVerification/{verificationId}` does not exist (retrying up to 5 times on collision).
   - If `reissue=true`, marks the previous `certificateVerification/{oldId}` as `status: 'superseded'` and increments `reissueCount`.
   - Atomically writes `certificates/{certId}`, `certificateVerification/{verificationId}`, and `certificateIdempotency/{key}`.

### Public Verification (`GET /api/certificates/verify/:verificationId`)
- Reads `certificateVerification/{verificationId}` (rejecting `status === 'superseded'`), then loads `certificates/{certificateId}`.
- Includes a compatibility query fallback (`certificates` where `verificationId == id`) for any legacy records written before Phase 2.
- Strips `ownerId`, `email`, `score`, and `revokedBy` from the response. Returns `404` when not found, and `200 { valid: false, status: 'revoked' }` when revoked.

### Revocation (`POST /api/certificates/revoke`)
- Authenticates caller and runs `adminDb.runTransaction`.
- Verifies caller is `cert.issuerId` or has admin claims (`403` otherwise).
- Idempotently returns success if already revoked; otherwise updates both `certificates/{certificateId}` and `certificateVerification/{verificationId}` atomically.

---

## 3. Indexes & Compatibility Notes

- **Required Composite Index (`firestore.indexes.json`)**: `certificates` (`ownerId ASC`, `issueDate DESC`) is already defined. Single-field equality queries on `ownerId` and `verificationId` use Firestore automatic single-field indexes.
- **Migration / Compatibility**: No destructive migration is needed. Legacy records in `certificates` without a corresponding `certificateVerification` document remain verifiable via the fallback query in `verifyCertificatePublicPersistent`.
- **Tournament Note**: Tournament certificate issuance via `tournaments/{id}/registrations/{ownerId}` depends on Phase 3 (Persistent Tournaments) writing registration/standings documents to Firestore.
