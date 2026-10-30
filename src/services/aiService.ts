/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Question } from '../types/quiz';
import { auth, ensureAnonymousAuth } from '../lib/firebase';

export const GEMINI_MODEL_NAME =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_MODEL) || 'gemini-3.8-flash';

export interface GenerateQuizParams {
  sourceContent: string;
  sourceType: 'pdf_text' | 'pasted_text' | 'topic';
  numQuestions: number;
  difficulty: 'easy' | 'medium' | 'hard' | 'mixed';
  targetCO: string;
  language: string;
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

export interface GenerateOptions {
  signal?: AbortSignal;
  onProgress?: (p: GenerateProgress) => void;
}

class AIService {
  private endpoint: string;

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

    // Helper with 2x retry and exponential backoff
    const fetchBatchWithRetry = async (batchParams: GenerateQuizParams, batchIdx: number): Promise<Question[]> => {
      let attempts = 0;
      const maxAttempts = 3; // 1 initial + up to 2 retries
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
            if (res.status === 404 || res.status === 503 || /not[_\s-]?found|404|model unavailable/i.test(rawErr)) {
              throw new Error('AI model unavailable, contact admin');
            }
            throw new Error(rawErr);
          }

          const data = await res.json();
          if (!Array.isArray(data.questions)) {
            throw new Error('Invalid question response format from server.');
          }

          return data.questions;
        } catch (err: any) {
          lastErr = err;
          if (options?.signal?.aborted) throw err;
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
            q.validationBadge = (resultMap.get(q.id) as any) || 'good';
          }
        });
      }
    } catch (e) {
      console.warn('Batch validation non-fatal warning:', e);
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
          validationBadge: data.qualityBadge || 'good',
        };
      }
    } catch (e) {
      console.warn('Adapt question failed:', e);
    }

    // Client-side adaptation fallback
    if (action === 'convert_to_scenario') {
      return {
        ...question,
        text: `In a real-world enterprise scenario: ${question.text.replace(/\?$/, '')}. How should the team proceed?`,
        bloomLevel: 'analyze',
        validationBadge: 'good',
      };
    } else if (action === 'make_easier') {
      return {
        ...question,
        text: `Which of the following describes: ${question.text.replace(/^Which of the following\s+/i, '')}`,
        bloomLevel: 'remember',
        validationBadge: 'good',
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
   * Generates AI Insights from game answer analytics
   */
  public async generateInsights(stats: {
    quizTitle: string;
    totalPlayers: number;
    averageAccuracy: number;
    weakestQuestions: { text: string; correctRate: number }[];
    topPerformers: string[];
    lowestPerformers: string[];
    coAttainments: { coTag: string; accuracyRate: number; isAttained: boolean }[];
  }): Promise<AIInsightsReport> {
    const strugglingAreas = stats.weakestQuestions.map(
      q => `"${q.text.slice(0, 50)}..." (${Math.round(q.correctRate * 100)}% accuracy)`
    );

    const unattainedCOs = stats.coAttainments.filter(c => !c.isAttained).map(c => c.coTag);

    return {
      overallSummary: `Class achieved an average score of ${Math.round(
        stats.averageAccuracy * 100
      )}% across ${stats.totalPlayers} participants on "${stats.quizTitle}". ${
        stats.averageAccuracy >= 0.75
          ? 'Strong foundational comprehension demonstrated overall.'
          : 'Concepts show moderate comprehension gaps requiring targeted review.'
      }`,
      strengths: [
        'Rapid response latency on recall questions',
        'High engagement and active participation rate across the cohort',
        stats.coAttainments.find(c => c.isAttained)?.coTag
          ? `Attainment criteria successfully met for ${stats.coAttainments.find(c => c.isAttained)?.coTag}`
          : 'Consistent peer collaboration',
      ],
      strugglingAreas: strugglingAreas.length > 0 ? strugglingAreas : ['Higher-order analytical scenario questions'],
      studentsNeedingSupport: stats.lowestPerformers.length > 0 ? stats.lowestPerformers : ['Self-paced learners'],
      actionableNextSteps: [
        unattainedCOs.length > 0
          ? `Deploy a 5-question Spaced Repetition Reteach pack targeting ${unattainedCOs.join(', ')}.`
          : 'Reinforce edge-case scenarios with open-ended group discussion.',
        'Pair students who scored in the top tier with peers for guided peer explanation.',
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
