/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  auth,
  googleProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
} from '../../lib/firebase';
import { sound } from '../../lib/sound';

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
    setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
      onClose();
    } catch (e: any) {
      console.warn('Google sign-in error:', e);
      setErrorMsg(e?.message || 'Google sign-in was cancelled or failed.');
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
      let msg = e?.message || 'Authentication failed.';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        msg = 'Incorrect email or password. Please try again.';
      } else if (code === 'auth/user-not-found') {
        msg = 'No account found with this email. You can create one below!';
      } else if (code === 'auth/email-already-in-use') {
        msg = 'An account already exists with this email. Please sign in instead.';
      } else if (code === 'auth/weak-password') {
        msg = 'Password should be at least 6 characters.';
      }
      setErrorMsg(msg);
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
      setErrorMsg(e?.message || 'Could not send reset email. Ensure the email address is valid.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in">
      <div className="relative w-full max-w-md rounded-2xl border-3 border-[#16120E] bg-[#FFF6E5] dark:bg-[#16120E] p-6 shadow-[8px_8px_0px_#16120E] dark:border-[#FFF6E5]">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 h-8 w-8 rounded-full border-2 border-[#16120E] bg-white dark:bg-[#221c16] text-[#16120E] dark:text-white font-bold flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 shadow-[2px_2px_0px_#16120E]"
        >
          ✕
        </button>

        <div className="text-center mb-5">
          <span className="sticker-badge bg-[#FFC83D] text-[#16120E] text-[11px] font-black uppercase">
            Host / Teacher Access
          </span>
          <h2 className="font-['Bricolage_Grotesque'] text-2xl font-black text-[#16120E] dark:text-white mt-1">
            {isRegister ? 'Create Host Account' : 'Sign In to QuizArena'}
          </h2>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            Manage your quizzes, launch live competitions, and view cohort analytics.
          </p>
        </div>

        {/* Feedback messages */}
        {errorMsg && (
          <div className="mb-4 rounded-xl border-2 border-[#EF4444] bg-red-100 dark:bg-red-950/60 p-2.5 text-xs font-bold text-red-700 dark:text-red-300">
            ⚠️ {errorMsg}
          </div>
        )}
        {infoMsg && (
          <div className="mb-4 rounded-xl border-2 border-[#10B981] bg-emerald-100 dark:bg-emerald-950/60 p-2.5 text-xs font-bold text-emerald-800 dark:text-emerald-300">
            {infoMsg}
          </div>
        )}

        {/* 1. Google One-Click Button */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full paper-btn bg-white hover:bg-gray-50 text-[#16120E] text-sm font-black py-2.5 flex items-center justify-center gap-2 mb-4"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
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
          <div className="grow border-t-2 border-[#16120E]/20 dark:border-white/20"></div>
          <span className="shrink mx-3 text-[11px] font-bold text-gray-500 uppercase">or with email</span>
          <div className="grow border-t-2 border-[#16120E]/20 dark:border-white/20"></div>
        </div>

        {/* 2. Email & Password Form */}
        <form onSubmit={handleEmailAuthSubmit} className="space-y-3 mt-2">
          <div>
            <label className="block text-xs font-black uppercase text-[#16120E] dark:text-white mb-1">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="teacher@school.edu"
              required
              className="w-full rounded-xl border-2 border-[#16120E] bg-white dark:bg-[#221c16] px-3 py-2 text-sm font-semibold text-[#16120E] dark:text-white shadow-[2px_2px_0px_#16120E] focus:outline-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-black uppercase text-[#16120E] dark:text-white">
                Password
              </label>
              {!isRegister && (
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-[11px] font-bold text-[#FF5A36] hover:underline"
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
              className="w-full rounded-xl border-2 border-[#16120E] bg-white dark:bg-[#221c16] px-3 py-2 text-sm font-semibold text-[#16120E] dark:text-white shadow-[2px_2px_0px_#16120E] focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full paper-btn bg-[#FF5A36] text-white font-extrabold text-sm py-2.5 mt-2"
          >
            {loading ? 'Please wait...' : isRegister ? 'Create Account' : 'Sign In with Email'}
          </button>
        </form>

        {/* Toggle Sign In / Create Account */}
        <div className="mt-4 pt-3 border-t border-[#16120E]/20 dark:border-white/20 text-center">
          <button
            type="button"
            onClick={() => {
              sound.playClick();
              setIsRegister(!isRegister);
              setErrorMsg(null);
              setInfoMsg(null);
            }}
            className="text-xs font-bold text-[#14B8A6] hover:underline cursor-pointer"
          >
            {isRegister ? 'Already have an account? Sign In' : 'Need an account? Create one here'}
          </button>
        </div>
      </div>
    </div>
  );
};
