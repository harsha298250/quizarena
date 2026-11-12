# QuizArena — Implemented API Documentation

## 1. System & Health Endpoints
- `GET /health` | `GET /api/health`
  - **Auth**: None
  - **Response 200/503**: Safe operational status summary indicating connectivity for Firestore, Auth, Gemini, and Email delivery without leaking secrets.

## 2. Authentication & Multiplayer Session Endpoints
- `POST /api/game/create`
  - **Auth**: Host Bearer Token
  - **Body**: `{ quizId, title, options }`
  - **Response 200**: `{ gameId, pin, status: 'lobby' }`
- `POST /api/game/join`
  - **Auth**: None / Anonymous allowed
  - **Body**: `{ pin, nickname }`
  - **Response 200**: `{ playerId, gameId, nickname }`
- `POST /api/game/answer`
  - **Auth**: Player Bearer Token
  - **Body**: `{ gameId, questionIndex, answerPayload, clientTimeMs }`
  - **Response 200**: Score calculation based on server secret key and latency clamping.
- `POST /api/game/advance`
  - **Auth**: Host Bearer Token
  - **Body**: `{ gameId, targetQuestionIndex }`
  - **Response 200**: Authoritative question transition.

## 3. Persistent Tournament Endpoints
- `POST /api/tournaments/create`
  - **Auth**: Host Bearer Token
  - **Body**: `{ title, description, minParticipants, maxParticipants, registrationDeadline, quizzes, visibility }`
  - **Response 200**: Root tournament record initialized.
- `POST /api/tournaments/register`
  - **Auth**: Student / Player Bearer Token
  - **Body**: `{ tournamentId, nickname }`
  - **Response 200**: Atomic registration with contiguous seed. Returns `403` if full, `409` if duplicate.
- `POST /api/tournaments/cancel-registration`
  - **Auth**: Registered Player Token
  - **Body**: `{ tournamentId }`
  - **Response 200**: Marks status `withdrawn`, reclaims tournament participant slot.
- `POST /api/tournaments/start-round`
  - **Auth**: Host Bearer Token
  - **Body**: `{ tournamentId }`
  - **Response 200**: Advances tournament from `registration_open` to `active`, generates bracket matches, or advances winners to the next round.
- `POST /api/tournaments/finalize-match`
  - **Auth**: Host Bearer Token
  - **Body**: `{ tournamentId, matchId }`
  - **Response 200**: Derives official scores from linked game session, breaks ties, updates match status to `completed`.
- `GET /api/tournaments/:id/standings`
  - **Auth**: Optional for public tournaments; Required (Host or Participant) for private tournaments.
  - **Response 200**: Verified rankings, champion information, and participant match records.

## 4. AI Quiz Studio Endpoints
- `POST /api/generate-quiz`
  - **Auth**: Authenticated / Rate-limited Anonymous
  - **Body**: `{ prompt, questionCount, difficulty }`
  - **Response 200**: `{ questions: [...], provider: 'gemini' | 'grok' | 'heuristic' }`
- `POST /api/ai-warmup`
  - **Auth**: None (Rate-limited IP)
  - **Response 200**: Safe connection verification.

## 5. Durable Email Outbox Endpoints
- `POST /api/outbox/enqueue`
  - **Auth**: Host Bearer Token
  - **Body**: `{ recipientEmail, recipientName, eventType, subject, htmlContent }`
  - **Response 200**: Transactionally records outbox job. Returns `isDuplicate: true` on replay.
- `POST /api/outbox/process-batch`
  - **Auth**: Internal Worker Secret (`x-worker-secret`) or Admin Token
  - **Body**: `{ batchSize: 10 }`
  - **Response 200**: Atomically claims and dispatches eligible jobs with lease renewal and fencing.
- `POST /api/outbox/webhook`
  - **Auth**: Svix Signature Headers (`svix-id`, `svix-timestamp`, `svix-signature`)
  - **Response 200**: Deduplicates delivery/bounce webhook events and protects terminal job states.

