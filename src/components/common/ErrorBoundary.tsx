/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[QuizArena ErrorBoundary caught an unhandled error]:', error, errorInfo);
    this.setState({ errorInfo });
  }

  public handleRetry = () => {
    this.state = { hasError: false, error: null, errorInfo: null };
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="mx-auto max-w-xl p-6 my-8 animate-fadeIn" data-testid="error-boundary-fallback">
          <div className="paper-card p-6 sm:p-8 border-3 border-[var(--danger,red)] bg-[var(--surface)] text-center space-y-4 shadow-[6px_6px_0px_var(--shadow)]">
            <div className="text-4xl animate-bounce">⚡</div>
            <h2 className="font-['Bricolage_Grotesque'] text-2xl font-black text-[var(--text)]">
              {this.props.fallbackTitle || 'Something went wrong, reconnecting...'}
            </h2>
            <p className="text-sm font-semibold text-[var(--text-muted)] max-w-md mx-auto leading-relaxed">
              We encountered a temporary rendering or sync interruption. Your score and session state are safely preserved on the server.
            </p>
            {this.state.error && (
              <div className="p-3 bg-[var(--surface-2)] rounded-xl border border-[var(--border)] text-xs font-mono font-bold text-[var(--text-muted)] text-left overflow-x-auto max-h-32">
                {this.state.error.message}
              </div>
            )}
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={this.handleRetry}
                className="paper-btn paper-btn-primary px-6 py-2.5 font-black text-sm shadow-[3px_3px_0px_var(--shadow)]"
              >
                🔄 Try Reconnecting
              </button>
              <button
                onClick={() => window.location.reload()}
                className="paper-btn px-6 py-2.5 font-bold text-sm border-2 border-[var(--border)]"
              >
                Full Reload
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
