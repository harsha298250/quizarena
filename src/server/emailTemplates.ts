/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface QuestionBreakdownItem {
  questionNumber: number;
  questionText: string;
  userAnswer: string;
  isCorrect: boolean;
  explanation: string;
  topicTag?: string;
  pointsEarned?: number;
}

export interface StudentEmailParams {
  studentName: string;
  quizTitle: string;
  score: number;
  rank: number;
  totalPlayers: number;
  accuracy: number;
  streak: number;
  weakTopics: string[];
  totalQuestions: number;
  questionBreakdown?: QuestionBreakdownItem[];
}

export interface TeacherReportParams {
  teacherName: string;
  quizTitle: string;
  gameId: string;
  totalParticipants: number;
  averageScore: number;
  averageAccuracy: number;
  topPerformers: Array<{ rank: number; nickname: string; score: number }>;
  toughQuestions: Array<{ questionNumber: number; text: string; correctPercentage: number }>;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Generates tactile Playful Paper HTML email for a student
 */
export function generateStudentEmailHtml(params: StudentEmailParams): string {
  const {
    studentName,
    quizTitle,
    score,
    rank,
    totalPlayers,
    accuracy,
    streak,
    weakTopics,
    totalQuestions,
    questionBreakdown,
  } = params;

  const breakdownRows = (questionBreakdown || [])
    .map(q => {
      const statusBadge = q.isCorrect
        ? `<span style="display:inline-block;background:#D1FAE5;color:#065F46;border:1.5px solid #10B981;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:bold;">✅ Correct (+${q.pointsEarned || 0})</span>`
        : `<span style="display:inline-block;background:#FEE2E2;color:#991B1B;border:1.5px solid #EF4444;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:bold;">❌ Incorrect</span>`;

      return `
      <div style="background:#FFFFFF;border:2px solid #16120E;border-radius:10px;padding:12px;margin-bottom:10px;box-shadow:2px 2px 0 #16120E;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <strong style="color:#16120E;font-size:13px;">Q${q.questionNumber}: ${escapeHtml(q.questionText)}</strong>
          ${statusBadge}
        </div>
        <div style="font-size:12px;color:#4B5563;margin-bottom:4px;">
          <strong>Your Answer:</strong> ${escapeHtml(q.userAnswer || '(No answer recorded)')}
        </div>
        <div style="font-size:12px;color:#1F2937;background:#F9FAFB;border-left:3px solid #FF5A36;padding:6px 10px;border-radius:4px;margin-top:6px;">
          <strong style="color:#FF5A36;">Explanation:</strong> ${escapeHtml(q.explanation || 'Reviewed during question reveal.')}
        </div>
        ${
          q.topicTag
            ? `<div style="font-size:10px;color:#9CA3AF;margin-top:4px;">Topic: ${escapeHtml(q.topicTag)}</div>`
            : ''
        }
      </div>
    `;
    })
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #FFF6E5; margin: 0; padding: 24px; color: #16120E; }
    .card { background: #FFFFFF; border: 3px solid #16120E; border-radius: 16px; box-shadow: 6px 6px 0 #16120E; max-width: 640px; margin: 0 auto; padding: 28px; }
    .badge { display: inline-block; background: #FFC83D; border: 2px solid #16120E; padding: 4px 12px; font-weight: bold; border-radius: 9999px; font-size: 12px; }
    .stat-box { background: #FFF6E5; border: 2px solid #16120E; border-radius: 12px; padding: 12px; text-align: center; }
    .tomato-btn { display: inline-block; background: #FF5A36; color: #FFFFFF !important; text-decoration: none; font-weight: bold; padding: 12px 24px; border: 3px solid #16120E; border-radius: 12px; box-shadow: 4px 4px 0 #16120E; margin-top: 16px; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div style="text-align: center; margin-bottom: 24px;">
      <span class="badge">QuizArena Results</span>
      <h1 style="color: #FF5A36; margin: 12px 0 4px 0; font-size: 26px;">Great effort, ${escapeHtml(studentName)}!</h1>
      <p style="margin: 0; color: #555; font-size: 14px;">Here is your complete scorecard for <strong>${escapeHtml(quizTitle)}</strong></p>
    </div>

    <!-- Core Metrics -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 24px;">
      <div class="stat-box">
        <div style="font-size: 11px; color: #666; font-weight: bold; text-transform: uppercase;">Rank</div>
        <div style="font-size: 26px; font-weight: 900; color: #FF5A36;">#${rank} <span style="font-size: 14px; color: #888;">of ${totalPlayers}</span></div>
      </div>
      <div class="stat-box">
        <div style="font-size: 11px; color: #666; font-weight: bold; text-transform: uppercase;">Total Score</div>
        <div style="font-size: 26px; font-weight: 900; color: #14B8A6;">${score.toLocaleString()}</div>
      </div>
      <div class="stat-box">
        <div style="font-size: 11px; color: #666; font-weight: bold; text-transform: uppercase;">Accuracy</div>
        <div style="font-size: 26px; font-weight: 900; color: #FFC83D;">${Math.round(accuracy * 100)}%</div>
      </div>
      <div class="stat-box">
        <div style="font-size: 11px; color: #666; font-weight: bold; text-transform: uppercase;">Best Streak</div>
        <div style="font-size: 26px; font-weight: 900; color: #4DA3FF;">${streak} 🔥</div>
      </div>
    </div>

    <!-- Weak Topics / Review Needed -->
    ${
      weakTopics && weakTopics.length > 0
        ? `<div style="background: #FFF0ED; border: 2px dashed #FF5A36; border-radius: 12px; padding: 14px; margin-bottom: 24px;">
            <strong style="color: #FF5A36; font-size: 13px;">Recommended topics to review:</strong>
            <ul style="margin: 6px 0 0 20px; padding: 0; font-size: 12px; color: #333;">
              ${weakTopics.map(t => `<li>${escapeHtml(t)}</li>`).join('')}
            </ul>
          </div>`
        : ''
    }

    <!-- Detailed Question Breakdown -->
    ${
      breakdownRows.length > 0
        ? `<div style="margin-bottom: 24px;">
            <h3 style="font-size: 15px; font-weight: 900; color: #16120E; margin-bottom: 12px; border-bottom: 2px solid #16120E; padding-bottom: 4px;">
              Question Breakdown & Explanations (${totalQuestions} Questions)
            </h3>
            ${breakdownRows}
          </div>`
        : ''
    }

    <!-- Call to action -->
    <div style="text-align: center; border-top: 2px solid #EEE; padding-top: 20px;">
      <p style="font-size: 13px; color: #555; margin: 0 0 10px 0;">Keep sharpening your skills for the next multiplayer arena tournament!</p>
      <a href="https://quizarena.app" class="tomato-btn">Play Again in QuizArena</a>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Generates tactile Playful Paper HTML class report for the teacher
 */
export function generateTeacherReportHtml(params: TeacherReportParams): string {
  const {
    teacherName,
    quizTitle,
    gameId,
    totalParticipants,
    averageScore,
    averageAccuracy,
    topPerformers,
    toughQuestions,
  } = params;

  const topPerformerRows = topPerformers
    .map(
      p => `
      <tr style="border-bottom: 1px solid #E5E7EB;">
        <td style="padding: 8px 12px; font-weight: bold; color: #FF5A36;">#${p.rank}</td>
        <td style="padding: 8px 12px; font-weight: 600;">${escapeHtml(p.nickname)}</td>
        <td style="padding: 8px 12px; text-align: right; font-weight: bold; color: #14B8A6;">${p.score.toLocaleString()} pts</td>
      </tr>
    `
    )
    .join('');

  const toughQuestionRows = (toughQuestions || [])
    .map(
      q => `
      <div style="background: #FFF7ED; border: 1.5px solid #F97316; border-radius: 8px; padding: 10px; margin-bottom: 8px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
          <strong>Q${q.questionNumber}: ${escapeHtml(q.text)}</strong>
          <span style="color:#C2410C;font-weight:bold;">${Math.round(q.correctPercentage)}% passed</span>
        </div>
      </div>
    `
    )
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #FFF6E5; margin: 0; padding: 24px; color: #16120E; }
    .card { background: #FFFFFF; border: 3px solid #16120E; border-radius: 16px; box-shadow: 6px 6px 0 #16120E; max-width: 640px; margin: 0 auto; padding: 28px; }
    .badge { display: inline-block; background: #14B8A6; color: white; border: 2px solid #16120E; padding: 4px 12px; font-weight: bold; border-radius: 9999px; font-size: 12px; }
    .stat-box { background: #FFF6E5; border: 2px solid #16120E; border-radius: 12px; padding: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div style="text-align: center; margin-bottom: 24px;">
      <span class="badge">Teacher Cohort Report</span>
      <h1 style="color: #16120E; margin: 12px 0 4px 0; font-size: 24px;">Class Results: ${escapeHtml(quizTitle)}</h1>
      <p style="margin: 0; color: #666; font-size: 13px;">Host: <strong>${escapeHtml(teacherName)}</strong> • Session PIN / Game ID: <code>${gameId}</code></p>
    </div>

    <!-- Cohort Overview -->
    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 24px;">
      <div class="stat-box">
        <div style="font-size: 11px; color: #666; font-weight: bold;">PARTICIPANTS</div>
        <div style="font-size: 24px; font-weight: 900; color: #16120E;">${totalParticipants}</div>
      </div>
      <div class="stat-box">
        <div style="font-size: 11px; color: #666; font-weight: bold;">CLASS AVG SCORE</div>
        <div style="font-size: 24px; font-weight: 900; color: #14B8A6;">${Math.round(averageScore).toLocaleString()}</div>
      </div>
      <div class="stat-box">
        <div style="font-size: 11px; color: #666; font-weight: bold;">ACCURACY</div>
        <div style="font-size: 24px; font-weight: 900; color: #FFC83D;">${Math.round(averageAccuracy * 100)}%</div>
      </div>
    </div>

    <!-- Leaderboard Top 5 -->
    <div style="margin-bottom: 24px;">
      <h3 style="font-size: 15px; font-weight: 900; color: #16120E; margin-bottom: 8px;">Top Performers</h3>
      <table style="width: 100%; border-collapse: collapse; border: 2px solid #16120E; border-radius: 8px; overflow: hidden; font-size: 13px;">
        <thead style="background: #FFF6E5; border-bottom: 2px solid #16120E;">
          <tr>
            <th style="padding: 8px 12px; text-align: left;">Rank</th>
            <th style="padding: 8px 12px; text-align: left;">Student</th>
            <th style="padding: 8px 12px; text-align: right;">Score</th>
          </tr>
        </thead>
        <tbody>
          ${topPerformerRows}
        </tbody>
      </table>
    </div>

    <!-- Tough Questions / Misconception Alerts -->
    ${
      toughQuestionRows.length > 0
        ? `<div style="margin-bottom: 20px;">
            <h3 style="font-size: 15px; font-weight: 900; color: #C2410C; margin-bottom: 8px;">Cohort Misconceptions (Needs Review)</h3>
            ${toughQuestionRows}
          </div>`
        : ''
    }

    <div style="border-top: 2px solid #EEE; padding-top: 16px; font-size: 12px; color: #666; text-align: center;">
      Generated automatically by QuizArena • All student result cards have been dispatched to their consented inboxes.
    </div>
  </div>
</body>
</html>
  `;
}
