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
  initialSelectedQuizId?: string;
}

export const QuizBuilder: React.FC<QuizBuilderProps> = ({
  quizzes,
  onSaveQuiz,
  onSelectForHost,
  onDeleteQuiz,
  initialSelectedQuizId,
}) => {
  const [selectedQuiz, setSelectedQuiz] = useState<Quiz>(() => {
    if (initialSelectedQuizId) {
      const match = quizzes.find(q => q.id === initialSelectedQuizId);
      if (match) return match;
    }
    return quizzes[0] || SAMPLE_QUIZZES[0];
  });
  const [activeQuestionIndex, setActiveQuestionIndex] = useState<number>(0);
  const [previewMode, setPreviewMode] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string>('Just now');

  React.useEffect(() => {
    if (initialSelectedQuizId) {
      const match = quizzes.find(q => q.id === initialSelectedQuizId);
      if (match) {
        setSelectedQuiz(match);
        setActiveQuestionIndex(0);
      }
    }
  }, [initialSelectedQuizId, quizzes]);

  const activeQuestion: Question | undefined = selectedQuiz.questions[activeQuestionIndex];

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const markSaved = (updatedQuiz: Quiz) => {
    onSaveQuiz(updatedQuiz);
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLastSavedAt(timeStr);
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
    markSaved(newQuiz);
    showToast('New Quiz created!');
  };

  const handleUpdateQuizMeta = (field: keyof Quiz, value: any) => {
    const updated = { ...selectedQuiz, [field]: value, updatedAt: new Date().toISOString() };
    setSelectedQuiz(updated);
    markSaved(updated);
  };

  const handleUpdateQuestion = (field: keyof Question, value: any) => {
    handleUpdateQuestionMultiple({ [field]: value });
  };

  const handleUpdateQuestionMultiple = (fields: Partial<Question>) => {
    if (!activeQuestion) return;
    const updatedQuestions = [...selectedQuiz.questions];
    updatedQuestions[activeQuestionIndex] = {
      ...activeQuestion,
      ...fields,
    };
    const updatedQuiz = {
      ...selectedQuiz,
      questions: updatedQuestions,
      updatedAt: new Date().toISOString(),
    };
    setSelectedQuiz(updatedQuiz);
    markSaved(updatedQuiz);
  };

  const handleAddQuestion = (type: QuestionType = 'multiple_choice') => {
    sound.playClick();
    let defaultOptions = ['Option A', 'Option B', 'Option C', 'Option D'];
    if (type === 'true_false') defaultOptions = ['True', 'False'];
    if (type === 'type_answer') defaultOptions = [];
    if (type === 'info_slide') defaultOptions = [];

    const newQuestion: Question = {
      id: `q_${Date.now()}_${selectedQuiz.questions.length + 1}`,
      type,
      text: type === 'true_false' ? 'True or False: ...' : type === 'info_slide' ? 'Information Slide' : 'New engaging question prompt...',
      options: defaultOptions,
      correctAnswers: type === 'info_slide' || type === 'poll' ? [] : [0],
      acceptedTextAnswers: type === 'type_answer' ? ['answer'] : [],
      explanation: 'Explanation for students during reveal...',
      timeLimit: type === 'info_slide' ? 0 : 20,
      points: type === 'info_slide' || type === 'poll' ? 0 : 1000,
      topicTag: 'Topic 1',
      bloomLevel: 'understand',
      courseOutcomeTag: 'CO1',
    };
    const updatedQuestions = [...selectedQuiz.questions, newQuestion];
    const updatedQuiz = { ...selectedQuiz, questions: updatedQuestions };
    setSelectedQuiz(updatedQuiz);
    setActiveQuestionIndex(updatedQuestions.length - 1);
    markSaved(updatedQuiz);
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
    markSaved(updatedQuiz);
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
    markSaved(updatedQuiz);
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
    markSaved(updatedQuiz);
  };

  // JSON Export / Import
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
            markSaved(parsed);
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

  // CSV Export / Import
  const handleExportCsv = () => {
    sound.playClick();
    const headers = ['Type', 'Text', 'Options', 'CorrectAnswers', 'Explanation', 'TimeLimit', 'Points', 'BloomLevel', 'COTag'];
    const rows = selectedQuiz.questions.map(q => [
      `"${q.type}"`,
      `"${q.text.replace(/"/g, '""')}"`,
      `"${(q.options || []).join('|').replace(/"/g, '""')}"`,
      `"${(q.correctAnswers || []).join('|')}"`,
      `"${(q.explanation || '').replace(/"/g, '""')}"`,
      q.timeLimit,
      q.points,
      `"${q.bloomLevel || 'understand'}"`,
      `"${q.courseOutcomeTag || 'CO1'}"`,
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${selectedQuiz.title.replace(/\s+/g, '_')}.csv`);
    link.click();
    showToast('Quiz exported to CSV!');
  };

  const handleImportCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader();
    if (e.target.files && e.target.files[0]) {
      fileReader.readAsText(e.target.files[0], 'UTF-8');
      fileReader.onload = event => {
        try {
          const text = event.target?.result as string;
          const lines = text.split('\n').filter(l => l.trim().length > 0);
          if (lines.length <= 1) {
            showToast('CSV file is empty or missing rows.');
            return;
          }
          const importedQuestions: Question[] = [];
          for (let i = 1; i < lines.length; i++) {
            // Simple robust CSV row splitter
            const rowParts: string[] = [];
            let inQuotes = false;
            let current = '';
            for (let c = 0; c < lines[i].length; c++) {
              const ch = lines[i][c];
              if (ch === '"') {
                inQuotes = !inQuotes;
              } else if (ch === ',' && !inQuotes) {
                rowParts.push(current.trim());
                current = '';
              } else {
                current += ch;
              }
            }
            rowParts.push(current.trim());

            if (rowParts.length >= 2) {
              const clean = (val: string) => (val || '').replace(/^"|"$/g, '').replace(/""/g, '"');
              const qType = (clean(rowParts[0]) || 'multiple_choice') as QuestionType;
              const qText = clean(rowParts[1]) || `Question ${i}`;
              const opts = clean(rowParts[2]) ? clean(rowParts[2]).split('|') : ['Option A', 'Option B'];
              const correct = clean(rowParts[3]) ? clean(rowParts[3]).split('|').map(Number).filter(n => !isNaN(n)) : [0];
              const expl = clean(rowParts[4]) || '';
              const timeLimit = Number(clean(rowParts[5])) || 20;
              const points = Number(clean(rowParts[6])) || 1000;
              const bloom = (clean(rowParts[7]) || 'understand') as BloomLevel;
              const coTag = clean(rowParts[8]) || 'CO1';

              importedQuestions.push({
                id: `q_csv_${Date.now()}_${i}`,
                type: qType,
                text: qText,
                options: opts,
                correctAnswers: correct,
                acceptedTextAnswers: [opts[0] || 'answer'],
                explanation: expl,
                timeLimit,
                points,
                topicTag: 'General',
                bloomLevel: bloom,
                courseOutcomeTag: coTag,
              });
            }
          }

          if (importedQuestions.length > 0) {
            const updated: Quiz = {
              ...selectedQuiz,
              id: `imported_csv_${Date.now()}`,
              questions: importedQuestions,
              updatedAt: new Date().toISOString(),
            };
            setSelectedQuiz(updated);
            setActiveQuestionIndex(0);
            markSaved(updated);
            showToast(`Imported ${importedQuestions.length} questions from CSV!`);
          } else {
            showToast('Could not parse questions from CSV.');
          }
        } catch (err) {
          showToast('Failed to parse CSV file.');
        }
      };
    }
  };

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 space-y-6">
      {/* Toast Alert */}
      {toastMessage && (
        <div data-testid="toast-alert" className="fixed top-16 right-6 z-50 rounded-xl border-2 border-[var(--border)] bg-[var(--accent-2-bg)] px-4 py-2 font-bold text-[var(--text-on-accent-2)] shadow-[3px_3px_0px_var(--shadow)] animate-bounce">
          {toastMessage}
        </div>
      )}

      {/* Studio Header */}
      <div className="paper-card p-5 sm:p-6 bg-[var(--bg-page)] border-3 shadow-[4px_4px_0px_var(--shadow)] flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="sticker-badge sticker-badge-sunshine text-xs">Authoring Studio</span>
            <span className="text-xs font-bold text-[var(--ok)]">7 Question Types Supported</span>
            <span data-testid="autosave-indicator" className="sticker-badge text-[11px] bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300">
              ✓ Autosaved: {lastSavedAt}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black font-['Bricolage_Grotesque'] text-[var(--text)]">
            Quiz Studio & Assessment Builder
          </h1>
          <p className="text-xs font-semibold text-[var(--text-muted)] mt-1">
            Design interactive questions, Bloom's levels, Course Outcomes, and export to JSON or CSV.
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

          <button id="btnCreateNewQuiz" onClick={handleCreateNewQuiz} className="paper-btn paper-btn-sm paper-btn-secondary">
            + New Quiz
          </button>

          {onDeleteQuiz && quizzes.length > 1 && (
            <button
              id="btnDeleteActiveQuiz"
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
          <button id="btnExportJson" onClick={handleExportJson} className="paper-btn paper-btn-sm">
            Export JSON
          </button>
          <label id="lblImportJson" className="paper-btn paper-btn-sm cursor-pointer">
            Import JSON
            <input id="inputImportJson" type="file" accept=".json" onChange={handleImportJson} className="hidden" />
          </label>

          {/* CSV Export/Import */}
          <button id="btnExportCsv" onClick={handleExportCsv} className="paper-btn paper-btn-sm">
            Export CSV
          </button>
          <label id="lblImportCsv" className="paper-btn paper-btn-sm cursor-pointer">
            Import CSV
            <input id="inputImportCsv" type="file" accept=".csv" onChange={handleImportCsv} className="hidden" />
          </label>

          <button
            id="btnTogglePreview"
            onClick={() => setPreviewMode(!previewMode)}
            className={`paper-btn paper-btn-sm ${previewMode ? 'paper-btn-ok' : ''}`}
          >
            {previewMode ? 'Exit Preview' : '👁️ Preview'}
          </button>

          <button
            id="btnHostLiveNow"
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

      {/* Preview Mode Container */}
      {previewMode && activeQuestion && (
        <div data-testid="quiz-preview-container" className="paper-card p-6 border-3 border-[var(--ok)] bg-[var(--surface-2)] space-y-4 animate-fadeIn">
          <div className="flex items-center justify-between border-b-2 border-[var(--border)] pb-2">
            <div className="flex items-center gap-2">
              <span className="sticker-badge sticker-badge-ok text-xs">Live Player Preview</span>
              <span className="font-bold text-xs text-[var(--text-muted)]">Type: {activeQuestion.type.replace('_', ' ').toUpperCase()}</span>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono font-bold text-[var(--text)]">
              <span>⏱️ {activeQuestion.timeLimit}s</span>
              <span>⭐ {activeQuestion.points} pts</span>
            </div>
          </div>

          <div className="text-center py-4">
            <h2 className="text-xl sm:text-2xl font-black font-['Bricolage_Grotesque'] text-[var(--text)]">
              {activeQuestion.text}
            </h2>
          </div>

          {activeQuestion.type === 'type_answer' ? (
            <div className="max-w-md mx-auto space-y-2">
              <input
                disabled
                placeholder="Student types answer here..."
                className="w-full p-3 rounded-xl border-2 border-[var(--border)] bg-[var(--surface)] text-center font-bold"
              />
              <p className="text-xs text-center text-[var(--text-muted)]">
                Accepted: {activeQuestion.acceptedTextAnswers?.join(', ')}
              </p>
            </div>
          ) : activeQuestion.type === 'info_slide' ? (
            <div className="p-4 rounded-xl border-2 border-[var(--border)] bg-[var(--surface)] text-center text-sm font-semibold">
              Informational slide presented to all participants. No answers required.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl mx-auto">
              {activeQuestion.options.map((opt, idx) => {
                const isCorrect = activeQuestion.correctAnswers.includes(idx);
                return (
                  <div
                    key={idx}
                    className={`p-3 rounded-xl border-2 border-[var(--border)] flex items-center justify-between font-bold text-sm ${
                      isCorrect ? 'bg-green-100 text-green-900 border-green-600 dark:bg-green-950 dark:text-green-200' : 'bg-[var(--surface)] text-[var(--text)]'
                    }`}
                  >
                    <span>{opt}</span>
                    {isCorrect && <span className="text-xs font-black">✓ Correct</span>}
                  </div>
                );
              })}
            </div>
          )}

          {activeQuestion.explanation && (
            <div className="text-xs text-center text-[var(--text-muted)] italic pt-2">
              Explanation: {activeQuestion.explanation}
            </div>
          )}
        </div>
      )}

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
          <label htmlFor="quizDescriptionInput" className="text-xs font-bold uppercase text-[var(--text)]">Description</label>
          <input
            id="quizDescriptionInput"
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
                id="btnMoveQuestionUp"
                disabled={activeQuestionIndex === 0}
                onClick={() => handleMoveQuestion('up')}
                className="p-1 rounded border-2 border-[var(--border)] bg-[var(--surface)] text-[var(--text)] disabled:opacity-40 text-xs font-bold"
                title="Move Question Up"
              >
                ▲
              </button>
              <button
                id="btnMoveQuestionDown"
                disabled={activeQuestionIndex === selectedQuiz.questions.length - 1}
                onClick={() => handleMoveQuestion('down')}
                className="p-1 rounded border-2 border-[var(--border)] bg-[var(--surface)] text-[var(--text)] disabled:opacity-40 text-xs font-bold"
                title="Move Question Down"
              >
                ▼
              </button>
            </div>
          </div>

          <div id="questionsNavRail" className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
            {selectedQuiz.questions.map((q, idx) => {
              const isActive = idx === activeQuestionIndex;
              return (
                <div
                  key={q.id || idx}
                  data-testid={`question-rail-item-${idx}`}
                  onClick={() => {
                    sound.playClick();
                    setActiveQuestionIndex(idx);
                  }}
                  className={`p-3 rounded-xl border-2 border-[var(--border)] cursor-pointer transition-all ${
                    isActive
                      ? 'bg-[var(--accent-2-bg)] text-[var(--text)] shadow-[3px_3px_0px_var(--shadow)] -translate-y-0.5'
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
              id="btnAddMultipleChoice"
              onClick={() => handleAddQuestion('multiple_choice')}
              className="paper-btn paper-btn-ok w-full py-2 text-xs font-bold"
            >
              + Multiple Choice
            </button>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                id="btnAddTrueFalse"
                onClick={() => handleAddQuestion('true_false')}
                className="paper-btn paper-btn-sm text-[11px]"
              >
                + True / False
              </button>
              <button
                id="btnAddTypeAnswer"
                onClick={() => handleAddQuestion('type_answer')}
                className="paper-btn paper-btn-sm text-[11px]"
              >
                + Type Answer
              </button>
              <button
                id="btnAddOrdering"
                onClick={() => handleAddQuestion('ordering')}
                className="paper-btn paper-btn-sm text-[11px]"
              >
                + Ordering
              </button>
              <button
                id="btnAddPoll"
                onClick={() => handleAddQuestion('poll')}
                className="paper-btn paper-btn-sm text-[11px]"
              >
                + Poll (Unscored)
              </button>
              <button
                id="btnAddMultiSelect"
                onClick={() => handleAddQuestion('multi_select')}
                className="paper-btn paper-btn-sm text-[11px]"
              >
                + Multi-Select
              </button>
              <button
                id="btnAddInfoSlide"
                onClick={() => handleAddQuestion('info_slide')}
                className="paper-btn paper-btn-sm text-[11px]"
              >
                + Info Slide
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
                    onChange={e => {
                      const newType = e.target.value as QuestionType;
                      if (newType === 'true_false') {
                        handleUpdateQuestionMultiple({
                          type: newType,
                          options: ['True', 'False'],
                          correctAnswers: [0],
                        });
                      } else if (newType === 'type_answer') {
                        handleUpdateQuestionMultiple({
                          type: newType,
                          acceptedTextAnswers: activeQuestion.acceptedTextAnswers?.length ? activeQuestion.acceptedTextAnswers : ['answer'],
                        });
                      } else if (newType === 'info_slide') {
                        handleUpdateQuestionMultiple({
                          type: newType,
                          points: 0,
                          timeLimit: 0,
                        });
                      } else if (newType === 'poll') {
                        handleUpdateQuestionMultiple({
                          type: newType,
                          points: 0,
                        });
                      } else {
                        handleUpdateQuestion('type', newType);
                      }
                    }}
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
                  <button id="btnDuplicateQuestion" onClick={handleDuplicateQuestion} className="paper-btn paper-btn-sm text-xs">
                    Duplicate
                  </button>
                  <button id="btnDeleteQuestion" onClick={handleDeleteQuestion} className="paper-btn paper-btn-sm paper-btn-primary text-xs">
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
              {activeQuestion.type !== 'type_answer' && activeQuestion.type !== 'info_slide' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase text-[var(--text)]">
                      Answer Choices (Click checkmark to toggle correct answers)
                    </label>
                    {activeQuestion.options.length < 6 && (
                      <button
                        id="btnAddOption"
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
                          data-testid={`option-item-${optIdx}`}
                          className={`flex items-center gap-2 p-2.5 rounded-xl border-2 border-[var(--border)] transition-all ${
                            isCorrect ? 'bg-[var(--surface-2)] ring-2 ring-[var(--ok)]' : 'bg-[var(--surface)] text-[var(--text)]'
                          }`}
                        >
                          <div className="shrink-0">{shapeIcons[optIdx % 4]}</div>
                          <input
                            id={`optionInput_${optIdx}`}
                            aria-label={`Option ${optIdx + 1}`}
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
                            id={`btnToggleCorrect_${optIdx}`}
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
                              isCorrect ? 'paper-btn-ok' : 'bg-[var(--surface-2)] text-[var(--text)]'
                            }`}
                            title="Toggle Correct Answer"
                          >
                            ✓
                          </button>
                          {activeQuestion.options.length > 2 && (
                            <button
                              id={`btnRemoveOption_${optIdx}`}
                              type="button"
                              onClick={() => {
                                sound.playClick();
                                const opts = activeQuestion.options.filter((_, idx) => idx !== optIdx);
                                const correct = activeQuestion.correctAnswers
                                  .filter(i => i !== optIdx)
                                  .map(i => (i > optIdx ? i - 1 : i));
                                handleUpdateQuestionMultiple({
                                  options: opts,
                                  correctAnswers: correct.length > 0 ? correct : [0],
                                });
                              }}
                              className="h-7 w-7 rounded-lg border-2 border-[var(--border)] bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-200 flex items-center justify-center font-bold text-xs hover:bg-red-200"
                              title="Remove Option"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Type Answer Accepted Answers */}
              {activeQuestion.type === 'type_answer' && (
                <div className="space-y-1">
                  <label htmlFor="acceptedAnswersInput" className="text-xs font-bold uppercase text-[var(--text)]">
                    Accepted Text Answers (Comma separated)
                  </label>
                  <input
                    id="acceptedAnswersInput"
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
                    value={activeQuestion.bloomLevel || 'understand'}
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
                    value={activeQuestion.courseOutcomeTag || 'CO1'}
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
                  value={activeQuestion.explanation || ''}
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
