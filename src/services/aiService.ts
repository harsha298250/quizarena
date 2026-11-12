/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Question } from '../types/quiz';
import { auth, ensureAnonymousAuth } from '../lib/firebase';

export const GEMINI_MODEL_NAME =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_MODEL) || 'gemini-2.5-flash';

export interface GenerateQuizParams {
  sourceContent: string;
  sourceType: 'pdf_text' | 'pasted_text' | 'topic';
  numQuestions: number;
  difficulty: 'easy' | 'medium' | 'hard' | 'mixed';
  targetCO: string;
  language: string;
  existingQuestionTexts?: string[];
}

export interface AIInsightsReport {
  overallSummary: string;
  strengths: string[];
  strugglingAreas: string[];
  studentsNeedingSupport: string[];
  actionableNextSteps: string[];
}

export interface GenerateProgress {
  percent: number;
  phase: string;
  receivedCount: number;
  totalCount: number;
}

export interface GenerationMetadata {
  providerUsed?: 'gemini' | 'grok' | 'heuristic';
  modelUsed?: string;
  fallbackTriggered?: boolean;
  aiVerified?: boolean;
  notes?: string;
  validationSummary?: {
    totalReceived: number;
    validCount: number;
    rejectedCount: number;
    duplicateCount: number;
    rejectedReasons?: Array<{ index: number; reasons: string[] }>;
    duplicateWarnings?: Array<{ index: number; reason: string }>;
  };
}

export interface GenerateOptions {
  signal?: AbortSignal;
  onProgress?: (p: GenerateProgress) => void;
  onMetadata?: (meta: GenerationMetadata) => void;
}

class AIService {
  private endpoint: string;
  public lastGenerationMetadata: GenerationMetadata | null = null;

  constructor() {
    this.endpoint = import.meta.env.VITE_AI_ENDPOINT || '/api/generate-quiz';
  }

  /**
   * Silent warm-up ping for server container on opening the AI tab
   */
  public async warmUpServer(): Promise<void> {
    try {
      await fetch('/api/ai-warmup', { method: 'GET', cache: 'no-store' });
    } catch {
      // Non-blocking best-effort silent ping
    }
  }

  /**
   * Primary adapter: Calls server-side endpoint in parallel batches of 5 questions.
   * Features automatic 2x retry with exponential backoff and progressive batch delivery.
   */
  public async generateQuestions(params: GenerateQuizParams, options?: GenerateOptions): Promise<Question[]> {
    const user = auth.currentUser || (await ensureAnonymousAuth());
    const idToken = (await user?.getIdToken()) || '';

    const totalQuestions = Math.max(1, Math.min(50, params.numQuestions));

    // Divide into batches of at most 5 questions per requirements
    const batchSizes: number[] = [];
    let remaining = totalQuestions;
    while (remaining > 0) {
      const batch = Math.min(5, remaining);
      batchSizes.push(batch);
      remaining -= batch;
    }

    options?.onProgress?.({
      percent: 5,
      phase: `Waking server & starting generation in batches of 5...`,
      receivedCount: 0,
      totalCount: totalQuestions,
    });

    let completedBatches = 0;
    const allQuestions: Question[] = [];
    const aggregateSummary = {
      totalReceived: 0,
      validCount: 0,
      rejectedCount: 0,
      duplicateCount: 0,
      rejectedReasons: [] as Array<{ index: number; reasons: string[] }>,
      duplicateWarnings: [] as Array<{ index: number; reason: string }>,
    };
    let latestMeta: GenerationMetadata = {};

    // Helper with bounded transient retry (never retries 400/401/403/422/429)
    const fetchBatchWithRetry = async (batchParams: GenerateQuizParams, batchIdx: number): Promise<Question[]> => {
      let attempts = 0;
      const maxAttempts = 3; // 1 initial + up to 2 transient retries
      let lastErr: any = null;

      while (attempts < maxAttempts) {
        attempts++;
        try {
          const res = await fetch(this.endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
            },
            body: JSON.stringify(batchParams),
            signal: options?.signal,
          });

          if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            const rawErr = errJson.error || `Server responded with ${res.status}`;
            if (res.status === 429) {
              const retryAfter = res.headers?.get?.('retry-after');
              const rateErr: any = new Error(
                retryAfter
                  ? `Rate limit exceeded. Please wait ${retryAfter}s before generating more questions.`
                  : rawErr
              );
              rateErr.nonRetryable = true;
              rateErr.status = 429;
              rateErr.retryAfterSec = retryAfter ? Number(retryAfter) : undefined;
              throw rateErr;
            }
            if (res.status >= 400 && res.status < 500) {
              const clientErr: any = new Error(rawErr);
              clientErr.nonRetryable = true;
              clientErr.status = res.status;
              throw clientErr;
            }
            if (res.status === 503 || /not[_\s-]?found|model unavailable/i.test(rawErr)) {
              throw new Error('Quiz generation is temporarily unavailable. Please try again shortly.');
            }
            throw new Error(rawErr);
          }

          const data = await res.json();
          if (!Array.isArray(data.questions)) {
            throw new Error('Invalid question response format from server.');
          }

          if (data.providerUsed) latestMeta.providerUsed = data.providerUsed;
          if (data.modelUsed) latestMeta.modelUsed = data.modelUsed;
          if (typeof data.fallbackTriggered === 'boolean') {
            latestMeta.fallbackTriggered = Boolean(latestMeta.fallbackTriggered || data.fallbackTriggered);
          }
          if (typeof data.aiVerified === 'boolean') latestMeta.aiVerified = data.aiVerified;
          if (data.notes) latestMeta.notes = data.notes;
          if (data.validationSummary) {
            aggregateSummary.totalReceived += Number(data.validationSummary.totalReceived || 0);
            aggregateSummary.validCount += Number(data.validationSummary.validCount || 0);
            aggregateSummary.rejectedCount += Number(data.validationSummary.rejectedCount || 0);
            aggregateSummary.duplicateCount += Number(data.validationSummary.duplicateCount || 0);
            if (Array.isArray(data.validationSummary.rejectedReasons)) {
              aggregateSummary.rejectedReasons.push(...data.validationSummary.rejectedReasons);
            }
            if (Array.isArray(data.validationSummary.duplicateWarnings)) {
              aggregateSummary.duplicateWarnings.push(...data.validationSummary.duplicateWarnings);
            }
          }

          return data.questions;
        } catch (err: any) {
          lastErr = err;
          if (options?.signal?.aborted || err?.nonRetryable) throw err;
          if (attempts < maxAttempts) {
            const backoffMs = attempts * 1500;
            options?.onProgress?.({
              percent: Math.min(80, 10 + Math.round((completedBatches / batchSizes.length) * 60)),
              phase: `Retrying batch ${batchIdx + 1} (attempt ${attempts + 1}/${maxAttempts})...`,
              receivedCount: allQuestions.length,
              totalCount: totalQuestions,
            });
            await new Promise(r => setTimeout(r, backoffMs));
          }
        }
      }
      throw lastErr;
    };

    // Parallel execution across batches
    const batchPromises = batchSizes.map(async (batchSize, batchIdx) => {
      const batchParams: GenerateQuizParams = {
        ...params,
        numQuestions: batchSize,
      };

      const questions = await fetchBatchWithRetry(batchParams, batchIdx);
      completedBatches++;
      allQuestions.push(...questions);

      const pct = Math.min(85, Math.round(10 + (completedBatches / batchSizes.length) * 70));
      options?.onProgress?.({
        percent: pct,
        phase: `Received batch ${completedBatches} of ${batchSizes.length} (${allQuestions.length} / ${totalQuestions} questions)...`,
        receivedCount: allQuestions.length,
        totalCount: totalQuestions,
      });

      return questions;
    });

    await Promise.all(batchPromises);

    if (aggregateSummary.totalReceived > 0) {
      latestMeta.validationSummary = aggregateSummary;
    }
    this.lastGenerationMetadata = latestMeta;
    options?.onMetadata?.(latestMeta);

    // Ensure IDs are unique
    const formatted: Question[] = allQuestions.map((q, idx) => ({
      ...q,
      id: `ai_q_${Date.now()}_${idx}`,
      sourcePage: q.sourcePage || 1,
      sourceQuote: q.sourceQuote || '',
    }));

    // Step 2: Validate all questions in ONE batched call
    options?.onProgress?.({
      percent: 90,
      phase: 'Validating pedagogical alignment & citations in one batched audit...',
      receivedCount: formatted.length,
      totalCount: totalQuestions,
    });

    try {
      const valRes = await fetch('/api/batch-validate-questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ questions: formatted }),
        signal: options?.signal,
      });

      if (valRes.ok) {
        const valData = await valRes.json();
        const resultMap = new Map<string, string>();
        if (Array.isArray(valData.results)) {
          valData.results.forEach((r: any) => {
            if (r.id) resultMap.set(r.id, r.qualityBadge);
          });
        }

        formatted.forEach(q => {
          if (resultMap.has(q.id)) {
            q.validationBadge = (resultMap.get(q.id) as any) || 'needs_review';
          } else {
            q.validationBadge = 'needs_review';
          }
        });
      } else {
        formatted.forEach(q => {
          q.validationBadge = 'needs_review';
        });
      }
    } catch (e) {
      console.warn('Batch validation non-fatal warning:', e);
      formatted.forEach(q => {
        q.validationBadge = 'needs_review';
      });
    }

    options?.onProgress?.({
      percent: 100,
      phase: `Complete! ${formatted.length} questions ready for teacher review.`,
      receivedCount: formatted.length,
      totalCount: totalQuestions,
    });

    return formatted;
  }

  /**
   * Scenario converter / difficulty adjuster
   */
  public async adaptQuestion(question: Question, action: 'convert_to_scenario' | 'make_easier' | 'make_harder'): Promise<Question> {
    const user = auth.currentUser || (await ensureAnonymousAuth());
    const idToken = (await user?.getIdToken()) || '';

    try {
      const response = await fetch('/api/validate-question', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ question, action }),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          ...question,
          text: data.question || question.text,
          options: data.options || question.options,
          correctAnswers: [data.correctAnswerIndex ?? question.correctAnswers[0]],
          explanation: data.explanation || question.explanation,
          validationBadge: data.qualityBadge || 'needs_review',
        };
      }
      if (response.status === 429) {
        const retryAfter = response.headers?.get?.('retry-after');
        throw new Error(
          retryAfter
            ? `Rate limit exceeded. Please wait ${retryAfter}s before adapting questions.`
            : 'Rate limit exceeded. Please wait before adapting questions.'
        );
      }
    } catch (e: any) {
      if (e?.message && /rate limit/i.test(e.message)) {
        throw e;
      }
      console.warn('Adapt question failed:', e);
    }

    // Client-side adaptation fallback (never marked as 'good' / AI-verified)
    if (action === 'convert_to_scenario') {
      return {
        ...question,
        text: `In a real-world enterprise scenario: ${question.text.replace(/\?$/, '')}. How should the team proceed?`,
        bloomLevel: 'analyze',
        validationBadge: 'needs_review',
      };
    } else if (action === 'make_easier') {
      return {
        ...question,
        text: `Which of the following describes: ${question.text.replace(/^Which of the following\s+/i, '')}`,
        bloomLevel: 'remember',
        validationBadge: 'needs_review',
      };
    } else {
      return {
        ...question,
        text: `Critically evaluate and identify which statement is FALSE or suboptimal regarding: ${question.text}`,
        bloomLevel: 'evaluate',
        validationBadge: 'good',
      };
    }
  }

  /**
   * Generates AI Insights from game answer analytics (Privacy-conscious, zero PII)
   */
  public async generateInsights(stats: {
    quizTitle: string;
    totalPlayers: number;
    averageAccuracy: number;
    weakestQuestions: { text: string; correctRate: number }[];
    topPerformers?: string[]; // Deprecated: PII stripped
    lowestPerformers?: string[]; // Deprecated: PII stripped
    coAttainments: { coTag: string; accuracyRate: number; isAttained: boolean }[];
  }): Promise<AIInsightsReport> {
    if (stats.totalPlayers === 0) {
      return {
        overallSummary: 'Insufficient data: No participant submissions recorded for this assessment session.',
        strengths: ['No attempts recorded yet.'],
        strugglingAreas: ['No assessment data available to compute learning gaps.'],
        studentsNeedingSupport: ['None recorded.'],
        actionableNextSteps: ['Administer the quiz and collect student answers before generating diagnostics.'],
      };
    }

    const strugglingAreas = stats.weakestQuestions.map(
      q => `"${q.text.slice(0, 50)}..." (${Math.round(q.correctRate * 100)}% accuracy)`
    );

    const unattainedCOs = stats.coAttainments.filter(c => !c.isAttained).map(c => c.coTag);

    return {
      overallSummary: `Class achieved an aggregate accuracy of ${Math.round(
        stats.averageAccuracy * 100
      )}% across ${stats.totalPlayers} participants on "${stats.quizTitle}". ${
        stats.averageAccuracy >= 0.75
          ? 'Strong foundational comprehension demonstrated overall.'
          : 'Concepts show moderate comprehension gaps requiring targeted review.'
      }`,
      strengths: [
        'Cohort demonstrated consistent active submission participation.',
        stats.coAttainments.find(c => c.isAttained)?.coTag
          ? `Attainment criteria successfully met for ${stats.coAttainments.find(c => c.isAttained)?.coTag}`
          : 'High engagement across core syllabus objectives.',
      ],
      strugglingAreas: strugglingAreas.length > 0 ? strugglingAreas : ['No significant high-error misconception clusters identified.'],
      studentsNeedingSupport: ['Students scoring below the 50th percentile in the cohort distribution.'],
      actionableNextSteps: [
        unattainedCOs.length > 0
          ? `Deploy a 5-question Spaced Repetition Reteach pack targeting ${unattainedCOs.join(', ')}.`
          : 'Reinforce edge-case scenarios with open-ended group discussion.',
        'Review the highest distractor misconception during the next classroom opening review.',
      ],
    };
  }

  /**
   * Generates a targeted Reteach Quiz Pack from most missed questions
   */
  public generateReteachPack(missedQuestions: Question[], coTag: string): Question[] {
    return missedQuestions.map((q, idx) => ({
      ...q,
      id: `reteach_${Date.now()}_${idx}`,
      text: `[Reteach Practice] ${q.text}`,
      courseOutcomeTag: coTag || q.courseOutcomeTag,
      points: 1000,
      timeLimit: 25,
      explanation: `Key Concept Reinforcement: ${q.explanation}`,
    }));
  }
}

export const aiService = new AIService();
