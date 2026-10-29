/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  auth,
  googleProvider,
  signInWithPopup,
  signInWithRedirect,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
} from '../../lib/firebase';
import { sound } from '../../lib/sound';

export function getAuthErrorMessage(code: string, fallbackMessage?: string): string {
  switch (code) {
    case 'auth/popup-blocked':
      return "Your browser blocked the sign-in popup. Automatically falling back to redirect sign-in. To allow popups in the future, click the popup blocker icon in your browser's address bar and select 'Always allow popups for QuizArena'.";
    case 'auth/popup-closed-by-user':
      return 'The Google sign-in window was closed before completing. Please try again.';
    case 'auth/cancelled-popup-request':
      return 'Another sign-in attempt is already active. Please finish or close the other window.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address (e.g. teacher@school.edu).';
    case 'auth/user-disabled':
      return 'This user account has been disabled. Please contact your administrator.';
    case 'auth/user-not-found':
      return 'No account was found with this email. Click "Need an account? Create one here" below to sign up.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password. Please verify your credentials or click "Forgot password?" to reset it.';
    case 'auth/email-already-in-use':
      return 'An account already exists with this email address. Please switch to Sign In or reset your password.';
    case 'auth/weak-password':
      return 'Password is too short or weak. Please enter at least 6 characters with letters and numbers.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is currently disabled in your Firebase console.';
    case 'auth/network-request-failed':
      return 'Network connection lost. Please check your internet connection and try again.';
    case 'auth/too-many-requests':
      return 'Too many unsuccessful attempts. For your security, please wait a moment or reset your password.';
    case 'auth/requires-recent-login':
      return 'For your security, please log out and sign in again before modifying account settings.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email using a different sign-in provider.';
    case 'auth/expired-action-code':
      return 'The password reset or verification link has expired. Please request a new one.';
    case 'auth/invalid-action-code':
      return 'The password reset link is invalid or has already been used.';
    default:
      return fallbackMessage || 'Authentication failed. Please verify your credentials and try again.';
  }
}

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const [isRegister, setIsRegister] = useState<boolean>(false);
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleGoogleSignIn = async () => {
    sound.playClick();
    setErrorMsg(null);
    setInfoMsg(null);
    setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
      onClose();
    } catch (e: any) {
      const code = e?.code || '';
      console.warn('Google sign-in error:', code, e);
      if (code === 'auth/popup-blocked') {
        setInfoMsg(
          "Your browser blocked the popup. Redirecting you to Google sign-in... Tip: Click the popup icon in your URL address bar to enable popups for instant sign-ins."
        );
        try {
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirectErr: any) {
          setErrorMsg(getAuthErrorMessage(redirectErr?.code, redirectErr?.message));
        }
      } else {
        setErrorMsg(getAuthErrorMessage(code, e?.message));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    sound.playClick();
    setErrorMsg(null);
    setInfoMsg(null);

    if (!email || !password) {
      setErrorMsg('Please enter both email and password.');
      return;
    }

    setLoading(true);
    try {
      if (isRegister) {
        const userCred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (userCred?.user) {
          try {
            await sendEmailVerification(userCred.user);
            setInfoMsg('Account created! A verification email has been dispatched to your inbox.');
          } catch (verifErr) {
            console.warn('Could not dispatch verification email:', verifErr);
          }
        }
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
      onClose();
    } catch (e: any) {
      const code = e?.code || '';
      setErrorMsg(getAuthErrorMessage(code, e?.message));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    sound.playClick();
    setErrorMsg(null);
    setInfoMsg(null);

    if (!email) {
      setErrorMsg('Enter your email address above to receive a password reset link.');
      return;
    }

    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setInfoMsg(`✓ Password reset email sent to ${email.trim()}! Please check your inbox.`);
    } catch (e: any) {
      const code = e?.code || '';
      setErrorMsg(getAuthErrorMessage(code, e?.message || 'Could not send reset email. Ensure the email address is valid.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in">
      <div className="relative w-full max-w-md paper-modal p-6 shadow-[8px_8px_0px_var(--shadow)]">
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close authentication modal"
          className="absolute top-4 right-4 h-8 w-8 rounded-full border-2 border-[var(--border)] bg-[var(--surface)] text-[var(--text)] font-bold flex items-center justify-center hover:bg-[var(--surface-2)] shadow-[2px_2px_0px_var(--shadow)]"
        >
          ✕
        </button>

        <div className="text-center mb-5">
          <span className="sticker-badge sticker-badge-sunshine text-[11px] font-black uppercase">
            Host / Teacher Access
          </span>
          <h2 className="font-['Bricolage_Grotesque'] text-2xl font-black text-[var(--text)] mt-1">
            {isRegister ? 'Create Host Account' : 'Sign In to QuizArena'}
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Manage your quizzes, launch live competitions, and view cohort analytics.
          </p>
        </div>

        {/* Feedback messages */}
        {errorMsg && (
          <div className="mb-4 rounded-xl border-2 border-red-600 bg-red-100 dark:bg-red-950/60 p-2.5 text-xs font-bold text-red-800 dark:text-red-200">
            ⚠️ {errorMsg}
          </div>
        )}
        {infoMsg && (
          <div className="mb-4 rounded-xl border-2 border-[var(--ok)] bg-emerald-100 dark:bg-emerald-950/60 p-2.5 text-xs font-bold text-emerald-900 dark:text-emerald-200">
            {infoMsg}
          </div>
        )}

        {/* 1. Google One-Click Button */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full paper-btn bg-[var(--surface)] hover:bg-[var(--surface-2)] text-[var(--text)] text-sm font-black py-2.5 flex items-center justify-center gap-2 mb-4"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          Continue with Google
        </button>

        <div className="relative flex py-2 items-center">
          <div className="grow border-t-2 border-[var(--border)]/20"></div>
          <span className="shrink mx-3 text-[11px] font-bold text-[var(--text-muted)] uppercase">or with email</span>
          <div className="grow border-t-2 border-[var(--border)]/20"></div>
        </div>

        {/* 2. Email & Password Form */}
        <form onSubmit={handleEmailAuthSubmit} className="space-y-3 mt-2">
          <div>
            <label className="block text-xs font-black uppercase text-[var(--text)] mb-1">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="teacher@school.edu"
              required
              className="w-full rounded-xl border-2 border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-[var(--text)] shadow-[2px_2px_0px_var(--shadow)] focus:outline-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-black uppercase text-[var(--text)]">
                Password
              </label>
              {!isRegister && (
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-[11px] font-bold text-[var(--accent)] hover:underline"
                >
                  Forgot password?
                </button>
              )}
            </div>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full rounded-xl border-2 border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-[var(--text)] shadow-[2px_2px_0px_var(--shadow)] focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full paper-btn paper-btn-primary font-extrabold text-sm py-2.5 mt-2"
          >
            {loading ? 'Please wait...' : isRegister ? 'Create Account' : 'Sign In with Email'}
          </button>
        </form>

        {/* Toggle Sign In / Create Account */}
        <div className="mt-4 pt-3 border-t border-[var(--border)]/20 text-center">
          <button
            type="button"
            onClick={() => {
              sound.playClick();
              setIsRegister(!isRegister);
              setErrorMsg(null);
              setInfoMsg(null);
            }}
            className="text-xs font-bold text-[var(--ok)] dark:text-[var(--accent-2)] hover:underline cursor-pointer"
          >
            {isRegister ? 'Already have an account? Sign In' : 'Need an account? Create one here'}
          </button>
        </div>
      </div>
    </div>
  );
};
