# QuizArena — Viva & Defense Preparation Guide

## 1. Project Motivation & Problem Statement
Traditional classroom polling tools either lack persistent competitive formats (tournaments), suffer from question generation bottlenecks when AI APIs experience downtime, or lack robust data cleanup workflows. QuizArena was designed to provide a secure, server-authoritative competition platform with durable background processing, multi-tiered fault tolerance, and comprehensive multi-stage account data deletion.

## 2. Key Architecture & Design Decisions
- **Why Firebase Authentication & Firestore?**
  - Real-time snapshot listeners allow sub-second synchronization between host arena controls and participating player screens without managing complex WebSocket connection pools.
  - Granular security rules enforce access boundaries directly at the storage engine level.
- **Why a Server-Authoritative Scoring Engine?**
  - In multiplayer gaming, client clocks and network latencies vary widely. Storing secret answer keys in a server-only subcollection (`/secrets`) and calculating scores server-side prevents answer tampering, forged score injection, and time-manipulation cheats.
- **Why a Durable Transactional Email Outbox?**
  - Direct HTTP calls to third-party email providers during database operations risk distributed transaction failures. The Outbox pattern ensures atomic commits in Firestore, worker leases with lease fencing, and idempotency across server restarts.
- **Why Multi-Tiered AI Fallbacks?**
  - Commercial LLMs (Gemini, Grok) frequently experience HTTP 429 rate limits, network latency spikes, or region-specific outages. A fallback chain (Gemini -> Grok -> Deterministic Pedagogical Heuristic) guarantees zero student disruption during live quizzes.

## 3. Anticipated Questions & Answers

### Q: How does the tournament system prevent two players from acquiring the same seed or exceeding capacity?
**A**: Registration operations run inside `adminDb.runTransaction`. The transaction performs all reads before writes, evaluates active registrations (`where('status', '==', 'registered')`), verifies that `activeCount < maxParticipants`, and assigns `seed = maxActiveSeed + 1`. Under concurrent bursts, Firestore detects read-set collisions, automatically retries the conflicting transactions, and rejects excess requests with HTTP 403.

### Q: How are participant privacy and data cleanup handled during account deletion?
**A**: Account deletion is executed via a 9-stage transactional engine. All user profiles, authentication tokens, and private storage files are purged. To maintain tournament bracket history without breaking dependencies for surviving participants, the user's host records and match entries are scrubbed of PII and replaced with deterministic pseudonyms (`[deleted]`).

### Q: How does the application prevent stale workers from corrupting outbox jobs?
**A**: Each outbox job doc contains a `leaseVersion` and `lockedUntil` timestamp. When a job lease expires or is cancelled due to account deletion, the `leaseVersion` is incremented. When the original worker attempts to complete the job, the transaction checks that `current.leaseVersion === workerLeaseVersion`. If mismatched, the write is aborted with `{ staleLease: true }`.

