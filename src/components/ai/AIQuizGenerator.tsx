/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Question, Quiz, BloomLevel } from '../../types/quiz';
import { extractTextFromPdf, PdfExtractionResult } from '../../services/pdfExtractor';
import { aiService, GenerateProgress, GEMINI_MODEL_NAME } from '../../services/aiService';
import { SAMPLE_AI_SOURCE_TEXT } from '../../data/sampleQuizzes';
import { sound } from '../../lib/sound';
import { validateQuestion } from '../../lib/questionValidation';
import { auth } from '../../lib/firebase';

interface AIQuizGeneratorProps {
  existingQuizzes?: Quiz[];
  onSaveToQuiz: (newQuiz: Quiz) => Promise<Quiz> | void;
  onHostNow: (quiz: Quiz) => void;
  onOpenInStudio?: (quiz: Quiz) => void;
}

export const AIQuizGenerator: React.FC<AIQuizGeneratorProps> = ({
  existingQuizzes = [],
  onSaveToQuiz,
  onHostNow,
  onOpenInStudio,
}) => {
  const [sourceMode, setSourceMode] = useState<'pdf' | 'paste' | 'topic'>('paste');
  const [pastedText, setPastedText] = useState<string>(SAMPLE_AI_SOURCE_TEXT);
  const [topicInput, setTopicInput] = useState<string>('Operating Systems Concurrency and Semaphores');
  const [pdfData, setPdfData] = useState<PdfExtractionResult | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pageRangeStart, setPageRangeStart] = useState<number>(1);
  const [pageRangeEnd, setPageRangeEnd] = useState<number>(5);
  const [isExtractingPdf, setIsExtractingPdf] = useState<boolean>(false);

  // Configuration options
  const [numQuestions, setNumQuestions] = useState<number>(5);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard' | 'mixed'>('mixed');
  const [targetCO, setTargetCO] = useState<string>('CO2');
  const [targetLanguage, setTargetLanguage] = useState<string>('en');

  // Generation & review state
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationProgress, setGenerationProgress] = useState<GenerateProgress | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generatedQuestions, setGeneratedQuestions] = useState<Question[]>([]);
  const [acceptedQuestionIds, setAcceptedQuestionIds] = useState<Set<string>>(new Set());
  const [quizTitle, setQuizTitle] = useState<string>('AI Generated Mastery Arena');
  const [activeTabFilter, setActiveTabFilter] = useState<'all' | 'easy' | 'medium' | 'hard'>('all');
  const abortControllerRef = useRef<AbortController | null>(null);

  // Studio append & edit states
  const [selectedTargetQuizId, setSelectedTargetQuizId] = useState<string>('');
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<Question | null>(null);
  const [regeneratingQuestionId, setRegeneratingQuestionId] = useState<string | null>(null);
  const [isSavingToStudio, setIsSavingToStudio] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; quiz?: Quiz; isError?: boolean } | null>(null);

  // Silent warm-up on mount to wake up the backend / Gemini endpoints
  useEffect(() => {
    aiService.warmUpServer();
  }, []);

  // Sync selected target quiz when existingQuizzes change
  useEffect(() => {
    if (existingQuizzes.length > 0 && !selectedTargetQuizId) {
      setSelectedTargetQuizId(existingQuizzes[0].id);
    }
  }, [existingQuizzes, selectedTargetQuizId]);

  // Handle PDF file drop or select
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setPdfFile(file);
      setIsExtractingPdf(true);
      setGenerationError(null);
      try {
        const result = await extractTextFromPdf(file);
        setPdfData(result);
        setPageRangeStart(1);
        setPageRangeEnd(result.numPages);
        sound.playClick();
      } catch (err) {
        console.error('PDF extraction failed:', err);
        setGenerationError('Failed to read PDF. Ensure it is a valid PDF document with text layers.');
      } finally {
        setIsExtractingPdf(false);
      }
    }
  };

  const handleCancel = () => {
    sound.playClick();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
    setGenerationProgress(null);
    setGenerationError('Question generation was cancelled by teacher.');
  };

  const handleGenerate = async () => {
    sound.playClick();
    setIsGenerating(true);
    setGenerationError(null);
    setGenerationProgress({
      percent: 5,
      phase: 'Waking server & preparing source material...',
      receivedCount: 0,
      totalCount: numQuestions,
    });

    let sourceContent = '';
    let sourceType: 'pdf_text' | 'pasted_text' | 'topic' = 'pasted_text';

    if (sourceMode === 'pdf') {
      if (!pdfData || pdfData.isScannedOrEmpty) {
        setGenerationError('The uploaded PDF appears to be a scanned image with no text layer. Please switch to "Paste Text" or upload a PDF with digital text.');
        setIsGenerating(false);
        setGenerationProgress(null);
        return;
      }
      sourceType = 'pdf_text';
      const selectedPages = pdfData.pages.filter(
        p => p.pageNumber >= pageRangeStart && p.pageNumber <= pageRangeEnd
      );
      sourceContent = selectedPages.map(p => `[Page ${p.pageNumber}]\n${p.text}`).join('\n\n');
    } else if (sourceMode === 'paste') {
      sourceType = 'pasted_text';
      sourceContent = pastedText;
    } else {
      sourceType = 'topic';
      sourceContent = `Generate comprehensive academic assessment questions on the topic: ${topicInput}`;
    }

    if (!sourceContent.trim()) {
      setGenerationError('Please provide source material (PDF, pasted text, or topic prompt) to generate questions.');
      setIsGenerating(false);
      setGenerationProgress(null);
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // 120s timeout per guidelines
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 120000);

    try {
      const questions = await aiService.generateQuestions(
        {
          sourceContent,
          sourceType,
          numQuestions,
          difficulty,
          targetCO,
          language: targetLanguage,
        },
        {
          signal: controller.signal,
          onProgress: p => setGenerationProgress(p),
        }
      );

      clearTimeout(timeoutId);
      setGeneratedQuestions(questions);
      // Auto-accept all initially for convenience
      setAcceptedQuestionIds(new Set(questions.map(q => q.id)));
      sound.playCorrect();
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error('Generation error:', err);
      if (err.name === 'AbortError' || controller.signal.aborted) {
        setGenerationError('Request timed out or was cancelled. Server may be warming up—click Retry below.');
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        if (/404|not[_\s-]?found|unavailable/i.test(msg)) {
          setGenerationError('Quiz generation is temporarily unavailable. Please try again shortly.');
        } else {
          setGenerationError(msg || 'Question generation failed. Check server connection and retry.');
        }
      }
    } finally {
      setIsGenerating(false);
      setGenerationProgress(null);
      abortControllerRef.current = null;
    }
  };

  // Toggle single question accept/reject
  const toggleAccept = (id: string) => {
    sound.playClick();
    const next = new Set(acceptedQuestionIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setAcceptedQuestionIds(next);
  };

  // Bulk actions
  const handleAcceptAll = () => {
    sound.playClick();
    setAcceptedQuestionIds(new Set(generatedQuestions.map(q => q.id)));
  };

  const handleRejectAll = () => {
    sound.playClick();
    setAcceptedQuestionIds(new Set());
  };

  // Inline question edit handlers
  const handleStartEdit = (question: Question) => {
    sound.playClick();
    setEditingQuestionId(question.id);
    setEditingDraft(JSON.parse(JSON.stringify(question)));
  };

  const handleSaveEdit = () => {
    if (!editingDraft) return;
    sound.playClick();
    setGeneratedQuestions(prev =>
      prev.map(q => (q.id === editingDraft.id ? (editingDraft as Question) : q))
    );
    setEditingQuestionId(null);
    setEditingDraft(null);
  };

  const handleCancelEdit = () => {
    sound.playClick();
    setEditingQuestionId(null);
    setEditingDraft(null);
  };

  // Single question regeneration
  const handleRegenerateQuestion = async (question: Question) => {
    sound.playClick();
    setRegeneratingQuestionId(question.id);
    try {
      const adapted = await aiService.adaptQuestion(question, 'convert_to_scenario');
      setGeneratedQuestions(prev => prev.map(q => (q.id === question.id ? adapted : q)));
      sound.playCorrect();
    } catch (err) {
      console.warn('Single question regenerate failed, trying easier adaptation:', err);
      try {
        const fallback = await aiService.adaptQuestion(question, 'make_harder');
        setGeneratedQuestions(prev => prev.map(q => (q.id === question.id ? fallback : q)));
      } catch (err2) {
        console.error('Adaptation failed:', err2);
      }
    } finally {
      setRegeneratingQuestionId(null);
    }
  };

  // Adapt question helper
  const handleAdapt = async (question: Question, action: 'convert_to_scenario' | 'make_easier' | 'make_harder') => {
    sound.playClick();
    const adapted = await aiService.adaptQuestion(question, action);
    setGeneratedQuestions(prev => prev.map(q => (q.id === question.id ? adapted : q)));
  };

  // Add to Studio as New Quiz
  const handleAddToStudioNew = async () => {
    const questionsToSave = generatedQuestions.filter(q => acceptedQuestionIds.has(q.id));
    if (questionsToSave.length === 0) {
      setToastMessage({ text: '⚠️ Please select at least one question to add to Studio.', isError: true });
      return;
    }

    const cleanTitle = quizTitle.trim() || 'AI Generated Mastery Arena';
    if (cleanTitle.length > 120) {
      setToastMessage({ text: '⚠️ Quiz title cannot exceed 120 characters.', isError: true });
      return;
    }

    // Validate questions using Phase 4 question validator
    for (let i = 0; i < questionsToSave.length; i++) {
      const q = questionsToSave[i];
      const val = validateQuestion(q);
      if (!val.valid) {
        setToastMessage({
          text: `⚠️ Question #${i + 1} validation error: ${val.errors[0]}`,
          isError: true,
        });
        return;
      }
    }

    sound.playClick();
    setIsSavingToStudio(true);

    const newQuizId = `ai_quiz_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const user = auth.currentUser;
    const authorId = user?.uid || 'guest_teacher';
    const authorName = user?.displayName || 'Instructor AI';

    const newQuiz: Quiz = {
      id: newQuizId,
      title: cleanTitle,
      description: `Generated from ${sourceMode} targeting ${targetCO}.`,
      authorId,
      authorName,
      isPublic: true,
      gameMode: 'classic',
      tags: ['AI Generated', targetCO],
      coverColor: '#FF5A36',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      questions: questionsToSave.map((q, idx) => ({
        ...q,
        id: `${newQuizId}_q_${idx + 1}`,
      })),
    };

    try {
      await onSaveToQuiz(newQuiz);
      setToastMessage({
        text: `✓ Created new quiz "${newQuiz.title}" with ${questionsToSave.length} questions. Opening in Studio...`,
        quiz: newQuiz,
      });

      if (onOpenInStudio) {
        onOpenInStudio(newQuiz);
      }
    } catch (err: any) {
      setToastMessage({
        text: `Failed to save new quiz: ${err.message || String(err)}`,
        isError: true,
      });
    } finally {
      setIsSavingToStudio(false);
    }
  };

  // Add to an Existing Quiz
  const handleAddToExistingQuiz = async () => {
    const questionsToSave = generatedQuestions.filter(q => acceptedQuestionIds.has(q.id));
    if (questionsToSave.length === 0) {
      setToastMessage({ text: '⚠️ Please select at least one question to append.', isError: true });
      return;
    }
    const targetQuiz = existingQuizzes.find(q => q.id === selectedTargetQuizId);
    if (!targetQuiz) {
      setToastMessage({ text: '⚠️ Please select an existing target quiz from the dropdown.', isError: true });
      return;
    }

    // Validate incoming questions before appending
    for (let i = 0; i < questionsToSave.length; i++) {
      const q = questionsToSave[i];
      const val = validateQuestion(q);
      if (!val.valid) {
        setToastMessage({
          text: `⚠️ Question #${i + 1} validation error: ${val.errors[0]}`,
          isError: true,
        });
        return;
      }
    }

    sound.playClick();
    setIsSavingToStudio(true);

    const stampedQuestions: Question[] = questionsToSave.map((q, idx) => ({
      ...q,
      id: `${targetQuiz.id}_q_ai_${Date.now()}_${idx + 1}_${Math.random().toString(36).substring(2, 6)}`,
    }));

    const updatedQuiz: Quiz = {
      ...targetQuiz,
      questions: [...targetQuiz.questions, ...stampedQuestions],
      updatedAt: new Date().toISOString(),
    };

    try {
      await onSaveToQuiz(updatedQuiz);
      setToastMessage({
        text: `✓ Appended ${questionsToSave.length} questions to "${targetQuiz.title}". Total: ${updatedQuiz.questions.length} questions. Opening in Studio...`,
        quiz: updatedQuiz,
      });

      if (onOpenInStudio) {
        onOpenInStudio(updatedQuiz);
      }
    } catch (err: any) {
      setToastMessage({
        text: `Failed to append questions: ${err.message || String(err)}`,
        isError: true,
      });
    } finally {
      setIsSavingToStudio(false);
    }
  };

  // Host live now
  const handleHostLiveNow = () => {
    const questionsToSave = generatedQuestions.filter(q => acceptedQuestionIds.has(q.id));
    if (questionsToSave.length === 0) {
      setToastMessage({ text: '⚠️ Please accept at least one question before launching.', isError: true });
      return;
    }
    sound.playClick();

    const user = auth.currentUser;
    const authorId = user?.uid || 'guest_teacher';
    const authorName = user?.displayName || 'Instructor AI';
    const liveQuizId = `ai_quiz_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const liveQuiz: Quiz = {
      id: liveQuizId,
      title: quizTitle.trim() || 'AI Generated Assessment Arena',
      description: `Generated from ${sourceMode} targeting ${targetCO}.`,
      authorId,
      authorName,
      isPublic: true,
      gameMode: 'classic',
      tags: ['AI Generated', targetCO],
      coverColor: '#FF5A36',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      questions: questionsToSave.map((q, idx) => ({
        ...q,
        id: `${liveQuizId}_q_${idx + 1}`,
      })),
    };

    onSaveToQuiz(liveQuiz);
    onHostNow(liveQuiz);
  };

  const filteredQuestions = generatedQuestions.filter(q => {
    if (activeTabFilter === 'all') return true;
    if (activeTabFilter === 'easy') return q.bloomLevel === 'remember' || q.bloomLevel === 'understand';
    if (activeTabFilter === 'medium') return q.bloomLevel === 'apply';
    if (activeTabFilter === 'hard') return q.bloomLevel === 'analyze' || q.bloomLevel === 'evaluate';
    return true;
  });

  const allAccepted = generatedQuestions.length > 0 && acceptedQuestionIds.size === generatedQuestions.length;

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="alert"
          aria-live="polite"
          className={`fixed top-20 right-4 z-50 p-4 rounded-xl shadow-[4px_4px_0px_var(--shadow)] flex items-center justify-between gap-4 animate-fadeIn max-w-md ${
            toastMessage.isError
              ? 'bg-red-100 dark:bg-red-950 text-red-900 dark:text-red-200 border-3 border-red-500'
              : 'bg-[var(--surface)] text-[var(--text)] border-3 border-[var(--border)]'
          }`}
        >
          <div className="text-xs font-bold">{toastMessage.text}</div>
          <div className="flex items-center gap-2 shrink-0">
            {toastMessage.quiz && onOpenInStudio && (
              <button
                onClick={() => onOpenInStudio(toastMessage.quiz!)}
                className="paper-btn paper-btn-sm paper-btn-primary text-xs shrink-0"
              >
                Open Studio →
              </button>
            )}
            <button
              onClick={() => setToastMessage(null)}
              className="text-xs font-black opacity-70 hover:opacity-100 p-1"
              aria-label="Dismiss message"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Header Banner */}
      <div className="paper-card p-6 bg-[var(--bg-page)] border-3">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="sticker-badge bg-[var(--accent-2-bg)] text-[var(--text)] sticker-rot-1">AI Flagship</span>
              <span className="text-xs font-bold text-[var(--ok)]">Gemini + Grok Dual-Engine</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black font-['Bricolage_Grotesque'] text-[var(--text)]">
              AI Quiz Generator &amp; Syllabus Alignment
            </h1>
            <p className="text-sm font-medium text-[var(--text-muted)] mt-1">
              Upload textbook PDFs, lecture notes, or research papers. Extract verifiable questions grounded in source citations.
            </p>
          </div>
        </div>
      </div>

      {/* Generator Configuration Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Source Material Selection */}
        <div className="lg:col-span-2 space-y-4">
          <div className="paper-card p-5 bg-[var(--surface)] space-y-4">
            {/* Source Tab Toggle */}
            <div className="flex flex-wrap items-center gap-2 border-b-2 border-[var(--border)] pb-3">
              <button
                onClick={() => setSourceMode('paste')}
                className={`paper-btn paper-btn-sm ${sourceMode === 'paste' ? 'paper-btn-primary' : 'bg-[var(--surface)] text-[var(--text)]'}`}
              >
                📝 Paste Text / Notes
              </button>
              <button
                onClick={() => setSourceMode('pdf')}
                className={`paper-btn paper-btn-sm ${sourceMode === 'pdf' ? 'bg-[var(--ok)] text-white' : 'bg-[var(--surface)] text-[var(--text)]'}`}
              >
                📄 Upload PDF Document
              </button>
              <button
                onClick={() => setSourceMode('topic')}
                className={`paper-btn paper-btn-sm ${sourceMode === 'topic' ? 'bg-[var(--accent-2-bg)] text-[var(--text)]' : 'bg-[var(--surface)] text-[var(--text)]'}`}
              >
                💡 Topic Prompt
              </button>
            </div>

            {/* Mode 1: PDF Upload */}
            {sourceMode === 'pdf' && (
              <div className="space-y-4">
                <div className="rounded-2xl border-3 border-dashed border-[var(--border)] p-6 text-center bg-[var(--bg-page)]">
                  <label className="cursor-pointer block space-y-2">
                    <div className="text-3xl">📂</div>
                    <div className="font-bold text-sm text-[var(--text)]">
                      {pdfFile ? pdfFile.name : 'Select or drop a Course PDF / Lecture Slide'}
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">
                      In-browser text extraction using pdfjs-dist. Zero server upload.
                    </div>
                    <input type="file" accept=".pdf" onChange={handlePdfUpload} className="hidden" />
                  </label>
                </div>

                {isExtractingPdf && (
                  <div className="flex items-center justify-center gap-2 text-sm font-bold text-[var(--accent)] animate-pulse">
                    <span>Reading PDF document pages &amp; extracting text...</span>
                  </div>
                )}

                {pdfData && (
                  <div className="p-3 bg-[var(--surface-2)] rounded-xl border-2 border-[var(--border)] space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span>Total Extracted Pages: {pdfData.numPages}</span>
                      {pdfData.isScannedOrEmpty && (
                        <span className="text-red-600">⚠️ Scanned image detected! Use paste text below.</span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-xs font-bold">
                      <span>Select Page Range:</span>
                      <input
                        type="number"
                        min={1}
                        max={pdfData.numPages}
                        value={pageRangeStart}
                        onChange={e => setPageRangeStart(Number(e.target.value))}
                        aria-label="PDF start page"
                        className="w-16 rounded border border-[var(--border)] px-1.5 py-0.5 text-center bg-[var(--surface)] text-[var(--text)]"
                      />
                      <span>to</span>
                      <input
                        type="number"
                        min={pageRangeStart}
                        max={pdfData.numPages}
                        value={pageRangeEnd}
                        onChange={e => setPageRangeEnd(Number(e.target.value))}
                        aria-label="PDF end page"
                        className="w-16 rounded border border-[var(--border)] px-1.5 py-0.5 text-center bg-[var(--surface)] text-[var(--text)]"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Mode 2: Paste Text */}
            {sourceMode === 'paste' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="pastedNotesTextarea" className="text-xs font-bold uppercase text-[var(--text)]">
                    Source Text / Lecture Notes
                  </label>
                  <button
                    onClick={() => setPastedText(SAMPLE_AI_SOURCE_TEXT)}
                    className="text-xs font-bold text-[var(--ok)] hover:underline"
                  >
                    Load Sample Cloud Computing Text
                  </button>
                </div>
                <textarea
                  id="pastedNotesTextarea"
                  rows={8}
                  value={pastedText}
                  onChange={e => setPastedText(e.target.value)}
                  className="w-full rounded-xl border-2 border-[var(--border)] p-3 text-sm font-medium bg-[var(--surface)] text-[var(--text)] shadow-[2px_2px_0px_var(--shadow)]"
                  placeholder="Paste textbook excerpts, syllabus notes, or article content here..."
                />
              </div>
            )}

            {/* Mode 3: Topic Prompt */}
            {sourceMode === 'topic' && (
              <div className="space-y-2">
                <label htmlFor="topicPromptInput" className="text-xs font-bold uppercase text-[var(--text)]">
                  Academic Subject or Topic
                </label>
                <input
                  id="topicPromptInput"
                  type="text"
                  value={topicInput}
                  onChange={e => setTopicInput(e.target.value)}
                  className="w-full rounded-xl border-2 border-[var(--border)] p-3 text-sm font-bold bg-[var(--surface)] text-[var(--text)] shadow-[2px_2px_0px_var(--shadow)]"
                  placeholder="e.g. Distributed Consensus (Raft vs Paxos), Machine Learning Regularization..."
                />
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Generation Settings & Trigger */}
        <div className="space-y-4">
          <div className="paper-card p-5 bg-[var(--surface)] space-y-4">
            <h2 className="font-['Bricolage_Grotesque'] font-black text-lg text-[var(--text)]">
              Pedagogical Parameters
            </h2>

            {/* Number of Questions (1-50) & Presets */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs font-bold">
                <label htmlFor="numQuestionsInput">Questions (1–50)</label>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-[var(--text-muted)]">Presets:</span>
                  {[5, 10, 20].map(preset => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setNumQuestions(preset)}
                      className={`px-2 py-0.5 rounded text-[11px] font-bold border transition-colors ${
                        numQuestions === preset
                          ? 'bg-[var(--accent)] text-[var(--text-on-accent)] border-[var(--border)]'
                          : 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--border)] hover:bg-[var(--surface)]'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
              <input
                id="numQuestionsInput"
                type="number"
                min={1}
                max={50}
                value={numQuestions}
                onChange={e => {
                  const val = Math.max(1, Math.min(50, Number(e.target.value) || 1));
                  setNumQuestions(val);
                }}
                aria-label="Number of Questions (1 to 50)"
                className="w-full rounded-xl border-2 border-[var(--border)] p-2 text-sm font-bold bg-[var(--surface)] text-[var(--text)] shadow-[2px_2px_0px_var(--shadow)]"
              />
            </div>

            {/* Difficulty Mapping to Bloom's */}
            <div className="space-y-1">
              <label htmlFor="difficultySelect" className="text-xs font-bold uppercase text-[var(--text)]">
                Difficulty / Bloom Profile
              </label>
              <select
                id="difficultySelect"
                value={difficulty}
                onChange={e => setDifficulty(e.target.value as any)}
                className="w-full rounded-xl border-2 border-[var(--border)] p-2 text-xs font-bold bg-[var(--surface)] text-[var(--text)] shadow-[2px_2px_0px_var(--shadow)]"
              >
                <option value="mixed">Mixed (Balanced Bloom Hierarchy)</option>
                <option value="easy">Easy (Recall &amp; Definition Focus)</option>
                <option value="medium">Medium (Comprehension &amp; Application)</option>
                <option value="hard">Hard (Analysis, Edge Cases, Misconceptions)</option>
              </select>
            </div>

            {/* Target Course Outcome */}
            <div className="space-y-1">
              <label htmlFor="targetCOInput" className="text-xs font-bold uppercase text-[var(--text)]">
                Target Course Outcome (CO)
              </label>
              <input
                id="targetCOInput"
                type="text"
                value={targetCO}
                onChange={e => setTargetCO(e.target.value)}
                className="w-full rounded-xl border-2 border-[var(--border)] p-2 text-xs font-bold bg-[var(--surface)] text-[var(--text)] shadow-[2px_2px_0px_var(--shadow)]"
                placeholder="e.g. CO1, CO2, CO3"
              />
            </div>

            {/* Language */}
            <div className="space-y-1">
              <label htmlFor="targetLanguageSelect" className="text-xs font-bold uppercase text-[var(--text)]">Language</label>
              <select
                id="targetLanguageSelect"
                value={targetLanguage}
                onChange={e => setTargetLanguage(e.target.value)}
                className="w-full rounded-xl border-2 border-[var(--border)] p-2 text-xs font-bold bg-[var(--surface)] text-[var(--text)] shadow-[2px_2px_0px_var(--shadow)]"
              >
                <option value="en">English</option>
                <option value="ta">Tamil (தமிழ்)</option>
                <option value="hi">Hindi (हिन्दी)</option>
              </select>
            </div>

            {/* Real Progress Indicator */}
            {isGenerating && generationProgress && (
              <div className="space-y-1.5 p-3 rounded-xl border-2 border-[var(--border)] bg-[var(--surface-2)] animate-fadeIn">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="truncate pr-2">{generationProgress.phase}</span>
                  <span className="font-mono-code text-[var(--accent)] font-black">{generationProgress.percent}%</span>
                </div>
                <div className="w-full bg-[var(--surface)] h-2 rounded-full border border-[var(--border)] overflow-hidden">
                  <div
                    className="bg-[var(--accent)] h-full transition-all duration-300"
                    style={{ width: `${generationProgress.percent}%` }}
                  />
                </div>
              </div>
            )}

            {/* Generate & Cancel Action Buttons */}
            <div className="flex gap-2">
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="paper-btn paper-btn-primary flex-1 py-3 text-sm font-black tracking-wide shadow-[4px_4px_0px_var(--shadow)] disabled:opacity-60"
              >
                {isGenerating ? '⚡ Generating in Batches...' : '⚡ Generate Quiz Questions'}
              </button>

              {isGenerating && (
                <button
                  type="button"
                  onClick={handleCancel}
                  className="paper-btn paper-btn-danger px-4 py-3 text-sm font-black shadow-[4px_4px_0px_var(--shadow)]"
                  title="Cancel active generation request"
                >
                  ✕ Cancel
                </button>
              )}
            </div>

            {generationError && (
              <div className="p-3 bg-red-100 dark:bg-red-950/60 border-2 border-red-500 rounded-xl text-xs font-bold text-red-800 dark:text-red-200 flex items-center justify-between gap-2 animate-fadeIn">
                <span className="flex-1">{generationError}</span>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="paper-btn paper-btn-sm bg-[var(--surface)] text-[var(--text)] text-xs font-bold shrink-0 shadow-[1px_1px_0px_var(--shadow)]"
                >
                  🔄 Retry
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Teacher Review & Alignment Section */}
      {generatedQuestions.length > 0 && (
        <div className="space-y-4">
          <div className="paper-card p-4 bg-[var(--surface)] border-2 space-y-4">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 border-b-2 border-[var(--border)] pb-3">
              <div className="flex items-center gap-3">
                <h2 className="font-['Bricolage_Grotesque'] font-black text-xl text-[var(--text)]">
                  Teacher Review &amp; Alignment
                </h2>
                <span className="sticker-badge bg-[var(--ok)] text-white">
                  {acceptedQuestionIds.size} / {generatedQuestions.length} Selected
                </span>
              </div>

              {/* Bulk actions */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={allAccepted ? handleRejectAll : handleAcceptAll}
                  className="paper-btn paper-btn-sm bg-[var(--surface-2)] text-xs font-bold"
                >
                  {allAccepted ? 'Deselect All' : 'Select All'}
                </button>
                <div className="flex items-center gap-1">
                  <span className="text-xs font-bold text-[var(--text-muted)]">Filter:</span>
                  {(['all', 'easy', 'medium', 'hard'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setActiveTabFilter(tab)}
                      className={`px-2 py-0.5 rounded text-[11px] font-bold border transition-colors ${
                        activeTabFilter === tab
                          ? 'bg-[var(--accent)] text-[var(--text-on-accent)] border-[var(--border)]'
                          : 'bg-[var(--surface)] text-[var(--text)] border-[var(--border)] hover:bg-[var(--surface-2)]'
                      }`}
                    >
                      {tab.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Quiz Title & Studio Integration Actions */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end pt-1">
              <div className="md:col-span-4 space-y-1">
                <label className="text-xs font-bold uppercase text-[var(--text-muted)]">
                  Target Quiz Title (for new quiz)
                </label>
                <input
                  type="text"
                  value={quizTitle}
                  onChange={e => setQuizTitle(e.target.value)}
                  className="w-full rounded-xl border-2 border-[var(--border)] p-2 text-xs font-bold bg-[var(--bg-page)] text-[var(--text)]"
                  placeholder="Quiz title..."
                />
              </div>

              <div className="md:col-span-8 flex flex-wrap items-center gap-2">
                {/* 1. Add to Studio as New Quiz */}
                <button
                  id="btnAddToStudioNew"
                  onClick={handleAddToStudioNew}
                  disabled={acceptedQuestionIds.size === 0 || isSavingToStudio}
                  className="paper-btn paper-btn-sm paper-btn-primary text-xs font-black flex items-center justify-center gap-1 shadow-[2px_2px_0px_var(--shadow)] disabled:opacity-50 disabled:cursor-not-allowed whitespace-normal text-center min-h-[36px]"
                  title={acceptedQuestionIds.size === 0 ? 'Select at least one question to add to Studio' : undefined}
                >
                  {isSavingToStudio
                    ? '⏳ Saving...'
                    : `🎨 Add ${acceptedQuestionIds.size} Question${acceptedQuestionIds.size === 1 ? '' : 's'} to Studio (New Quiz)`}
                </button>

                {/* 2. Add to an Existing Quiz */}
                {existingQuizzes.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      id="selectTargetQuiz"
                      value={selectedTargetQuizId}
                      onChange={e => setSelectedTargetQuizId(e.target.value)}
                      disabled={isSavingToStudio}
                      className="rounded-lg border-2 border-[var(--border)] p-1.5 text-xs font-bold bg-[var(--bg-page)] text-[var(--text)] max-w-[180px] truncate disabled:opacity-50"
                      aria-label="Select existing quiz to append questions"
                    >
                      {existingQuizzes.map(q => (
                        <option key={q.id} value={q.id}>
                          {q.title} ({q.questions.length}Q)
                        </option>
                      ))}
                    </select>
                    <button
                      id="btnAppendToExistingQuiz"
                      onClick={handleAddToExistingQuiz}
                      disabled={acceptedQuestionIds.size === 0 || !selectedTargetQuizId || isSavingToStudio}
                      className="paper-btn paper-btn-sm bg-[var(--accent-2-bg)] text-[var(--text)] text-xs font-black shadow-[2px_2px_0px_var(--shadow)] disabled:opacity-50 disabled:cursor-not-allowed whitespace-normal text-center min-h-[36px]"
                      title={acceptedQuestionIds.size === 0 ? 'Select at least one question to append' : undefined}
                    >
                      {isSavingToStudio
                        ? '⏳ Appending...'
                        : `➕ Append ${acceptedQuestionIds.size} Question${acceptedQuestionIds.size === 1 ? '' : 's'}`}
                    </button>
                  </div>
                )}

                {/* 3. Host Now */}
                <button
                  id="btnHostLiveNow"
                  onClick={handleHostLiveNow}
                  disabled={acceptedQuestionIds.size === 0 || isSavingToStudio}
                  className="paper-btn paper-btn-sm bg-[var(--ok)] text-white text-xs font-black shadow-[2px_2px_0px_var(--shadow)] disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap min-h-[36px]"
                >
                  🚀 Host Now ({acceptedQuestionIds.size})
                </button>
              </div>
            </div>
          </div>

          {/* Generated Question Cards List */}
          <div className="space-y-4">
            {filteredQuestions.map((q, idx) => {
              const isAccepted = acceptedQuestionIds.has(q.id);
              const isEditing = editingQuestionId === q.id;
              const isRegenerating = regeneratingQuestionId === q.id;

              if (isEditing && editingDraft) {
                return (
                  <div key={q.id} className="paper-card p-5 bg-[var(--surface)] border-3 border-[var(--accent)] space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="font-['Bricolage_Grotesque'] font-black text-sm text-[var(--accent)]">
                        Editing Question Q{idx + 1}
                      </span>
                      <div className="flex items-center gap-2">
                        <button onClick={handleSaveEdit} className="paper-btn paper-btn-sm paper-btn-ok text-xs">
                          ✓ Save Changes
                        </button>
                        <button onClick={handleCancelEdit} className="paper-btn paper-btn-sm paper-btn-secondary text-xs">
                          Cancel
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase text-[var(--text-muted)]">Question Text</label>
                      <textarea
                        rows={2}
                        value={editingDraft.text}
                        onChange={e => setEditingDraft({ ...editingDraft, text: e.target.value })}
                        className="w-full rounded-xl border-2 border-[var(--border)] p-2 text-xs font-bold bg-[var(--bg-page)] text-[var(--text)]"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase text-[var(--text-muted)]">Options &amp; Correct Answer</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {editingDraft.options.map((opt, optIdx) => {
                          const isCorrect = editingDraft.correctAnswers.includes(optIdx);
                          return (
                            <div key={optIdx} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={isCorrect}
                                onChange={e => {
                                  const next = e.target.checked
                                    ? [...editingDraft.correctAnswers, optIdx]
                                    : editingDraft.correctAnswers.filter(i => i !== optIdx);
                                  setEditingDraft({ ...editingDraft, correctAnswers: next });
                                }}
                                title="Mark option as correct"
                                className="h-4 w-4 rounded accent-[var(--ok)]"
                              />
                              <input
                                type="text"
                                value={opt}
                                onChange={e => {
                                  const newOpts = [...editingDraft.options];
                                  newOpts[optIdx] = e.target.value;
                                  setEditingDraft({ ...editingDraft, options: newOpts });
                                }}
                                className="flex-1 rounded-lg border border-[var(--border)] p-1.5 text-xs bg-[var(--bg-page)] text-[var(--text)]"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs font-bold uppercase text-[var(--text-muted)]">Bloom Level</label>
                        <select
                          value={editingDraft.bloomLevel}
                          onChange={e => setEditingDraft({ ...editingDraft, bloomLevel: e.target.value as BloomLevel })}
                          className="w-full rounded-lg border border-[var(--border)] p-1.5 text-xs bg-[var(--bg-page)] text-[var(--text)] font-bold"
                        >
                          <option value="remember">Remember</option>
                          <option value="understand">Understand</option>
                          <option value="apply">Apply</option>
                          <option value="analyze">Analyze</option>
                          <option value="evaluate">Evaluate</option>
                          <option value="create">Create</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-bold uppercase text-[var(--text-muted)]">Course Outcome</label>
                        <input
                          type="text"
                          value={editingDraft.courseOutcomeTag}
                          onChange={e => setEditingDraft({ ...editingDraft, courseOutcomeTag: e.target.value })}
                          className="w-full rounded-lg border border-[var(--border)] p-1.5 text-xs bg-[var(--bg-page)] text-[var(--text)] font-bold"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold uppercase text-[var(--text-muted)]">Source Page</label>
                        <input
                          type="number"
                          value={editingDraft.sourcePage || 1}
                          onChange={e => setEditingDraft({ ...editingDraft, sourcePage: Number(e.target.value) })}
                          className="w-full rounded-lg border border-[var(--border)] p-1.5 text-xs bg-[var(--bg-page)] text-[var(--text)] font-bold"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold uppercase text-[var(--text-muted)]">Pedagogical Explanation</label>
                      <input
                        type="text"
                        value={editingDraft.explanation}
                        onChange={e => setEditingDraft({ ...editingDraft, explanation: e.target.value })}
                        className="w-full rounded-lg border border-[var(--border)] p-1.5 text-xs bg-[var(--bg-page)] text-[var(--text)]"
                      />
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={q.id || idx}
                  className={`paper-card p-5 transition-all ${
                    isAccepted ? 'bg-[var(--surface)]' : 'bg-[var(--surface-2)] opacity-60'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isAccepted}
                        onChange={() => toggleAccept(q.id)}
                        className="h-4 w-4 rounded accent-[var(--accent)]"
                        title="Include question in quiz"
                      />
                      <span className="font-['Bricolage_Grotesque'] font-black text-base text-[var(--accent)]">
                        Q{idx + 1}
                      </span>
                      <span className="sticker-badge bg-[var(--accent-2-bg)] text-[var(--text)] text-[10px] py-0.5">
                        Bloom: {q.bloomLevel}
                      </span>
                      <span className="sticker-badge bg-[var(--ok)] text-white text-[10px] py-0.5">
                        {q.courseOutcomeTag || targetCO}
                      </span>
                      {q.validationBadge === 'good' && (
                        <span className="sticker-badge bg-green-100 text-green-800 border-green-800 text-[10px]">
                          ✓ Grounded Citation
                        </span>
                      )}
                    </div>

                    {/* Teacher Action Buttons */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleStartEdit(q)}
                        className="text-xs font-bold text-[var(--accent)] hover:underline"
                        title="Edit question text and options"
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => handleRegenerateQuestion(q)}
                        disabled={isRegenerating}
                        className="text-xs font-bold text-[var(--info)] hover:underline disabled:opacity-50"
                        title="Regenerate this question"
                      >
                        {isRegenerating ? '⏳ Regenerating...' : '🔄 Regenerate'}
                      </button>
                      <button
                        onClick={() => handleAdapt(q, 'convert_to_scenario')}
                        className="text-xs font-bold text-[var(--text-muted)] hover:underline"
                        title="Elevate to realistic scenario"
                      >
                        Scenario
                      </button>
                      <button
                        onClick={() => toggleAccept(q.id)}
                        className={`paper-btn paper-btn-sm text-xs font-bold ${
                          isAccepted ? 'bg-[var(--ok)] text-white' : 'bg-[var(--surface-2)] text-[var(--text-muted)]'
                        }`}
                      >
                        {isAccepted ? '✓ Accepted' : '✗ Rejected'}
                      </button>
                    </div>
                  </div>

                  {/* Question Prompt */}
                  <h3 className="font-bold text-base text-[var(--text)] mb-3">
                    {q.text}
                  </h3>

                  {/* Options List */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                    {q.options.map((opt, optIdx) => {
                      const isCorrect = q.correctAnswers.includes(optIdx);
                      return (
                        <div
                          key={optIdx}
                          className={`p-2 rounded-lg border-2 border-[var(--border)] text-xs font-semibold flex items-center justify-between ${
                            isCorrect ? 'bg-[var(--surface-2)] font-bold text-[var(--ok)]' : 'bg-[var(--surface)] text-[var(--text)]'
                          }`}
                        >
                          <span>{opt}</span>
                          {isCorrect && <span className="text-[var(--ok)] font-black">✓ Correct</span>}
                        </div>
                      );
                    })}
                  </div>

                  {/* Source Quote Citation & Explanation */}
                  <div className="bg-[var(--bg-page)] p-3 rounded-xl border border-[var(--border)] text-xs space-y-1">
                    {q.sourceQuote && (
                      <p className="text-[var(--text-muted)] italic">
                        <strong>Source Citation [Page {q.sourcePage || 1}]:</strong> "{q.sourceQuote}"
                      </p>
                    )}
                    <p className="text-[var(--text)]">
                      <strong>Pedagogical Explanation:</strong> {q.explanation}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
