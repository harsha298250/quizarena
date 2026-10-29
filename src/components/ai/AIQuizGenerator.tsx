/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Question, Quiz } from '../../types/quiz';
import { extractTextFromPdf, PdfExtractionResult } from '../../services/pdfExtractor';
import { aiService } from '../../services/aiService';
import { SAMPLE_AI_SOURCE_TEXT } from '../../data/sampleQuizzes';
import { sound } from '../../lib/sound';

interface AIQuizGeneratorProps {
  onSaveToQuiz: (newQuiz: Quiz) => void;
  onHostNow: (quiz: Quiz) => void;
}

export const AIQuizGenerator: React.FC<AIQuizGeneratorProps> = ({ onSaveToQuiz, onHostNow }) => {
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
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generatedQuestions, setGeneratedQuestions] = useState<Question[]>([]);
  const [acceptedQuestionIds, setAcceptedQuestionIds] = useState<Set<string>>(new Set());
  const [quizTitle, setQuizTitle] = useState<string>('AI Generated Mastery Arena');
  const [activeTabFilter, setActiveTabFilter] = useState<'all' | 'easy' | 'medium' | 'hard'>('all');

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

  const handleGenerate = async () => {
    sound.playClick();
    setIsGenerating(true);
    setGenerationError(null);

    let sourceContent = '';
    let sourceType: 'pdf_text' | 'pasted_text' | 'topic' = 'pasted_text';

    if (sourceMode === 'pdf') {
      if (!pdfData || pdfData.isScannedOrEmpty) {
        setGenerationError('The uploaded PDF appears to be a scanned image with no text layer. Please switch to "Paste Text" or upload a PDF with digital text.');
        setIsGenerating(false);
        return;
      }
      sourceType = 'pdf_text';
      // Filter by selected page range
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
      return;
    }

    try {
      const questions = await aiService.generateQuestions({
        sourceContent,
        sourceType,
        numQuestions,
        difficulty,
        targetCO,
        language: targetLanguage,
      });

      setGeneratedQuestions(questions);
      // Auto-accept all initially for convenience
      setAcceptedQuestionIds(new Set(questions.map(q => q.id)));
      sound.playCorrect();
    } catch (err) {
      console.error('Generation error:', err);
      setGenerationError(err instanceof Error ? err.message : 'Question generation failed');
    } finally {
      setIsGenerating(false);
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

  // Question adaptations (make easier, harder, scenario)
  const handleAdapt = async (question: Question, action: 'convert_to_scenario' | 'make_easier' | 'make_harder') => {
    sound.playClick();
    const adapted = await aiService.adaptQuestion(question, action);
    setGeneratedQuestions(prev => prev.map(q => (q.id === question.id ? adapted : q)));
  };

  // Save reviewed quiz
  const handleSaveQuiz = (launchNow: boolean = false) => {
    const questionsToSave = generatedQuestions.filter(q => acceptedQuestionIds.has(q.id));
    if (questionsToSave.length === 0) {
      alert('Please accept at least one question before saving.');
      return;
    }
    sound.playClick();

    const newQuiz: Quiz = {
      id: `ai_quiz_${Date.now()}`,
      title: quizTitle || 'AI Assessment Quiz',
      description: `Generated from ${sourceMode} targeting ${targetCO}.`,
      authorId: 'host_active',
      authorName: 'Instructor AI',
      isPublic: true,
      gameMode: 'classic',
      tags: ['AI Generated', targetCO],
      coverColor: '#FF5A36',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      questions: questionsToSave,
    };

    onSaveToQuiz(newQuiz);
    if (launchNow) {
      onHostNow(newQuiz);
    }
  };

  const filteredQuestions = generatedQuestions.filter(q => {
    if (activeTabFilter === 'all') return true;
    if (activeTabFilter === 'easy') return q.bloomLevel === 'remember' || q.bloomLevel === 'understand';
    if (activeTabFilter === 'medium') return q.bloomLevel === 'apply';
    if (activeTabFilter === 'hard') return q.bloomLevel === 'analyze' || q.bloomLevel === 'evaluate';
    return true;
  });

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 space-y-6">
      {/* Header Banner */}
      <div className="paper-card p-6 bg-[var(--bg-page)] border-3">
        <div className="flex flex-col md:flex-row items-start md:md-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="sticker-badge bg-[var(--accent-2-bg)] text-[var(--text)] sticker-rot-1">AI Flagship</span>
              <span className="text-xs font-bold text-[var(--ok)]">Gemini 3.8 Flash Engine</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black font-['Bricolage_Grotesque'] text-[var(--text)]">
              AI Quiz Generator & Syllabus Alignment
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
            <div className="flex items-center gap-2 border-b-2 border-[var(--border)] pb-3">
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
                    <span>Extracting text from PDF pages...</span>
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

            {/* Number of Questions */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs font-bold">
                <label htmlFor="numQuestionsRange">Number of Questions</label>
                <span className="text-[var(--accent)] font-mono-code">{numQuestions}</span>
              </div>
              <input
                id="numQuestionsRange"
                type="range"
                min={3}
                max={15}
                value={numQuestions}
                onChange={e => setNumQuestions(Number(e.target.value))}
                aria-label="Number of Questions"
                className="w-full accent-[var(--accent)] cursor-pointer"
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
                <option value="easy">Easy (Recall & Definition Focus)</option>
                <option value="medium">Medium (Comprehension & Application)</option>
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

            {/* Generate Button */}
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="paper-btn paper-btn-primary w-full py-3 text-sm font-black tracking-wide shadow-[4px_4px_0px_var(--shadow)]"
            >
              {isGenerating ? 'Generating Verifiable Questions...' : '⚡ Generate Quiz Questions'}
            </button>

            {generationError && (
              <div className="p-3 bg-red-100 border-2 border-red-500 rounded-xl text-xs font-bold text-red-800 flex items-center justify-between gap-2">
                <span className="flex-1">{generationError}</span>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="paper-btn paper-btn-sm bg-white text-[var(--text)] text-xs font-bold shrink-0"
                >
                  🔄 Retry
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Teacher Review & Verification Section */}
      {generatedQuestions.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b-2 border-[var(--border)] pb-3">
            <div className="flex items-center gap-3">
              <h2 className="font-['Bricolage_Grotesque'] font-black text-xl text-[var(--text)]">
                Teacher Review & Alignment
              </h2>
              <span className="sticker-badge bg-[var(--ok)] text-white">
                {acceptedQuestionIds.size} / {generatedQuestions.length} Accepted
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button onClick={handleAcceptAll} className="paper-btn paper-btn-sm bg-[var(--surface)] text-xs">
                Accept All
              </button>
              <button onClick={handleRejectAll} className="paper-btn paper-btn-sm bg-[var(--surface)] text-xs">
                Reject All
              </button>
              <button
                onClick={() => handleSaveQuiz(false)}
                className="paper-btn paper-btn-sm bg-[var(--accent-2-bg)] text-[var(--text)] text-xs font-bold"
              >
                💾 Save to Quizzes
              </button>
              <button
                onClick={() => handleSaveQuiz(true)}
                className="paper-btn paper-btn-sm bg-[var(--accent)] text-white text-xs font-bold"
              >
                🚀 Host Live Now
              </button>
            </div>
          </div>

          {/* Generated Question Cards */}
          <div className="space-y-4">
            {filteredQuestions.map((q, idx) => {
              const isAccepted = acceptedQuestionIds.has(q.id);

              return (
                <div
                  key={q.id || idx}
                  className={`paper-card p-5 transition-all ${
                    isAccepted ? 'bg-[var(--surface)]' : 'bg-[var(--surface-2)] opacity-60'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
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
                        onClick={() => handleAdapt(q, 'convert_to_scenario')}
                        className="text-xs font-bold text-[var(--info)] hover:underline"
                        title="Elevate to realistic scenario"
                      >
                        Convert to Scenario
                      </button>
                      <button
                        onClick={() => handleAdapt(q, 'make_easier')}
                        className="text-xs font-bold text-[var(--text-muted)] hover:underline"
                      >
                        Make Easier
                      </button>
                      <button
                        onClick={() => handleAdapt(q, 'make_harder')}
                        className="text-xs font-bold text-[var(--text-muted)] hover:underline"
                      >
                        Make Harder
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
