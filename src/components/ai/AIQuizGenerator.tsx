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
      <div className="paper-card p-6 bg-[#FFF6E5] dark:bg-[#16120E] border-3">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="sticker-badge bg-[#FFC83D] text-[#16120E] sticker-rot-1">AI Flagship</span>
              <span className="text-xs font-bold text-[#14B8A6]">Gemini 3.8 Flash Engine</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black font-['Bricolage_Grotesque'] text-[#16120E] dark:text-[#FFF6E5]">
              AI Quiz Generator & Syllabus Alignment
            </h1>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-1">
              Upload textbook PDFs, lecture notes, or research papers. Extract verifiable questions grounded in source citations.
            </p>
          </div>
        </div>
      </div>

      {/* Generator Configuration Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Source Material Selection */}
        <div className="lg:col-span-2 space-y-4">
          <div className="paper-card p-5 bg-white dark:bg-[#221c16] space-y-4">
            {/* Source Tab Toggle */}
            <div className="flex items-center gap-2 border-b-2 border-gray-200 pb-3">
              <button
                onClick={() => setSourceMode('paste')}
                className={`paper-btn paper-btn-sm ${sourceMode === 'paste' ? 'bg-[#FF5A36] text-white' : 'bg-white dark:bg-[#16120E] dark:text-white'}`}
              >
                📝 Paste Text / Notes
              </button>
              <button
                onClick={() => setSourceMode('pdf')}
                className={`paper-btn paper-btn-sm ${sourceMode === 'pdf' ? 'bg-[#14B8A6] text-white' : 'bg-white dark:bg-[#16120E] dark:text-white'}`}
              >
                📄 Upload PDF Document
              </button>
              <button
                onClick={() => setSourceMode('topic')}
                className={`paper-btn paper-btn-sm ${sourceMode === 'topic' ? 'bg-[#FFC83D] text-[#16120E]' : 'bg-white dark:bg-[#16120E] dark:text-white'}`}
              >
                💡 Topic Prompt
              </button>
            </div>

            {/* Mode 1: PDF Upload */}
            {sourceMode === 'pdf' && (
              <div className="space-y-4">
                <div className="rounded-2xl border-3 border-dashed border-[#16120E] dark:border-gray-500 p-6 text-center bg-[#FFF6E5] dark:bg-[#16120E]">
                  <label className="cursor-pointer block space-y-2">
                    <div className="text-3xl">📂</div>
                    <div className="font-bold text-sm text-[#16120E] dark:text-white">
                      {pdfFile ? pdfFile.name : 'Select or drop a Course PDF / Lecture Slide'}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      In-browser text extraction using pdfjs-dist. Zero server upload.
                    </div>
                    <input type="file" accept=".pdf" onChange={handlePdfUpload} className="hidden" />
                  </label>
                </div>

                {isExtractingPdf && (
                  <div className="flex items-center justify-center gap-2 text-sm font-bold text-[#FF5A36] animate-pulse">
                    <span>Extracting text from PDF pages...</span>
                  </div>
                )}

                {pdfData && (
                  <div className="p-3 bg-[#FFFAEE] rounded-xl border-2 border-[#16120E] space-y-2">
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
                        className="w-16 rounded border border-[#16120E] px-1.5 py-0.5 text-center"
                      />
                      <span>to</span>
                      <input
                        type="number"
                        min={pageRangeStart}
                        max={pdfData.numPages}
                        value={pageRangeEnd}
                        onChange={e => setPageRangeEnd(Number(e.target.value))}
                        className="w-16 rounded border border-[#16120E] px-1.5 py-0.5 text-center"
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
                  <label className="text-xs font-bold uppercase text-[#16120E] dark:text-white">
                    Source Text / Lecture Notes
                  </label>
                  <button
                    onClick={() => setPastedText(SAMPLE_AI_SOURCE_TEXT)}
                    className="text-xs font-bold text-[#14B8A6] hover:underline"
                  >
                    Load Sample Cloud Computing Text
                  </button>
                </div>
                <textarea
                  rows={8}
                  value={pastedText}
                  onChange={e => setPastedText(e.target.value)}
                  className="w-full rounded-xl border-2 border-[#16120E] p-3 text-sm font-medium dark:bg-[#16120E] dark:text-white shadow-[2px_2px_0px_#16120E]"
                  placeholder="Paste textbook excerpts, syllabus notes, or article content here..."
                />
              </div>
            )}

            {/* Mode 3: Topic Prompt */}
            {sourceMode === 'topic' && (
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-[#16120E] dark:text-white">
                  Academic Subject or Topic
                </label>
                <input
                  type="text"
                  value={topicInput}
                  onChange={e => setTopicInput(e.target.value)}
                  className="w-full rounded-xl border-2 border-[#16120E] p-3 text-sm font-bold dark:bg-[#16120E] dark:text-white shadow-[2px_2px_0px_#16120E]"
                  placeholder="e.g. Distributed Consensus (Raft vs Paxos), Machine Learning Regularization..."
                />
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Generation Settings & Trigger */}
        <div className="space-y-4">
          <div className="paper-card p-5 bg-white dark:bg-[#221c16] space-y-4">
            <h3 className="font-['Bricolage_Grotesque'] font-black text-lg text-[#16120E] dark:text-white">
              Pedagogical Parameters
            </h3>

            {/* Number of Questions */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs font-bold">
                <span>Number of Questions</span>
                <span className="text-[#FF5A36] font-mono-code">{numQuestions}</span>
              </div>
              <input
                type="range"
                min={3}
                max={15}
                value={numQuestions}
                onChange={e => setNumQuestions(Number(e.target.value))}
                className="w-full accent-[#FF5A36] cursor-pointer"
              />
            </div>

            {/* Difficulty Mapping to Bloom's */}
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-[#16120E] dark:text-white">
                Difficulty / Bloom Profile
              </label>
              <select
                value={difficulty}
                onChange={e => setDifficulty(e.target.value as any)}
                className="w-full rounded-xl border-2 border-[#16120E] p-2 text-xs font-bold dark:bg-[#16120E] dark:text-white shadow-[2px_2px_0px_#16120E]"
              >
                <option value="mixed">Mixed (Balanced Bloom Hierarchy)</option>
                <option value="easy">Easy (Recall & Definition Focus)</option>
                <option value="medium">Medium (Comprehension & Application)</option>
                <option value="hard">Hard (Analysis, Edge Cases, Misconceptions)</option>
              </select>
            </div>

            {/* Target Course Outcome */}
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-[#16120E] dark:text-white">
                Target Course Outcome (CO)
              </label>
              <input
                type="text"
                value={targetCO}
                onChange={e => setTargetCO(e.target.value)}
                className="w-full rounded-xl border-2 border-[#16120E] p-2 text-xs font-bold dark:bg-[#16120E] dark:text-white shadow-[2px_2px_0px_#16120E]"
                placeholder="e.g. CO1, CO2, CO3"
              />
            </div>

            {/* Language */}
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-[#16120E] dark:text-white">Language</label>
              <select
                value={targetLanguage}
                onChange={e => setTargetLanguage(e.target.value)}
                className="w-full rounded-xl border-2 border-[#16120E] p-2 text-xs font-bold dark:bg-[#16120E] dark:text-white shadow-[2px_2px_0px_#16120E]"
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
              className="paper-btn w-full bg-[#FF5A36] text-white py-3 text-sm font-black tracking-wide shadow-[4px_4px_0px_#16120E]"
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
                  className="paper-btn paper-btn-sm bg-white text-[#16120E] text-xs font-bold shrink-0"
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
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b-2 border-[#16120E] pb-3">
            <div className="flex items-center gap-3">
              <h2 className="font-['Bricolage_Grotesque'] font-black text-xl text-[#16120E] dark:text-white">
                Teacher Review & Alignment
              </h2>
              <span className="sticker-badge bg-[#14B8A6] text-white">
                {acceptedQuestionIds.size} / {generatedQuestions.length} Accepted
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button onClick={handleAcceptAll} className="paper-btn paper-btn-sm bg-white dark:bg-[#221c16] text-xs">
                Accept All
              </button>
              <button onClick={handleRejectAll} className="paper-btn paper-btn-sm bg-white dark:bg-[#221c16] text-xs">
                Reject All
              </button>
              <button
                onClick={() => handleSaveQuiz(false)}
                className="paper-btn paper-btn-sm bg-[#FFC83D] text-[#16120E] text-xs font-bold"
              >
                💾 Save to Quizzes
              </button>
              <button
                onClick={() => handleSaveQuiz(true)}
                className="paper-btn paper-btn-sm bg-[#FF5A36] text-white text-xs font-bold"
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
                    isAccepted ? 'bg-white dark:bg-[#221c16]' : 'bg-gray-100 dark:bg-gray-800 opacity-60'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-['Bricolage_Grotesque'] font-black text-base text-[#FF5A36]">
                        Q{idx + 1}
                      </span>
                      <span className="sticker-badge bg-[#FFC83D] text-[#16120E] text-[10px] py-0.5">
                        Bloom: {q.bloomLevel}
                      </span>
                      <span className="sticker-badge bg-[#14B8A6] text-white text-[10px] py-0.5">
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
                        className="text-xs font-bold text-[#4DA3FF] hover:underline"
                        title="Elevate to realistic scenario"
                      >
                        Convert to Scenario
                      </button>
                      <button
                        onClick={() => handleAdapt(q, 'make_easier')}
                        className="text-xs font-bold text-gray-500 hover:underline"
                      >
                        Make Easier
                      </button>
                      <button
                        onClick={() => handleAdapt(q, 'make_harder')}
                        className="text-xs font-bold text-gray-500 hover:underline"
                      >
                        Make Harder
                      </button>
                      <button
                        onClick={() => toggleAccept(q.id)}
                        className={`paper-btn paper-btn-sm text-xs font-bold ${
                          isAccepted ? 'bg-[#14B8A6] text-white' : 'bg-gray-300 text-gray-700'
                        }`}
                      >
                        {isAccepted ? '✓ Accepted' : '✗ Rejected'}
                      </button>
                    </div>
                  </div>

                  {/* Question Prompt */}
                  <h3 className="font-bold text-base text-[#16120E] dark:text-white mb-3">
                    {q.text}
                  </h3>

                  {/* Options List */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                    {q.options.map((opt, optIdx) => {
                      const isCorrect = q.correctAnswers.includes(optIdx);
                      return (
                        <div
                          key={optIdx}
                          className={`p-2 rounded-lg border-2 border-[#16120E] text-xs font-semibold flex items-center justify-between ${
                            isCorrect ? 'bg-[#FFFAEE] font-bold text-[#14B8A6]' : 'bg-white dark:bg-[#16120E] dark:text-gray-300'
                          }`}
                        >
                          <span>{opt}</span>
                          {isCorrect && <span className="text-[#14B8A6] font-black">✓ Correct</span>}
                        </div>
                      );
                    })}
                  </div>

                  {/* Source Quote Citation & Explanation */}
                  <div className="bg-[#FFF6E5] dark:bg-[#16120E] p-3 rounded-xl border border-[#16120E] text-xs space-y-1">
                    {q.sourceQuote && (
                      <p className="text-gray-600 dark:text-gray-400 italic">
                        <strong>Source Citation [Page {q.sourcePage || 1}]:</strong> "{q.sourceQuote}"
                      </p>
                    )}
                    <p className="text-[#16120E] dark:text-gray-200">
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
