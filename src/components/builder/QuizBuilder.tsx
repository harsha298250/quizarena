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
        <div className="fixed top-16 right-6 z-50 rounded-xl border-2 border-[#16120E] bg-[#FFC83D] px-4 py-2 font-bold text-[#16120E] shadow-[3px_3px_0px_#16120E] animate-bounce">
          {toastMessage}
        </div>
      )}

      {/* Top Bar: Selector, Actions, Host Button */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b-2 border-[#16120E] pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-black uppercase text-[#16120E] dark:text-[#FFF6E5]">Active Quiz:</label>
          <select
            value={selectedQuiz.id}
            onChange={e => {
              const q = quizzes.find(item => item.id === e.target.value) || SAMPLE_QUIZZES[0];
              setSelectedQuiz(q);
              setActiveQuestionIndex(0);
            }}
            className="rounded-xl border-2 border-[#16120E] bg-white dark:bg-[#221c16] dark:text-white px-3 py-1.5 font-bold text-sm shadow-[2px_2px_0px_#16120E] cursor-pointer"
          >
            {quizzes.map(q => (
              <option key={q.id} value={q.id}>
                {q.title} ({q.questions.length} Qs)
              </option>
            ))}
          </select>

          <button onClick={handleCreateNewQuiz} className="paper-btn paper-btn-sm bg-[#FFC83D] text-[#16120E]">
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
              className="paper-btn paper-btn-sm bg-red-100 hover:bg-red-200 text-red-700 border-[#16120E] dark:bg-red-950 dark:text-red-300"
              title="Delete this quiz"
            >
              🗑️ Delete Quiz
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* JSON Export/Import */}
          <button onClick={handleExportJson} className="paper-btn paper-btn-sm bg-white dark:bg-[#221c16] dark:text-white">
            Export JSON
          </button>
          <label className="paper-btn paper-btn-sm bg-white dark:bg-[#221c16] dark:text-white cursor-pointer">
            Import JSON
            <input type="file" accept=".json" onChange={handleImportJson} className="hidden" />
          </label>

          <button
            onClick={() => setPreviewMode(!previewMode)}
            className={`paper-btn paper-btn-sm ${previewMode ? 'bg-[#14B8A6] text-white' : 'bg-white dark:bg-[#221c16] dark:text-white'}`}
          >
            {previewMode ? 'Exit Preview' : '👁️ Preview'}
          </button>

          <button
            onClick={() => {
              sound.playClick();
              onSelectForHost(selectedQuiz);
            }}
            className="paper-btn paper-btn-sm bg-[#FF5A36] text-white font-extrabold px-4"
          >
            🚀 Host Live Now
          </button>
        </div>
      </div>

      {/* Quiz Metadata Editor */}
      <div className="paper-card p-4 bg-white dark:bg-[#221c16] space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 space-y-1">
            <label className="text-xs font-bold uppercase text-[#16120E] dark:text-[#FFF6E5]">Quiz Title</label>
            <input
              type="text"
              value={selectedQuiz.title}
              onChange={e => handleUpdateQuizMeta('title', e.target.value)}
              className="w-full rounded-xl border-2 border-[#16120E] px-3 py-2 font-bold text-lg dark:bg-[#16120E] dark:text-white shadow-[2px_2px_0px_#16120E]"
              placeholder="e.g. Physics Midterm Battle..."
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-[#16120E] dark:text-[#FFF6E5]">Default Game Mode</label>
            <select
              value={selectedQuiz.gameMode}
              onChange={e => handleUpdateQuizMeta('gameMode', e.target.value)}
              className="w-full rounded-xl border-2 border-[#16120E] px-3 py-2 font-bold text-sm dark:bg-[#16120E] dark:text-white shadow-[2px_2px_0px_#16120E]"
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
          <label className="text-xs font-bold uppercase text-[#16120E] dark:text-[#FFF6E5]">Description</label>
          <input
            type="text"
            value={selectedQuiz.description}
            onChange={e => handleUpdateQuizMeta('description', e.target.value)}
            className="w-full rounded-xl border-2 border-[#16120E] px-3 py-1.5 text-sm dark:bg-[#16120E] dark:text-white shadow-[2px_2px_0px_#16120E]"
            placeholder="Brief instructions or summary for participants..."
          />
        </div>
      </div>

      {/* Main Builder Grid: Left question rail + Right question editor */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left: Questions Navigator Rail */}
        <div className="lg:col-span-1 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-[#16120E] dark:text-white">
              Questions ({selectedQuiz.questions.length})
            </span>
            <div className="flex gap-1">
              <button
                disabled={activeQuestionIndex === 0}
                onClick={() => handleMoveQuestion('up')}
                className="p-1 rounded border-2 border-[#16120E] bg-white disabled:opacity-40 text-xs font-bold"
                title="Move Question Up"
              >
                ▲
              </button>
              <button
                disabled={activeQuestionIndex === selectedQuiz.questions.length - 1}
                onClick={() => handleMoveQuestion('down')}
                className="p-1 rounded border-2 border-[#16120E] bg-white disabled:opacity-40 text-xs font-bold"
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
                  className={`p-3 rounded-xl border-2 border-[#16120E] cursor-pointer transition-all ${
                    isActive
                      ? 'bg-[#FFC83D] shadow-[3px_3px_0px_#16120E] -translate-y-0.5'
                      : 'bg-white dark:bg-[#221c16] hover:bg-[#FFF6E5] shadow-[2px_2px_0px_#16120E]'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-black mb-1">
                    <span>Q{idx + 1} • {q.type.replace('_', ' ')}</span>
                    <span className="sticker-badge bg-[#FFF6E5] text-[10px] py-0 px-1.5 border">
                      {q.courseOutcomeTag || 'CO1'}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-[#16120E] dark:text-gray-300 line-clamp-2">
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
              className="paper-btn w-full bg-[#14B8A6] text-white py-2 text-xs font-bold"
            >
              + Multiple Choice
            </button>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => handleAddQuestion('true_false')}
                className="paper-btn paper-btn-sm bg-white dark:bg-[#221c16] dark:text-white text-[11px]"
              >
                + True / False
              </button>
              <button
                onClick={() => handleAddQuestion('type_answer')}
                className="paper-btn paper-btn-sm bg-white dark:bg-[#221c16] dark:text-white text-[11px]"
              >
                + Type Answer
              </button>
              <button
                onClick={() => handleAddQuestion('ordering')}
                className="paper-btn paper-btn-sm bg-white dark:bg-[#221c16] dark:text-white text-[11px]"
              >
                + Ordering
              </button>
              <button
                onClick={() => handleAddQuestion('poll')}
                className="paper-btn paper-btn-sm bg-white dark:bg-[#221c16] dark:text-white text-[11px]"
              >
                + Poll (Unscored)
              </button>
            </div>
          </div>
        </div>

        {/* Right: Active Question Detail Editor */}
        <div className="lg:col-span-3">
          {activeQuestion ? (
            <div className="paper-card p-6 bg-white dark:bg-[#221c16] space-y-5">
              {/* Question Control Strip */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-gray-200 pb-3">
                <div className="flex items-center gap-2">
                  <span className="font-['Bricolage_Grotesque'] font-black text-xl text-[#FF5A36]">
                    Question #{activeQuestionIndex + 1}
                  </span>
                  <select
                    value={activeQuestion.type}
                    onChange={e => handleUpdateQuestion('type', e.target.value as QuestionType)}
                    className="text-xs font-bold rounded-lg border-2 border-[#16120E] px-2 py-1 bg-[#FFF6E5] dark:bg-[#16120E] dark:text-white"
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
                  <button onClick={handleDuplicateQuestion} className="paper-btn paper-btn-sm bg-white text-xs">
                    Duplicate
                  </button>
                  <button onClick={handleDeleteQuestion} className="paper-btn paper-btn-sm bg-[#FF5A36] text-white text-xs">
                    Delete
                  </button>
                </div>
              </div>

              {/* Question Text Prompt */}
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase text-[#16120E] dark:text-white">Question Prompt</label>
                <textarea
                  rows={3}
                  value={activeQuestion.text}
                  onChange={e => handleUpdateQuestion('text', e.target.value)}
                  className="w-full rounded-xl border-2 border-[#16120E] p-3 font-semibold text-base dark:bg-[#16120E] dark:text-white shadow-[2px_2px_0px_#16120E]"
                  placeholder="Enter your question prompt here..."
                />
              </div>

              {/* Options Editor */}
              {activeQuestion.type !== 'type_answer' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase text-[#16120E] dark:text-white">
                      Answer Choices (Click checkmark to toggle correct answers)
                    </label>
                    {activeQuestion.options.length < 6 && (
                      <button
                        onClick={() => {
                          const updated = [...activeQuestion.options, `Option ${String.fromCharCode(65 + activeQuestion.options.length)}`];
                          handleUpdateQuestion('options', updated);
                        }}
                        className="text-xs font-bold text-[#14B8A6] hover:underline"
                      >
                        + Add Option
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {activeQuestion.options.map((opt, optIdx) => {
                      const isCorrect = activeQuestion.correctAnswers.includes(optIdx);
                      const shapeIcons = [
                        <ShapeTriangle className="w-5 h-5" fill="#FF5A36" />,
                        <ShapeDiamond className="w-5 h-5" fill="#FFC83D" />,
                        <ShapeCircle className="w-5 h-5" fill="#14B8A6" />,
                        <ShapeSquare className="w-5 h-5" fill="#4DA3FF" />,
                      ];

                      return (
                        <div
                          key={optIdx}
                          className={`flex items-center gap-2 p-2.5 rounded-xl border-2 border-[#16120E] transition-all ${
                            isCorrect ? 'bg-[#FFFAEE] ring-2 ring-[#14B8A6]' : 'bg-white dark:bg-[#16120E]'
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
                            className="flex-1 text-sm font-bold bg-transparent border-none focus:outline-none dark:text-white"
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
                            className={`h-7 w-7 rounded-lg border-2 border-[#16120E] flex items-center justify-center font-bold text-xs ${
                              isCorrect ? 'bg-[#14B8A6] text-white' : 'bg-gray-100 text-gray-400'
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
                  <label className="text-xs font-bold uppercase text-[#16120E] dark:text-white">
                    Accepted Text Answers (Comma separated)
                  </label>
                  <input
                    type="text"
                    value={activeQuestion.acceptedTextAnswers?.join(', ') || ''}
                    onChange={e => {
                      const split = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                      handleUpdateQuestion('acceptedTextAnswers', split);
                    }}
                    className="w-full rounded-xl border-2 border-[#16120E] p-2.5 text-sm font-bold dark:bg-[#16120E] dark:text-white shadow-[2px_2px_0px_#16120E]"
                    placeholder="e.g. Canberra, canberra"
                  />
                </div>
              )}

              {/* Pedagogical Metadata: Time, Points, Bloom Level, CO Tag, Topic */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-t-2 border-gray-200 pt-4">
                <div>
                  <label className="text-xs font-bold uppercase text-[#16120E] dark:text-white">Time Limit</label>
                  <select
                    value={activeQuestion.timeLimit}
                    onChange={e => handleUpdateQuestion('timeLimit', Number(e.target.value))}
                    className="w-full rounded-lg border-2 border-[#16120E] p-1.5 text-xs font-bold dark:bg-[#16120E] dark:text-white"
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
                  <label className="text-xs font-bold uppercase text-[#16120E] dark:text-white">Points</label>
                  <select
                    value={activeQuestion.points}
                    onChange={e => handleUpdateQuestion('points', Number(e.target.value))}
                    className="w-full rounded-lg border-2 border-[#16120E] p-1.5 text-xs font-bold dark:bg-[#16120E] dark:text-white"
                  >
                    <option value={1000}>Standard (1000 pts)</option>
                    <option value={2000}>Double Points (2000 pts)</option>
                    <option value={0}>No Points (0 pts)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold uppercase text-[#16120E] dark:text-white">Bloom Taxonomy</label>
                  <select
                    value={activeQuestion.bloomLevel}
                    onChange={e => handleUpdateQuestion('bloomLevel', e.target.value as BloomLevel)}
                    className="w-full rounded-lg border-2 border-[#16120E] p-1.5 text-xs font-bold dark:bg-[#16120E] dark:text-white"
                  >
                    <option value="remember">Remember / Recall</option>
                    <option value="understand">Understand</option>
                    <option value="apply">Apply</option>
                    <option value="analyze">Analyze</option>
                    <option value="evaluate">Evaluate</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold uppercase text-[#16120E] dark:text-white">CO Outcome Tag</label>
                  <input
                    type="text"
                    value={activeQuestion.courseOutcomeTag}
                    onChange={e => handleUpdateQuestion('courseOutcomeTag', e.target.value.toUpperCase())}
                    className="w-full rounded-lg border-2 border-[#16120E] p-1.5 text-xs font-bold dark:bg-[#16120E] dark:text-white"
                    placeholder="e.g. CO1"
                  />
                </div>
              </div>

              {/* Explanation Text */}
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase text-[#16120E] dark:text-white">
                  Answer Explanation (Shown to players during Reveal step)
                </label>
                <textarea
                  rows={2}
                  value={activeQuestion.explanation}
                  onChange={e => handleUpdateQuestion('explanation', e.target.value)}
                  className="w-full rounded-xl border-2 border-[#16120E] p-2.5 text-xs dark:bg-[#16120E] dark:text-white"
                  placeholder="Explain why the answer is correct to reinforce learning..."
                />
              </div>
            </div>
          ) : (
            <div className="paper-card p-12 text-center text-gray-500">
              Select or add a question to begin editing.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
