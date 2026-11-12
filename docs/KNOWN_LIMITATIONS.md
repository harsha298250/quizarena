# QuizArena — Known Limitations and Operational Boundaries

## 1. Third-Party Provider Sandboxes & Billable Endpoints
- **Gemini / Grok AI Generation**: Local integration tests utilize local HTTP stubs and deterministic heuristic fallbacks rather than connecting to live billable external endpoints during automated test suites.
- **Resend / Brevo / SMTP**: Local integration testing simulates provider endpoints via local `127.0.0.1` servers and mock Nodemailer transports to prevent unauthorized email dispatch.

## 2. Horizontal Scalability & Distributed Infrastructure
- **Process-Local Rate Limiting**: `SharedRateLimiter` maintains sliding window counters in memory within each Node.js process. In multi-instance deployments without sticky sessions, rate limits apply per-instance. A distributed cache (e.g. Redis) is recommended for high-volume multi-cluster scaling.
- **Sequential Tournament Deletion**: During full account deletion, `getAllDocsPaginated` inspects tournaments to anonymize host records. While performant for thousands of documents, extremely large databases would benefit from secondary index lookups (`where('hostId', '==', uid)`).

## 3. Render Free Tier Operational Constraints
- **Outbound SMTP Ports**: Render Free tier restricts outbound raw TCP connections on SMTP ports 25, 465, and 587. The Resend HTTPS API (port 443) is the recommended email delivery provider for Render hosting.
- **Spin-down & Cold Starts**: Free instances spin down after inactivity. The health check endpoint (`/health`) may take 30–50 seconds on cold start before returning `healthy`.

## 4. Phase 0 Manual Release Blockers
- **Exposed SMTP Credential in `.env`**: Root `.env` contains an exposed Gmail app password requiring rotation in Google Account settings.
- **Contaminated Historical Archives**: Older ZIP archives in the workspace root contain `.env` files and must be sanitized.
- **Packaging Safety Filter**: Release packaging scripts must enforce exclusion of `.env*`, `serviceAccount*.json`, `*.key`, and `*.pem`.

