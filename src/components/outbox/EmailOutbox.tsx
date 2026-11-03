/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { MailQueueItem } from '../../types/quiz';
import {
  getLocalOutboxEmails,
  updateOutboxItemStatus,
  queueResultEmail,
  resendOutboxEmail,
  sendTestEmailViaApi,
  checkSmtpHealthViaApi,
} from '../../services/emailService';
import { auth } from '../../lib/firebase';
import { sound } from '../../lib/sound';

export const EmailOutbox: React.FC = () => {
  const [emails, setEmails] = useState<MailQueueItem[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<MailQueueItem | null>(null);
  const [isResending, setIsResending] = useState<boolean>(false);
  const [isSendingTest, setIsSendingTest] = useState<boolean>(false);
  const [testErrorMessage, setTestErrorMessage] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<{
    checking: boolean;
    connected: boolean | null;
    provider?: string;
    fromAddress?: string;
    error?: string;
    host?: string;
  }>({ checking: true, connected: null });

  const [templateName, setTemplateName] = useState<string>('Standard Student Result');
  const [templateHtml, setTemplateHtml] = useState<string>(
    'Great job {{name}}! You scored {{score}} points and secured Rank #{{rank}} in the arena!'
  );
  const [testEmailTo, setTestEmailTo] = useState<string>(auth.currentUser?.email || '');

  const dispatchTimeoutRef = useRef<any>(null);

  useEffect(() => {
    loadEmails();
    runSmtpHealthCheck();
    if (auth.currentUser?.email) {
      setTestEmailTo(auth.currentUser.email);
    }
  }, []);

  const runSmtpHealthCheck = async () => {
    setEmailStatus(prev => ({ ...prev, checking: true }));
    try {
      const res = await checkSmtpHealthViaApi();
      setEmailStatus({
        checking: false,
        connected: res.connected,
        provider: res.provider,
        fromAddress: res.fromAddress,
        host: res.host,
        error: res.error,
      });
    } catch (e: any) {
      setEmailStatus({
        checking: false,
        connected: false,
        error: e.message || String(e),
      });
    }
  };

  const loadEmails = () => {
    const list = getLocalOutboxEmails();
    // Permanently purge all seeded sample rows (Alex Student, teacher@quizarena.app, sample domains)
    const cleaned = list.filter(
      item =>
        item.to !== 'teacher@quizarena.app' &&
        item.to !== 'student@example.com' &&
        item.recipientName !== 'Sample Teacher' &&
        item.recipientName !== 'Alex Student' &&
        !item.to.endsWith('@example.com')
    );
    if (cleaned.length !== list.length) {
      try {
        localStorage.setItem('quizarena_local_mail_outbox', JSON.stringify(cleaned));
      } catch (e) {}
    }
    setEmails(cleaned);
    if (cleaned.length > 0) {
      setSelectedEmail(prev => (prev ? cleaned.find(e => e.id === prev.id) || cleaned[0] : cleaned[0]));
    } else {
      setSelectedEmail(null);
    }
  };

  const handleResend = async (id: string) => {
    sound.playClick();
    setIsResending(true);
    setTestErrorMessage(null);

    const safetyTimer = setTimeout(() => {
      setIsResending(false);
      setTestErrorMessage('Resend request timed out after 20 seconds. Check SMTP credentials.');
    }, 20000);

    try {
      const success = await resendOutboxEmail(id);
      clearTimeout(safetyTimer);
      loadEmails();
      if (success) {
        alert('Email resent successfully via SMTP server!');
      } else {
        const item = getLocalOutboxEmails().find(e => e.id === id);
        setTestErrorMessage(item?.errorMessage || 'Resend failed. Check SMTP configuration.');
      }
    } catch (e: any) {
      clearTimeout(safetyTimer);
      setTestErrorMessage('Error during resend: ' + (e.message || String(e)));
    } finally {
      setIsResending(false);
    }
  };

  const handleTestResendDeliverability = async () => {
    sound.playClick();
    setTestErrorMessage(null);
    setIsSendingTest(true);

    const sinkTo = 'delivered@resend.dev';
    const recipientName = 'Resend Deliverability Test Sink';
    const mailItem = {
      to: sinkTo,
      recipientName,
      subject: `QuizArena Resend API Delivery Verification [${new Date().toLocaleTimeString()}]`,
      htmlContent: `<div style="font-family:sans-serif;padding:24px;border:3px solid #16120E;border-radius:12px;background:#FFF6E5;">
        <h2 style="color:#FF5A36;margin-top:0;">QuizArena Resend API Verified</h2>
        <p style="font-size:15px;line-height:1.5;">This automated test email verifies that QuizArena is communicating with the Resend HTTPS API (Port 443) using an authorized verified sender address.</p>
        <p style="font-size:13px;color:#333;"><strong>Sender:</strong> ${emailStatus.fromAddress || 'QuizArena <onboarding@resend.dev>'}</p>
        <p style="font-size:13px;color:#333;"><strong>Target Sink:</strong> ${sinkTo}</p>
        <hr style="border:none;border-top:1px dashed #ccc;margin:20px 0;" />
        <p style="font-size:12px;color:#666;">Official deliverability verification sink provided by Resend.</p>
      </div>`,
      status: 'queued' as const,
      metadata: {
        gameId: 'test_dispatch',
        quizTitle: 'Resend API Sink Verification',
        score: 10000,
        rank: 1,
        accuracy: 1.0,
      },
    };

    const mailId = await queueResultEmail(mailItem);
    loadEmails();

    try {
      const res = await sendTestEmailViaApi({
        to: sinkTo,
        recipientName,
        subject: mailItem.subject,
        htmlContent: mailItem.htmlContent,
      });

      if (res.success && res.status === 'sent') {
        updateOutboxItemStatus(mailId, 'sent');
        alert(`✓ Resend delivery test SUCCESS! Test message sent to ${sinkTo} via Resend HTTPS API.`);
      } else {
        const errorDesc = res.error || 'Resend delivery failed';
        updateOutboxItemStatus(mailId, 'failed', errorDesc);
        setTestErrorMessage(`Resend Test Failed: ${errorDesc}`);
      }
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      updateOutboxItemStatus(mailId, 'failed', errMsg);
      setTestErrorMessage(`Resend Test Error: ${errMsg}`);
    } finally {
      setIsSendingTest(false);
      loadEmails();
    }
  };

  const handleSendTest = async () => {
    sound.playClick();
    setTestErrorMessage(null);

    const hostUser = auth.currentUser;
    const destination = (testEmailTo || hostUser?.email || '').trim();

    if (!destination) {
      setTestErrorMessage('Please sign in or enter your verified host email address.');
      return;
    }

    setIsSendingTest(true);

    // 20s safety timeout to strictly prevent stuck "Dispatching..." state
    if (dispatchTimeoutRef.current) clearTimeout(dispatchTimeoutRef.current);
    dispatchTimeoutRef.current = setTimeout(() => {
      setIsSendingTest(false);
      setTestErrorMessage('Dispatch timed out after 20 seconds. Please check email provider settings.');
    }, 20000);

    const recipientName = hostUser?.displayName || 'Host Administrator';
    const rendered = templateHtml
      .replace('{{name}}', recipientName)
      .replace('{{score}}', '9200')
      .replace('{{rank}}', '1');

    const mailItem = {
      to: destination,
      recipientName,
      subject: `QuizArena Result Test Preview: ${templateName}`,
      htmlContent: `<div style="font-family:sans-serif;padding:24px;border:3px solid #16120E;border-radius:12px;background:#FFF6E5;">
        <h2 style="color:#FF5A36;margin-top:0;">QuizArena Verified Result Dispatch</h2>
        <p style="font-size:15px;line-height:1.5;">${rendered}</p>
        <hr style="border:none;border-top:1px dashed #ccc;margin:20px 0;" />
        <p style="font-size:12px;color:#666;">Authenticated test email dispatched via QuizArena delivery pipeline to verified host: ${destination}</p>
      </div>`,
      status: 'queued' as const,
      metadata: {
        gameId: 'test_dispatch',
        quizTitle: 'Live Arena Test Dispatch',
        score: 9200,
        rank: 1,
        accuracy: 0.95,
      },
    };

    const mailId = await queueResultEmail(mailItem);
    loadEmails();

    try {
      const res = await sendTestEmailViaApi({
        to: destination,
        recipientName,
        subject: mailItem.subject,
        htmlContent: mailItem.htmlContent,
      });

      if (dispatchTimeoutRef.current) clearTimeout(dispatchTimeoutRef.current);

      if (res.success && res.status === 'sent') {
        updateOutboxItemStatus(mailId, 'sent');
        alert(`Test email successfully dispatched to ${destination} via ${res.provider || 'configured provider'}!`);
      } else {
        const errorDesc = res.error || 'Delivery failed';
        updateOutboxItemStatus(mailId, 'failed', errorDesc);
        setTestErrorMessage(`Dispatch failed: ${errorDesc}`);
      }
    } catch (err: any) {
      if (dispatchTimeoutRef.current) clearTimeout(dispatchTimeoutRef.current);
      const errMsg = err instanceof Error ? err.message : String(err);
      updateOutboxItemStatus(mailId, 'failed', errMsg);
      setTestErrorMessage(`Dispatch error: ${errMsg}`);
    } finally {
      setIsSendingTest(false);
      loadEmails();
    }
  };

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 space-y-6">
      {/* Header Banner */}
      <div className="paper-card p-6 bg-[var(--bg-page)] border-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="sticker-badge bg-[var(--ok)] text-white text-xs">
              Communication Layer
            </span>
            {/* Provider-Aware Health Pill */}
            {emailStatus.checking ? (
              <span className="sticker-badge bg-[var(--surface-2)] text-[var(--text-muted)] text-[10px] animate-pulse">
                Checking Email Provider...
              </span>
            ) : emailStatus.connected ? (
              <span
                className="sticker-badge sticker-badge-ok text-[10px] flex items-center gap-1"
                title={`Host: ${emailStatus.host || 'Connected'}`}
              >
                ● {emailStatus.provider === 'resend'
                  ? 'Resend API Connected (HTTPS Port 443)'
                  : emailStatus.provider === 'brevo'
                  ? 'Brevo API Connected'
                  : 'SMTP Connected'}
              </span>
            ) : (
              <span
                className="sticker-badge sticker-badge-tomato text-[10px] flex items-center gap-1"
                title={emailStatus.error || 'Failed'}
              >
                ✕ {emailStatus.provider === 'resend'
                  ? `Resend API Error: ${emailStatus.error || 'Check RESEND_API_KEY'}`
                  : emailStatus.provider === 'smtp'
                  ? `SMTP Failed: ${emailStatus.error || 'Not Configured'}`
                  : `Email Provider: ${emailStatus.error || 'Not Configured'}`}
              </span>
            )}

            {/* From Address Pill */}
            {emailStatus.fromAddress && (
              <span
                className="sticker-badge bg-[var(--surface-2)] text-[var(--text)] text-[10px]"
                title="Authoritative Sender Address"
              >
                From: {emailStatus.fromAddress}
              </span>
            )}

            <button
              onClick={runSmtpHealthCheck}
              className="text-[11px] font-bold text-[var(--accent)] hover:underline ml-1"
              title="Re-verify Email Provider Connection"
            >
              Verify
            </button>
          </div>
          <h1 className="font-['Bricolage_Grotesque'] text-2xl sm:text-3xl font-black text-[var(--text)]">
            Result Email Outbox & Template Editor
          </h1>
          <p className="text-xs font-semibold text-[var(--text-muted)] mt-1">
            Dispatches verified cohort reports to teachers and individual performance breakdowns to students via HTTPS API (Resend) or authenticated SMTP.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Dedicated Resend Deliverability Test Button */}
          <button
            id="btnTestResendDeliverability"
            onClick={handleTestResendDeliverability}
            disabled={isSendingTest}
            className="paper-btn paper-btn-sm bg-[var(--accent-2-bg)] text-[var(--text)] text-xs font-bold disabled:opacity-50"
            title="Send test email to Resend official deliverability sink (delivered@resend.dev)"
          >
            {isSendingTest ? '⏳ Testing...' : '⚡ Test Resend (delivered@resend.dev)'}
          </button>

          {/* Standard Host Test Button */}
          <button
            id="btnQueueTestEmail"
            onClick={handleSendTest}
            disabled={isSendingTest}
            className="paper-btn paper-btn-sm paper-btn-primary text-xs font-bold disabled:opacity-50"
          >
            {isSendingTest ? '✉️ Dispatching...' : '✉️ Send Test Email'}
          </button>
        </div>
      </div>

      {testErrorMessage && (
        <div className="p-3 bg-red-100 dark:bg-red-950/70 border-2 border-red-500 rounded-xl text-xs font-bold text-red-800 dark:text-red-200 flex items-center justify-between gap-2 animate-fadeIn">
          <span>⚠️ {testErrorMessage}</span>
          <button
            onClick={() => setTestErrorMessage(null)}
            className="text-xs font-black text-red-600 dark:text-red-400 hover:underline shrink-0"
          >
            ✕ Dismiss
          </button>
        </div>
      )}

      {/* Resend Domain Verification Guidance */}
      {((testErrorMessage && /403|domain|verified/i.test(testErrorMessage)) ||
        (emailStatus.error && /403|domain|verified/i.test(emailStatus.error))) && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-500 rounded-xl text-xs space-y-1">
          <div className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
            <span>💡 Resend Sender Verification Diagnostic:</span>
          </div>
          <p className="text-amber-800 dark:text-amber-300">
            Resend requires sending from a verified domain. For testing with free accounts, use sender <code className="px-1 py-0.5 rounded bg-white dark:bg-black font-bold">QuizArena &lt;onboarding@resend.dev&gt;</code> and send either to your registered Resend account email or to <code className="px-1 py-0.5 rounded bg-white dark:bg-black font-bold">delivered@resend.dev</code>. To send to arbitrary students, verify your domain in the Resend Dashboard at <a href="https://resend.com/domains" target="_blank" rel="noopener noreferrer" className="underline font-bold">resend.com/domains</a>.
          </p>
        </div>
      )}

      {!emailStatus.connected && !emailStatus.checking && (
        <div className="p-3 bg-[var(--surface-2)] border-2 border-[var(--border)] rounded-xl text-xs space-y-1">
          <div className="font-bold text-[var(--text)] flex items-center gap-1.5">
            <span>ℹ️ Cloud Host SMTP Setup (Render / Free Tier):</span>
          </div>
          <p className="text-[var(--text-muted)]">
            Render Free tier blocks outbound SMTP ports 25, 465, and 587. To send emails reliably on Render Free tier, add <code className="px-1 py-0.5 rounded bg-[var(--surface)] text-[var(--accent)] font-bold">RESEND_API_KEY</code> or <code className="px-1 py-0.5 rounded bg-[var(--surface)] text-[var(--accent)] font-bold">BREVO_API_KEY</code> in Render Environment Variables (sends over HTTPS port 443 with 3,000 free emails/mo). Gmail SMTP (<code className="px-1 py-0.5 rounded bg-[var(--surface)] font-bold">smtp.gmail.com:465</code>) works when running locally or on Render Starter.
          </p>
        </div>
      )}

      {/* Main Grid: Outbox list + Live HTML preview + Template editor */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Email queue records */}
        <div className="paper-card p-5 bg-[var(--surface)] space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-['Bricolage_Grotesque'] font-black text-lg text-[var(--text)]">
              Outgoing Queue ({emails.length})
            </h2>
            <button id="btnRefreshOutbox" onClick={loadEmails} className="text-xs text-[var(--ok)] font-bold hover:underline">
              Refresh
            </button>
          </div>

          {emails.length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--text-muted)] font-semibold">
              No emails queued yet. Finish a live game or click "Send Test Email" to test the pipeline!
            </div>
          ) : (
            <div id="outboxItemList" className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
              {emails.map(m => {
                const isSelected = selectedEmail?.id === m.id;
                return (
                  <div
                    key={m.id}
                    data-testid={`outbox-item-${m.id}`}
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
                    <div className="text-[10px] text-[var(--text-muted)] mt-1 font-mono-code flex items-center justify-between">
                      <span>Rank #{m.metadata?.rank} • {m.metadata?.score?.toLocaleString()} pts</span>
                      {m.errorMessage && <span className="text-red-500 font-bold truncate max-w-[120px]">{m.errorMessage}</span>}
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
                id="btnResendEmail"
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
                Subject: <strong className="text-[var(--text)]">{selectedEmail.subject}</strong><br />
                Status: <strong className={selectedEmail.status === 'sent' ? 'text-green-600' : selectedEmail.status === 'failed' ? 'text-red-600' : 'text-yellow-600'}>
                  {selectedEmail.status.toUpperCase()}
                </strong>
                {selectedEmail.errorMessage && (
                  <div className="mt-1 p-2 rounded bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 text-xs font-mono">
                    SMTP Error: {selectedEmail.errorMessage}
                  </div>
                )}
              </div>

              <div id="emailHtmlPreviewContainer" className="rounded-xl border-2 border-[var(--border)] p-4 bg-white text-black max-h-[380px] overflow-y-auto overflow-x-auto">
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
            <label htmlFor="inputTemplateName" className="text-xs font-bold text-[var(--text-muted)] uppercase">Template Name</label>
            <input
              id="inputTemplateName"
              type="text"
              value={templateName}
              onChange={e => setTemplateName(e.target.value)}
              className="paper-input w-full rounded-lg border-2 border-[var(--border)] p-2 text-xs font-bold"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="textareaTemplateBody" className="text-xs font-bold text-[var(--text-muted)] uppercase">
              Template Body (Use: {'{{name}}'}, {'{{score}}'}, {'{{rank}}'})
            </label>
            <textarea
              id="textareaTemplateBody"
              rows={4}
              value={templateHtml}
              onChange={e => setTemplateHtml(e.target.value)}
              className="paper-input w-full rounded-lg border-2 border-[var(--border)] p-2 text-xs font-mono-code"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="inputTestEmailTo" className="text-xs font-bold text-[var(--text-muted)] uppercase">Host Test Address (Verified Account)</label>
            <input
              id="inputTestEmailTo"
              type="email"
              value={testEmailTo}
              onChange={e => setTestEmailTo(e.target.value)}
              placeholder="host@school.edu"
              className="paper-input w-full rounded-lg border-2 border-[var(--border)] p-2 text-xs font-bold"
            />
          </div>

          <button
            id="btnDispatchCustomTest"
            onClick={handleSendTest}
            disabled={isSendingTest}
            className="paper-btn paper-btn-secondary w-full py-2.5 text-xs font-black shadow-[3px_3px_0px_var(--shadow)] disabled:opacity-50"
          >
            {isSendingTest ? 'Dispatching...' : 'Save Template & Dispatch Test'}
          </button>
        </div>
      </div>
    </div>
  );
};
