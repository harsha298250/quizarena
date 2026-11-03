/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface EnvValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  sanitizedConfig: {
    nodeEnv: string;
    port: number;
    hasAdminCredentials: boolean;
    hasGeminiKey: boolean;
    geminiModel: string;
    hasSmtpConfig: boolean;
    hasResendKey: boolean;
    hasBrevoKey: boolean;
    corsOrigins: string[];
    hasWorkerSecret: boolean;
  };
}

/**
 * Validates runtime environment configuration without leaking credentials.
 */
export function validateServerEnvironment(): EnvValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const nodeEnv = process.env.NODE_ENV || 'development';
  const rawPort = process.env.PORT || (nodeEnv === 'production' ? '3000' : '3001');
  const port = parseInt(rawPort, 10);

  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push(`Invalid PORT configuration: "${rawPort}". Must be a number between 1 and 65535.`);
  }

  // Check Firebase credentials
  const hasServiceAccount = Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  );

  if (!hasServiceAccount && nodeEnv === 'production') {
    warnings.push(
      'FIREBASE_SERVICE_ACCOUNT_KEY is not configured. Running in unauthenticated Admin mode. ' +
      'Privileged Firestore writes and token verification may fail.'
    );
  }

  // Check Gemini Key
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY');
  const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

  if (!hasGeminiKey) {
    warnings.push('GEMINI_API_KEY is missing or using placeholder value. AI Quiz Generation features will operate with fallbacks.');
  }

  // Check Email Providers
  const hasSmtpConfig = Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
  const hasResendKey = Boolean(process.env.RESEND_API_KEY);
  const hasBrevoKey = Boolean(process.env.BREVO_API_KEY || (process.env.BREVO_USER && process.env.BREVO_KEY));

  if (!hasSmtpConfig && !hasResendKey && !hasBrevoKey && nodeEnv === 'production') {
    warnings.push('No email provider credentials (SMTP, Resend, or Brevo) configured. Outbox notifications will be queued but cannot dispatch.');
  }

  // Check CORS Origins
  const rawCors = process.env.CORS_ALLOWED_ORIGINS || '';
  const corsOrigins = rawCors
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  if (nodeEnv === 'production' && corsOrigins.length === 0) {
    warnings.push('CORS_ALLOWED_ORIGINS is empty in production. Standardizing on same-origin only.');
  }

  // Check Worker Secret
  const hasWorkerSecret = Boolean(process.env.OUTBOX_WORKER_SECRET);
  if (!hasWorkerSecret && nodeEnv === 'production') {
    warnings.push('OUTBOX_WORKER_SECRET is not set. /api/outbox/process endpoint requires admin token authentication only.');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    sanitizedConfig: {
      nodeEnv,
      port,
      hasAdminCredentials: hasServiceAccount,
      hasGeminiKey,
      geminiModel,
      hasSmtpConfig,
      hasResendKey,
      hasBrevoKey,
      corsOrigins,
      hasWorkerSecret,
    },
  };
}

/**
 * Checks whether an incoming origin matches the production CORS allowlist.
 */
export function isAllowedCorsOrigin(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return true; // Server-to-server or non-browser request
  if (allowedOrigins.length === 0) return false;
  if (allowedOrigins.includes('*')) return true;

  return allowedOrigins.some(allowed => {
    if (allowed === origin) return true;
    // Allow subdomain wildcards, e.g. https://*.vercel.app
    if (allowed.includes('*')) {
      const regexStr = '^' + allowed.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$';
      return new RegExp(regexStr).test(origin);
    }
    return false;
  });
}

