# QuizArena — Capstone Demonstration Guide

## 1. Recommended Demonstration Flow

### Step 1: Core Landing & Viewport Responsiveness
- Open `http://localhost:5173` (or production URL).
- Highlight the modern dual-shell interface (`PlayerShell` for participants vs `HostShell` for educators).
- Toggle light and dark themes using the Theme Toggle control.
- Demonstrate mobile responsiveness using DevTools device simulation (375px mobile vs 1280px desktop).

### Step 2: Live Multiplayer Arena Demonstration
1. **Host Screen**:
   - Navigate to Host Dashboard (`/?tab=host_dashboard`).
   - Click "Host Live" and launch a sample quiz.
   - Note the generated 6-digit Game PIN.
2. **Player Screen**:
   - Open an incognito browser window or separate device.
   - Enter the Game PIN and nickname.
   - Observe live player connection in the Host Lobby.
3. **Gameplay**:
   - Host clicks "Start Game".
   - Submit answers; show real-time score updates and strike-integrity protections.
   - Display the Podium / Leaderboard view at the end of the game.

### Step 3: Tournament & Bracket Progression Demonstration
- Navigate to Tournaments (`/?tab=competitions`).
- Show the single-elimination bracket with seeding.
- Demonstrate active match finalization linked to live game player scores.
- Show automated winner advancement to the next round and tournament completion.

### Step 4: Multi-Provider AI Quiz Studio
- Navigate to AI Quiz Studio (`/?tab=ai`).
- Enter a topic prompt (e.g. "World History: Ancient Civilizations") and generate 5 questions.
- Demonstrate provider metadata tag: notice the graceful fallback to the pedagogical engine if external API keys are unavailable, providing instant valid questions.

### Step 5: Digital Certificates & Outbox Status
- View Certificates (`/?tab=certificates`).
- View Outbox (`/?tab=outbox`) to show durable email queuing and Svix webhook delivery status.

### Step 6: Privacy, Settings & Safe Account Deletion
- Open Settings dialog (`⚙️`).
- Show email notification preferences.
- Demonstrate the 9-stage account deletion flow confirmation modal with full PII scrubbing.

