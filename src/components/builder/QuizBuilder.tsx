/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Quiz, Question, QuestionType, BloomLevel } from '../../types/quiz';
import { SAMPLE_QUIZZES } from '../../data/sampleQuizzes';
import { sound } from '../../lib/sound';
import { ShapeTriangle, ShapeDiamond, ShapeCircle, ShapeSquare } from '../common/CustomIcons';

interface QuizBuilderProps {
  quizzes: Quiz[];
  onSaveQuiz: (quiz: Quiz) => void;
  onSelectForHost: (quiz: Quiz) => void;
  onDeleteQuiz?: (quizId: string) => void;
}

export const QuizBuilder: React.FC<QuizBuilderProps> = ({ quizzes, onSaveQuiz, onSelectForHost, onDeleteQuiz }) => {
  const [selectedQuiz, setSelectedQuiz] = useState<Quiz>(quizzes[0] || SAMPLE_QUIZZES[0]);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState<number>(0);
  const [previewMode, setPreviewMode] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const activeQuestion: Question | undefined = selectedQuiz.questions[activeQuestionIndex];

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleCreateNewQuiz = () => {
    sound.playClick();
    const newQuiz: Quiz = {
      id: `quiz_${Date.now()}`,
      title: 'Untitled Interactive Arena Quiz',
      description: 'Engage students with live multiplayer competition.',
      authorId: 'user_active',
      authorName: 'Host Teacher',
      isPublic: false,
      gameMode: 'classic',
      tags: ['General', 'Assessment'],
      coverColor: '#FF5A36',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      questions: [
        {
          id: `q_${Date.now()}_1`,
          type: 'multiple_choice',
          text: 'What is the primary capital city of Australia?',
          options: ['Canberra', 'Sydney', 'Melbourne', 'Brisbane'],
          correctAnswers: [0],
          explanation: 'Canberra was chosen as the compromise capital city between rivals Sydney and Melbourne in 1908.',
          timeLimit: 20,
          points: 1000,
          topicTag: 'Geography',
          bloomLevel: 'remember',
          courseOutcomeTag: 'CO1',
        },
      ],
    };
    setSelectedQuiz(newQuiz);
    setActiveQuestionIndex(0);
    onSaveQuiz(newQuiz);
    showToast('New Quiz created!');
  };

  const handleUpdateQuizMeta = (field: keyof Quiz, value: any) => {
    const updated = { ...selectedQuiz, [field]: value, updatedAt: new Date().toISOString() };
    setSelectedQuiz(updated);
    onSaveQuiz(updated);
  };

  const handleUpdateQuestion = (field: keyof Question, value: any) => {
    if (!activeQuestion) return;
    const updatedQuestions = [...selectedQuiz.questions];
    updatedQuestions[activeQuestionIndex] = {
      ...activeQuestion,
      [field]: value,
    };
    const updatedQuiz = {
      ...selectedQuiz,
      questions: updatedQuestions,
      updatedAt: new Date().toISOString(),
    };
    setSelectedQuiz(updatedQuiz);
    onSaveQuiz(updatedQuiz);
  };

  const handleAddQuestion = (type: QuestionType = 'multiple_choice') => {
    sound.playClick();
    const newQuestion: Question = {
      id: `q_${Date.now()}_${selectedQuiz.questions.length + 1}`,
      type,
      text: type === 'true_false' ? 'True or False: ...' : 'New engaging question prompt...',
      options: type === 'true_false' ? ['True', 'False'] : ['Option A', 'Option B', 'Option C', 'Option D'],
      correctAnswers: [0],
      acceptedTextAnswers: ['answer'],
      explanation: 'Explanation for students during reveal...',
      timeLimit: 20,
      points: 1000,
      topicTag: 'Topic 1',
      bloomLevel: 'understand',
      courseOutcomeTag: 'CO1',
    };
    const updatedQuestions = [...selectedQuiz.questions, newQuestion];
    const updatedQuiz = { ...selectedQuiz, questions: updatedQuestions };
    setSelectedQuiz(updatedQuiz);
    setActiveQuestionIndex(updatedQuestions.length - 1);
    onSaveQuiz(updatedQuiz);
    showToast('Question added!');
  };

  const handleDuplicateQuestion = () => {
    if (!activeQuestion) return;
    sound.playClick();
    const dupQuestion: Question = {
      ...activeQuestion,
      id: `q_${Date.now()}_dup`,
      text: `${activeQuestion.text} (Copy)`,
    };
    const updated = [...selectedQuiz.questions];
    updated.splice(activeQuestionIndex + 1, 0, dupQuestion);
    const updatedQuiz = { ...selectedQuiz, questions: updated };
    setSelectedQuiz(updatedQuiz);
    setActiveQuestionIndex(activeQuestionIndex + 1);
    onSaveQuiz(updatedQuiz);
    showToast('Question duplicated!');
  };

  const handleDeleteQuestion = () => {
    if (selectedQuiz.questions.length <= 1) {
      showToast('A quiz must have at least one question.');
      return;
    }
    sound.playClick();
    const updated = selectedQuiz.questions.filter((_, idx) => idx !== activeQuestionIndex);
    const newIdx = Math.max(0, activeQuestionIndex - 1);
    const updatedQuiz = { ...selectedQuiz, questions: updated };
    setSelectedQuiz(updatedQuiz);
    setActiveQuestionIndex(newIdx);
    onSaveQuiz(updatedQuiz);
    showToast('Question deleted.');
  };

  const handleMoveQuestion = (direction: 'up' | 'down') => {
    sound.playClick();
    const targetIdx = direction === 'up' ? activeQuestionIndex - 1 : activeQuestionIndex + 1;
    if (targetIdx < 0 || targetIdx >= selectedQuiz.questions.length) return;
    const questions = [...selectedQuiz.questions];
    const temp = questions[activeQuestionIndex];
    questions[activeQuestionIndex] = questions[targetIdx];
    questions[targetIdx] = temp;
    const updatedQuiz = { ...selectedQuiz, questions };
    setSelectedQuiz(updatedQuiz);
    setActiveQuestionIndex(targetIdx);
    onSaveQuiz(updatedQuiz);
  };

  // Import / Export JSON
  const handleExportJson = () => {
    sound.playClick();
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(selectedQuiz, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute('href', dataStr);
    dlAnchorElem.setAttribute('download', `${selectedQuiz.title.replace(/\s+/g, '_')}.json`);
    dlAnchorElem.click();
    showToast('Quiz exported to JSON!');
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader();
    if (e.target.files && e.target.files[0]) {
      fileReader.readAsText(e.target.files[0], 'UTF-8');
      fileReader.onload = event => {
        try {
          const parsed = JSON.parse(event.target?.result as string);
          if (parsed && parsed.title && Array.isArray(parsed.questions)) {
            parsed.id = `imported_${Date.now()}`;
            setSelectedQuiz(parsed);
            setActiveQuestionIndex(0);
            onSaveQuiz(parsed);
            showToast('Quiz imported successfully!');
          } else {
            showToast('Invalid Quiz JSON format.');
          }
        } catch (err) {
          showToast('Could not parse JSON file.');
        }
      };
    }
  };

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 space-y-6">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed top-16 right-6 z-50 rounded-xl border-2 border-[var(--border)] bg-[var(--accent-2-bg)] px-4 py-2 font-bold text-[var(--text-on-accent-2)] shadow-[3px_3px_0px_var(--shadow)] animate-bounce">
          {toastMessage}
        </div>
      )}

      {/* Studio Header */}
      <div className="paper-card p-5 sm:p-6 bg-[var(--bg-page)] border-3 shadow-[4px_4px_0px_var(--shadow)] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="sticker-badge sticker-badge-sunshine text-xs">Authoring Studio</span>
            <span className="text-xs font-bold text-[var(--ok)]">7 Question Types Supported</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black font-['Bricolage_Grotesque'] text-[var(--text)]">
            Quiz Studio & Assessment Builder
          </h1>
          <p className="text-xs font-semibold text-[var(--text-muted)] mt-1">
            Design interactive questions, Bloom's levels, Course Outcomes, and export to JSON.
          </p>
        </div>
      </div>

      {/* Top Bar: Selector, Actions, Host Button */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b-2 border-[var(--border)] pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="activeQuizSelect" className="text-xs font-black uppercase text-[var(--text)]">Active Quiz:</label>
          <select
            id="activeQuizSelect"
            aria-label="Active Quiz"
            value={selectedQuiz.id}
            onChange={e => {
              const q = quizzes.find(item => item.id === e.target.value) || SAMPLE_QUIZZES[0];
              setSelectedQuiz(q);
              setActiveQuestionIndex(0);
            }}
            className="rounded-xl border-2 border-[var(--border)] bg-[var(--surface)] text-[var(--text)] px-3 py-1.5 font-bold text-sm shadow-[2px_2px_0px_var(--shadow)] cursor-pointer"
          >
            {quizzes.map(q => (
              <option key={q.id} value={q.id}>
                {q.title} ({q.questions.length} Qs)
              </option>
            ))}
          </select>

          <button onClick={handleCreateNewQuiz} className="paper-btn paper-btn-sm paper-btn-secondary">
            + New Quiz
          </button>

          {onDeleteQuiz && quizzes.length > 1 && (
            <button
              onClick={() => {
                onDeleteQuiz(selectedQuiz.id);
                const remaining = quizzes.filter(q => q.id !== selectedQuiz.id);
                if (remaining.length > 0) {
                  setSelectedQuiz(remaining[0]);
                  setActiveQuestionIndex(0);
                }
              }}
              className="paper-btn paper-btn-sm paper-btn-danger"
              title="Delete this quiz"
            >
              🗑️ Delete Quiz
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* JSON Export/Import */}
          <button onClick={handleExportJson} className="paper-btn paper-btn-sm">
            Export JSON
          </button>
          <label className="paper-btn paper-btn-sm cursor-pointer">
            Import JSON
            <input type="file" accept=".json" onChange={handleImportJson} className="hidden" />
          </label>

          <button
            onClick={() => setPreviewMode(!previewMode)}
            className={`paper-btn paper-btn-sm ${previewMode ? 'paper-btn-ok' : ''}`}
          >
            {previewMode ? 'Exit Preview' : '👁️ Preview'}
          </button>

          <button
            onClick={() => {
              sound.playClick();
              onSelectForHost(selectedQuiz);
            }}
            className="paper-btn paper-btn-sm paper-btn-primary font-extrabold px-4"
          >
            🚀 Host Live Now
          </button>
        </div>
      </div>

      {/* Quiz Metadata Editor */}
      <div className="paper-card p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 space-y-1">
            <label htmlFor="quizTitleInput" className="text-xs font-bold uppercase text-[var(--text)]">Quiz Title</label>
            <input
              id="quizTitleInput"
              type="text"
              value={selectedQuiz.title}
              onChange={e => handleUpdateQuizMeta('title', e.target.value)}
              className="paper-input w-full rounded-xl border-2 border-[var(--border)] px-3 py-2 font-bold text-lg shadow-[2px_2px_0px_var(--shadow)]"
              placeholder="e.g. Physics Midterm Battle..."
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="defaultGameModeSelect" className="text-xs font-bold uppercase text-[var(--text)]">Default Game Mode</label>
            <select
              id="defaultGameModeSelect"
              aria-label="Default Game Mode"
              value={selectedQuiz.gameMode}
              onChange={e => handleUpdateQuizMeta('gameMode', e.target.value)}
              className="paper-select w-full rounded-xl border-2 border-[var(--border)] px-3 py-2 font-bold text-sm shadow-[2px_2px_0px_var(--shadow)]"
            >
              <option value="classic">Classic (Speed + Accuracy)</option>
              <option value="accuracy">Accuracy Only (No Speed Clock)</option>
              <option value="team">Team Mode</option>
              <option value="survival">Survival Elimination</option>
              <option value="async_challenge">Async Student Challenge</option>
              <option value="solo_practice">Solo Spaced Repetition</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-xs font-bold uppercase text-[var(--text)]">Description</label>
          <input
            type="text"
            value={selectedQuiz.description}
            onChange={e => handleUpdateQuizMeta('description', e.target.value)}
            className="paper-input w-full rounded-xl border-2 border-[var(--border)] px-3 py-1.5 text-sm shadow-[2px_2px_0px_var(--shadow)]"
            placeholder="Brief instructions or summary for participants..."
          />
        </div>
      </div>

      {/* Main Builder Grid: Left question rail + Right question editor */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left: Questions Navigator Rail */}
        <div className="lg:col-span-1 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-[var(--text)]">
              Questions ({selectedQuiz.questions.length})
            </span>
            <div className="flex gap-1">
              <button
                disabled={activeQuestionIndex === 0}
                onClick={() => handleMoveQuestion('up')}
                className="p-1 rounded border-2 border-[var(--border)] bg-[var(--surface)] text-[var(--text)] disabled:opacity-40 text-xs font-bold"
                title="Move Question Up"
              >
                ▲
              </button>
              <button
                disabled={activeQuestionIndex === selectedQuiz.questions.length - 1}
                onClick={() => handleMoveQuestion('down')}
                className="p-1 rounded border-2 border-[var(--border)] bg-[var(--surface)] text-[var(--text)] disabled:opacity-40 text-xs font-bold"
                title="Move Question Down"
              >
                ▼
              </button>
            </div>
          </div>

          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
            {selectedQuiz.questions.map((q, idx) => {
              const isActive = idx === activeQuestionIndex;
              return (
                <div
                  key={q.id || idx}
                  onClick={() => {
                    sound.playClick();
                    setActiveQuestionIndex(idx);
                  }}
                  className={`p-3 rounded-xl border-2 border-[var(--border)] cursor-pointer transition-all ${
                    isActive
                      ? 'bg-[var(--accent-2-bg)] text-[#16120E] shadow-[3px_3px_0px_var(--shadow)] -translate-y-0.5'
                      : 'bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)] shadow-[2px_2px_0px_var(--shadow)]'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-black mb-1">
                    <span>Q{idx + 1} • {q.type.replace('_', ' ')}</span>
                    <span className="sticker-badge text-[10px] py-0 px-1.5 border">
                      {q.courseOutcomeTag || 'CO1'}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-[var(--text)] line-clamp-2">
                    {q.text}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Add Question Button Menu */}
          <div className="pt-2 space-y-1.5">
            <button
              onClick={() => handleAddQuestion('multiple_choice')}
              className="paper-btn paper-btn-ok w-full py-2 text-xs font-bold"
            >
              + Multiple Choice
            </button>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => handleAddQuestion('true_false')}
                className="paper-btn paper-btn-sm text-[11px]"
              >
                + True / False
              </button>
              <button
                onClick={() => handleAddQuestion('type_answer')}
                className="paper-btn paper-btn-sm text-[11px]"
              >
                + Type Answer
              </button>
              <button
                onClick={() => handleAddQuestion('ordering')}
                className="paper-btn paper-btn-sm text-[11px]"
              >
                + Ordering
              </button>
              <button
                onClick={() => handleAddQuestion('poll')}
                className="paper-btn paper-btn-sm text-[11px]"
              >
                + Poll (Unscored)
              </button>
            </div>
          </div>
        </div>

        {/* Right: Active Question Detail Editor */}
        <div className="lg:col-span-3">
          {activeQuestion ? (
            <div className="paper-card p-6 space-y-5">
              {/* Question Control Strip */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[var(--border)]/20 pb-3">
                <div className="flex items-center gap-2">
                  <span className="font-['Bricolage_Grotesque'] font-black text-xl text-[var(--accent)]">
                    Question #{activeQuestionIndex + 1}
                  </span>
                  <select
                    id="questionTypeSelect"
                    aria-label="Question Type"
                    value={activeQuestion.type}
                    onChange={e => handleUpdateQuestion('type', e.target.value as QuestionType)}
                    className="paper-select text-xs font-bold rounded-lg border-2 border-[var(--border)] px-2 py-1"
                  >
                    <option value="multiple_choice">Multiple Choice (Single)</option>
                    <option value="multi_select">Multi-Select (Multiple Correct)</option>
                    <option value="true_false">True / False</option>
                    <option value="type_answer">Type Answer</option>
                    <option value="ordering">Ordering Sequence</option>
                    <option value="poll">Live Poll (Unscored)</option>
                    <option value="info_slide">Info Slide (0 Points)</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <button onClick={handleDuplicateQuestion} className="paper-btn paper-btn-sm text-xs">
                    Duplicate
                  </button>
                  <button onClick={handleDeleteQuestion} className="paper-btn paper-btn-sm paper-btn-primary text-xs">
                    Delete
                  </button>
                </div>
              </div>

              {/* Question Text Prompt */}
              <div className="space-y-1">
                <label htmlFor="questionPromptTextarea" className="text-xs font-bold uppercase text-[var(--text)]">Question Prompt</label>
                <textarea
                  id="questionPromptTextarea"
                  rows={3}
                  value={activeQuestion.text}
                  onChange={e => handleUpdateQuestion('text', e.target.value)}
                  className="paper-input w-full rounded-xl border-2 border-[var(--border)] p-3 font-semibold text-base shadow-[2px_2px_0px_var(--shadow)]"
                  placeholder="Enter your question prompt here..."
                />
              </div>

              {/* Options Editor */}
              {activeQuestion.type !== 'type_answer' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase text-[var(--text)]">
                      Answer Choices (Click checkmark to toggle correct answers)
                    </label>
                    {activeQuestion.options.length < 6 && (
                      <button
                        onClick={() => {
                          const updated = [...activeQuestion.options, `Option ${String.fromCharCode(65 + activeQuestion.options.length)}`];
                          handleUpdateQuestion('options', updated);
                        }}
                        className="text-xs font-bold text-[var(--ok)] dark:text-[var(--accent-2)] hover:underline"
                      >
                        + Add Option
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {activeQuestion.options.map((opt, optIdx) => {
                      const isCorrect = activeQuestion.correctAnswers.includes(optIdx);
                      const shapeIcons = [
                        <ShapeTriangle key="tri" className="w-5 h-5" fill="var(--accent)" />,
                        <ShapeDiamond key="dia" className="w-5 h-5" fill="var(--accent-2)" />,
                        <ShapeCircle key="cir" className="w-5 h-5" fill="var(--ok)" />,
                        <ShapeSquare key="sq" className="w-5 h-5" fill="var(--info)" />,
                      ];

                      return (
                        <div
                          key={optIdx}
                          className={`flex items-center gap-2 p-2.5 rounded-xl border-2 border-[var(--border)] transition-all ${
                            isCorrect ? 'bg-[var(--surface-2)] ring-2 ring-[var(--ok)]' : 'bg-[var(--surface)] text-[var(--text)]'
                          }`}
                        >
                          <div className="shrink-0">{shapeIcons[optIdx % 4]}</div>
                          <input
                            type="text"
                            value={opt}
                            onChange={e => {
                              const opts = [...activeQuestion.options];
                              opts[optIdx] = e.target.value;
                              handleUpdateQuestion('options', opts);
                            }}
                            className="flex-1 text-sm font-bold bg-transparent border-none focus:outline-none text-[var(--text)]"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              sound.playClick();
                              if (activeQuestion.type === 'multi_select') {
                                const exists = activeQuestion.correctAnswers.includes(optIdx);
                                const updated = exists
                                  ? activeQuestion.correctAnswers.filter(i => i !== optIdx)
                                  : [...activeQuestion.correctAnswers, optIdx];
                                handleUpdateQuestion('correctAnswers', updated);
                              } else {
                                handleUpdateQuestion('correctAnswers', [optIdx]);
                              }
                            }}
                            className={`h-7 w-7 rounded-lg border-2 border-[var(--border)] flex items-center justify-center font-bold text-xs ${
                              isCorrect ? 'paper-btn-ok' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'
                            }`}
                            title="Toggle Correct Answer"
                          >
                            ✓
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Type Answer Accepted Answers */}
              {activeQuestion.type === 'type_answer' && (
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-[var(--text)]">
                    Accepted Text Answers (Comma separated)
                  </label>
                  <input
                    type="text"
                    value={activeQuestion.acceptedTextAnswers?.join(', ') || ''}
                    onChange={e => {
                      const split = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                      handleUpdateQuestion('acceptedTextAnswers', split);
                    }}
                    className="paper-input w-full rounded-xl border-2 border-[var(--border)] p-2.5 text-sm font-bold shadow-[2px_2px_0px_var(--shadow)]"
                    placeholder="e.g. Canberra, canberra"
                  />
                </div>
              )}

              {/* Pedagogical Metadata: Time, Points, Bloom Level, CO Tag, Topic */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-t-2 border-[var(--border)]/20 pt-4">
                <div>
                  <label htmlFor="questionTimeLimitSelect" className="text-xs font-bold uppercase text-[var(--text)]">Time Limit</label>
                  <select
                    id="questionTimeLimitSelect"
                    aria-label="Time Limit"
                    value={activeQuestion.timeLimit}
                    onChange={e => handleUpdateQuestion('timeLimit', Number(e.target.value))}
                    className="paper-select w-full rounded-lg border-2 border-[var(--border)] p-1.5 text-xs font-bold"
                  >
                    <option value={10}>10 Seconds</option>
                    <option value={15}>15 Seconds</option>
                    <option value={20}>20 Seconds</option>
                    <option value={30}>30 Seconds</option>
                    <option value={60}>60 Seconds</option>
                    <option value={0}>Unlimited</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="questionPointsSelect" className="text-xs font-bold uppercase text-[var(--text)]">Points</label>
                  <select
                    id="questionPointsSelect"
                    aria-label="Points"
                    value={activeQuestion.points}
                    onChange={e => handleUpdateQuestion('points', Number(e.target.value))}
                    className="paper-select w-full rounded-lg border-2 border-[var(--border)] p-1.5 text-xs font-bold"
                  >
                    <option value={1000}>Standard (1000 pts)</option>
                    <option value={2000}>Double Points (2000 pts)</option>
                    <option value={0}>No Points (0 pts)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="questionBloomLevelSelect" className="text-xs font-bold uppercase text-[var(--text)]">Bloom Taxonomy</label>
                  <select
                    id="questionBloomLevelSelect"
                    aria-label="Bloom Taxonomy"
                    value={activeQuestion.bloomLevel}
                    onChange={e => handleUpdateQuestion('bloomLevel', e.target.value as BloomLevel)}
                    className="paper-select w-full rounded-lg border-2 border-[var(--border)] p-1.5 text-xs font-bold"
                  >
                    <option value="remember">Remember / Recall</option>
                    <option value="understand">Understand</option>
                    <option value="apply">Apply</option>
                    <option value="analyze">Analyze</option>
                    <option value="evaluate">Evaluate</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="questionCOTagInput" className="text-xs font-bold uppercase text-[var(--text)]">CO Outcome Tag</label>
                  <input
                    id="questionCOTagInput"
                    type="text"
                    value={activeQuestion.courseOutcomeTag}
                    onChange={e => handleUpdateQuestion('courseOutcomeTag', e.target.value.toUpperCase())}
                    className="paper-input w-full rounded-lg border-2 border-[var(--border)] p-1.5 text-xs font-bold"
                    placeholder="e.g. CO1"
                  />
                </div>
              </div>

              {/* Explanation Text */}
              <div className="space-y-1">
                <label htmlFor="questionExplanationTextarea" className="text-xs font-bold uppercase text-[var(--text)]">
                  Answer Explanation (Shown to players during Reveal step)
                </label>
                <textarea
                  id="questionExplanationTextarea"
                  rows={2}
                  value={activeQuestion.explanation}
                  onChange={e => handleUpdateQuestion('explanation', e.target.value)}
                  className="paper-input w-full rounded-xl border-2 border-[var(--border)] p-2.5 text-xs"
                  placeholder="Explain why the answer is correct to reinforce learning..."
                />
              </div>
            </div>
          ) : (
            <div className="paper-card p-12 text-center text-[var(--text-muted)] font-medium">
              Select or add a question to begin editing.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
