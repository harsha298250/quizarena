/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { MailQueueItem } from '../../types/quiz';
import { getLocalOutboxEmails, updateOutboxItemStatus, queueResultEmail, resendOutboxEmail } from '../../services/emailService';
import { sound } from '../../lib/sound';

export const EmailOutbox: React.FC = () => {
  const [emails, setEmails] = useState<MailQueueItem[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<MailQueueItem | null>(null);
  const [isResending, setIsResending] = useState<boolean>(false);
  const [templateName, setTemplateName] = useState<string>('Standard Student Result');
  const [templateHtml, setTemplateHtml] = useState<string>(
    'Great job {{name}}! You scored {{score}} points and secured Rank #{{rank}} in the arena!'
  );
  const [testEmailTo, setTestEmailTo] = useState<string>('joyboy56211@gmail.com');

  useEffect(() => {
    loadEmails();
  }, []);

  const loadEmails = () => {
    const list = getLocalOutboxEmails();
    setEmails(list);
    if (list.length > 0 && !selectedEmail) {
      setSelectedEmail(list[0]);
    }
  };

  const handleResend = async (id: string) => {
    sound.playClick();
    setIsResending(true);
    try {
      const success = await resendOutboxEmail(id);
      loadEmails();
      if (success) {
        alert('Email resent successfully!');
      } else {
        alert('Resend attempt finished. Check outbox for updated status.');
      }
    } catch (e) {
      alert('Error during resend: ' + String(e));
    } finally {
      setIsResending(false);
    }
  };

  const handleSendTest = async () => {
    sound.playClick();
    const rendered = templateHtml
      .replace('{{name}}', 'Alex Student')
      .replace('{{score}}', '8500')
      .replace('{{rank}}', '1');

    await queueResultEmail({
      to: testEmailTo,
      recipientName: 'Alex Student',
      subject: `Your QuizArena Result: Rank #1`,
      htmlContent: `<div style="font-family:sans-serif;padding:20px;border:3px solid #16120E;border-radius:12px;background:#FFF6E5;">
        <h2 style="color:#FF5A36;">QuizArena Certificate & Results</h2>
        <p>${rendered}</p>
        <p style="font-size:12px;color:#666;">Generated via QuizArena Firestore Mail Queue.</p>
      </div>`,
      status: 'sent',
      metadata: {
        gameId: 'game_demo',
        quizTitle: 'Computer Science Arena',
        score: 8500,
        rank: 1,
        accuracy: 0.9,
      },
    });

    loadEmails();
  };

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 space-y-6">
      {/* Header Banner */}
      <div className="paper-card p-6 bg-[var(--bg-page)] border-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <span className="sticker-badge bg-[var(--ok)] text-white text-xs mb-1">
            Communication Layer
          </span>
          <h1 className="font-['Bricolage_Grotesque'] text-2xl sm:text-3xl font-black text-[var(--text)]">
            Result Email Outbox & Template Editor
          </h1>
          <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mt-1">
            Writes to Firestore <code>/mail</code> collection compatible with the Firebase "Trigger Email from Firestore" extension.
          </p>
        </div>

        <button
          onClick={handleSendTest}
          className="paper-btn paper-btn-sm paper-btn-primary text-xs font-bold"
        >
          ✉️ Queue Test Email
        </button>
      </div>

      {/* Main Grid: Outbox list + Live HTML preview + Template editor */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Email queue records */}
        <div className="paper-card p-5 bg-[var(--surface)] space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-['Bricolage_Grotesque'] font-black text-lg text-[var(--text)]">
              Outgoing Queue ({emails.length})
            </h2>
            <button onClick={loadEmails} className="text-xs text-[var(--ok)] font-bold hover:underline">
              Refresh
            </button>
          </div>

          {emails.length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--text-muted)] font-semibold">
              No emails queued yet. Finish a live game or click "Queue Test Email" to test the pipeline!
            </div>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
              {emails.map(m => {
                const isSelected = selectedEmail?.id === m.id;
                return (
                  <div
                    key={m.id}
                    onClick={() => {
                      sound.playClick();
                      setSelectedEmail(m);
                    }}
                    className={`p-3 rounded-xl border-2 border-[var(--border)] cursor-pointer transition-all ${
                      isSelected ? 'bg-[var(--surface-2)] ring-2 ring-[var(--accent)]' : 'bg-[var(--surface)]'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-bold mb-1">
                      <span className="truncate max-w-[140px] text-[var(--accent)]">{m.to}</span>
                      <span
                        className={`sticker-badge text-[9px] py-0 px-1.5 ${
                          m.status === 'sent'
                            ? 'sticker-badge-ok'
                            : m.status === 'failed'
                            ? 'sticker-badge-tomato'
                            : 'sticker-badge-sunshine'
                        }`}
                      >
                        {m.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-xs font-bold text-[var(--text)] truncate">
                      {m.subject}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)] mt-1 font-mono-code">
                      Rank #{m.metadata?.rank} • {m.metadata?.score?.toLocaleString()} pts
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Center: Live HTML Preview */}
        <div className="paper-card p-5 bg-[var(--surface)] space-y-3">
          <div className="flex items-center justify-between border-b-2 border-[var(--border)] pb-2">
            <h2 className="font-['Bricolage_Grotesque'] font-black text-lg text-[var(--text)]">
              Email HTML Preview
            </h2>
            {selectedEmail && (
              <button
                onClick={() => handleResend(selectedEmail.id)}
                disabled={isResending}
                className="paper-btn paper-btn-sm paper-btn-ok text-xs font-bold disabled:opacity-50"
              >
                {isResending ? 'Sending...' : 'Resend Now'}
              </button>
            )}
          </div>

          {selectedEmail ? (
            <div className="space-y-3">
              <div className="text-xs font-semibold text-[var(--text-muted)]">
                To: <strong className="text-[var(--text)]">{selectedEmail.to}</strong> ({selectedEmail.recipientName})<br />
                Subject: <strong className="text-[var(--text)]">{selectedEmail.subject}</strong>
              </div>

              <div className="rounded-xl border-2 border-[var(--border)] p-4 bg-white text-black max-h-[380px] overflow-y-auto overflow-x-auto">
                <div dangerouslySetInnerHTML={{ __html: selectedEmail.htmlContent }} />
              </div>
            </div>
          ) : (
            <div className="p-12 text-center text-xs text-[var(--text-muted)]">
              Select an email from the queue to view rendered HTML.
            </div>
          )}
        </div>

        {/* Right: Template Editor */}
        <div className="paper-card p-5 bg-[var(--surface)] space-y-3">
          <h2 className="font-['Bricolage_Grotesque'] font-black text-lg text-[var(--text)]">
            Custom Template Variables
          </h2>

          <div className="space-y-1">
            <label className="text-xs font-bold text-[var(--text-muted)] uppercase">Template Name</label>
            <input
              type="text"
              value={templateName}
              onChange={e => setTemplateName(e.target.value)}
              className="paper-input w-full rounded-lg border-2 border-[var(--border)] p-2 text-xs font-bold"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-[var(--text-muted)] uppercase">
              Template Body (Use: {'{{name}}'}, {'{{score}}'}, {'{{rank}}'})
            </label>
            <textarea
              rows={4}
              value={templateHtml}
              onChange={e => setTemplateHtml(e.target.value)}
              className="paper-input w-full rounded-lg border-2 border-[var(--border)] p-2 text-xs font-mono-code"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-[var(--text-muted)] uppercase">Recipient Test Address</label>
            <input
              type="email"
              value={testEmailTo}
              onChange={e => setTestEmailTo(e.target.value)}
              className="paper-input w-full rounded-lg border-2 border-[var(--border)] p-2 text-xs font-bold"
            />
          </div>

          <button
            onClick={handleSendTest}
            className="paper-btn paper-btn-secondary w-full py-2.5 text-xs font-black shadow-[3px_3px_0px_var(--shadow)]"
          >
            Save Template &amp; Dispatch Test
          </button>
        </div>
      </div>
    </div>
  );
};
