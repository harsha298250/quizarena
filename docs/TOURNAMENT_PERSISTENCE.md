# QuizArena — Persistent Tournament Management (Phase 3)

## 1. Firestore Schema

All production tournament operations in `src/server/tournamentHandler.ts` use Firestore via Firebase Admin SDK:

1. **`tournaments/{tournamentId}`**
   - Stores configuration, lifecycle status (`draft`, `registration_open`, `active`, `completed`, `cancelled`), `hostId`, `hostName`, `visibility`, `maxParticipants`, `minParticipants`, `participantCount`, `registrationDeadline`, `quizzes`, `rounds`, `championId`, `championNickname`, `createdAt`, `updatedAt`, `completedAt`.
2. **`tournaments/{tournamentId}/registrations/{participantId}`**
   - Document ID is the authenticated `user.uid` (`participantId`), preventing duplicate registrations per user.
   - Stores `id`, `tournamentId`, `participantId`, `participantNickname`, `registeredAt`, `status` (`registered` | `withdrawn` | `disqualified`), `seed`, `initialElo`, and upon completion: authoritative `rank`, `score`, `accuracy`, `totalParticipants`, `completedAt`.
3. **`tournaments/{tournamentId}/matches/{matchId}`**
   - Persists each `TournamentMatch` (`id`, `tournamentId`, `roundId`, `roundNumber`, `matchNumber`, `player1Id`, `player2Id`, `gameId`, `status`, `winnerId`, `score1`, `score2`, `isBye`, `finalizedAt`).
4. **`tournaments/{tournamentId}/results/{participantId}`**
   - Persists final computed `TournamentStanding` (`rank`, `matchesPlayed`, `wins`, `losses`, `points`, `totalScore`, `isEliminated`, `eloRating`, `accuracy`, `completedAt`).

---

## 2. Transactions, Concurrency & Security

- **Creation (`POST /api/tournaments/create`)**: Rejects unauthenticated (`401`) and anonymous (`403`) users, validates config (`validateTournamentConfig`), writes `tournaments/{id}` directly (errors return `500` — never swallowed).
- **Registration (`POST /api/tournaments/register`)**: Rejects `participantId` spoofing (`403`), executes `adminDb.runTransaction` reading `tournaments/{id}`, `registrations/{uid}`, and active registrations (`where('status', '==', 'registered')`) before writing to enforce deadline, duplicate prevention (`409`), capacity (`403`), and unique active seeds (`maxActiveSeed + 1`).
- **Cancellation (`POST /api/tournaments/cancel-registration`)**: Transactionally marks `registrations/{uid}` as `withdrawn` and decrements `participantCount` while `status === 'registration_open'`.
- **Bracket & Round Progression (`POST /api/tournaments/start-round`)**: Restricted to `hostId` or verified admin (`403`). Validates transitions via `isValidTournamentTransition`, deterministically generates single-elimination brackets, advances winners only when all current-round matches are complete (returning `400` on domain errors and `500` on unexpected Firestore/server failures), and on Grand Finals completion atomically persists `status: 'completed'`, `results/{uid}`, and registration `rank`/`score`/`accuracy`.
- **Match Finalization (`POST /api/tournaments/finalize-match`)**: Restricted to `hostId` or verified admin (`403`). Idempotently returns completed matches without overwriting. When `match.gameId` is linked, returns `404` if either `games/{gameId}/players/{player1Id|player2Id}` record is missing (never falling back to client-supplied scores), derives `score1`/`score2` exclusively from Firestore, and resolves exact score ties deterministically in favor of the higher bracket seed (`player1Id`) without trusting `req.body.winnerId`.
- **Standings (`GET /api/tournaments/:id/standings`)**: Enforces private tournament access (`hostId`, admin, or participant with `status === 'registered'`) and computes deterministic rankings via `computeTournamentStandings`.

---

## 3. Phase 2 Certificate Integration & Firestore Rules

- `handleIssueCertificate` (`src/server/notificationHandler.ts`) now requires `tourneyData.status === 'completed'` (`400` otherwise) and reads authoritative `rank`, `score`, `accuracy`, and `participantNickname` written to `tournaments/{id}/registrations/{uid}` on completion.
- `firestore.rules` enforces `isNonAnonymous()` and restricts private tournament reads (`visibility == 'private'`) on `tournaments/{id}`, `tournaments/{id}/matches/{matchId}`, and `tournaments/{id}/results/{resultId}` to the host or actively registered participants (`status == 'registered'`), blocks client writes to `matches`, `registrations`, and `results`, and blocks direct tournament `create`/`delete`.
- Required composite indexes in `firestore.indexes.json`: `tournaments` (`hostId ASC, createdAt DESC`) and (`status ASC, scheduledStartTime ASC`).

---

## 4. Emulator Testing & Known Limitations

- **Emulator Status**: Local Firebase Emulator binary is not cached in this environment, so Phase 3 tests were executed against a serialized stateful Firestore transaction simulator (`src/tests/phase3PersistentTournaments.vitest.test.ts`). Real Firestore Emulator integration tests should be run via `firebase emulators:exec --only firestore` before production deployment.
- **Frontend UI**: `CompetitionManager.tsx` retains its existing sample tournament UI and was not redesigned in this phase.