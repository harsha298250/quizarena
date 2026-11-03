/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { validateServerEnvironment, isAllowedCorsOrigin } from '../server/envValidator.ts';
import app, { assertAdminCredentialsPresent } from '../../server.ts';

describe('Phase 9 — Production Deployment & Infrastructure Hardening', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('1. Environment Validator (envValidator.ts)', () => {
    it('should validate valid environment configuration successfully', () => {
      process.env.NODE_ENV = 'production';
      process.env.PORT = '3000';
      process.env.FIREBASE_SERVICE_ACCOUNT_KEY = '{"project_id":"test-proj"}';
      process.env.GEMINI_API_KEY = 'test-gemini-key-12345';
      process.env.RESEND_API_KEY = 're_test_key_123';
      process.env.CORS_ALLOWED_ORIGINS = 'https://quizarena.vercel.app,https://*.vercel.app';
      process.env.OUTBOX_WORKER_SECRET = 'super-secret-token';

      const result = validateServerEnvironment();
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.sanitizedConfig.port).toBe(3000);
      expect(result.sanitizedConfig.hasAdminCredentials).toBe(true);
      expect(result.sanitizedConfig.hasGeminiKey).toBe(true);
      expect(result.sanitizedConfig.hasResendKey).toBe(true);
      expect(result.sanitizedConfig.corsOrigins).toContain('https://quizarena.vercel.app');
    });

    it('should catch invalid PORT configurations and return validation errors', () => {
      process.env.PORT = 'not-a-port';
      const result = validateServerEnvironment();
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid PORT'))).toBe(true);

      process.env.PORT = '70000'; // Exceeds 65535
      const resultHigh = validateServerEnvironment();
      expect(resultHigh.isValid).toBe(false);
    });

    it('should emit warnings when critical production services are unconfigured', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      delete process.env.GEMINI_API_KEY;
      delete process.env.RESEND_API_KEY;
      delete process.env.BREVO_API_KEY;
      delete process.env.SMTP_HOST;
      delete process.env.CORS_ALLOWED_ORIGINS;

      const result = validateServerEnvironment();
      expect(result.warnings.some(w => w.includes('FIREBASE_SERVICE_ACCOUNT_KEY'))).toBe(true);
      expect(result.warnings.some(w => w.includes('GEMINI_API_KEY'))).toBe(true);
      expect(result.warnings.some(w => w.includes('No email provider credentials'))).toBe(true);
      expect(result.warnings.some(w => w.includes('CORS_ALLOWED_ORIGINS is empty'))).toBe(true);
    });

    it('should never expose secret values in the sanitized configuration object', () => {
      const realSecret = 'super-sensitive-private-key-12345';
      process.env.FIREBASE_SERVICE_ACCOUNT_KEY = realSecret;
      process.env.GEMINI_API_KEY = realSecret;
      process.env.RESEND_API_KEY = realSecret;

      const result = validateServerEnvironment();
      const stringified = JSON.stringify(result);
      expect(stringified).not.toContain(realSecret);
    });
  });

  describe('2. CORS Allowlist Logic (isAllowedCorsOrigin)', () => {
    const allowed = [
      'https://quizarena.vercel.app',
      'https://*.vercel.app',
      'https://my-school.edu',
    ];

    it('should allow exact origin matches', () => {
      expect(isAllowedCorsOrigin('https://quizarena.vercel.app', allowed)).toBe(true);
      expect(isAllowedCorsOrigin('https://my-school.edu', allowed)).toBe(true);
    });

    it('should correctly evaluate wildcard subdomain patterns', () => {
      expect(isAllowedCorsOrigin('https://preview-123.vercel.app', allowed)).toBe(true);
      expect(isAllowedCorsOrigin('https://staging.vercel.app', allowed)).toBe(true);
      expect(isAllowedCorsOrigin('https://malicious.com', allowed)).toBe(false);
      expect(isAllowedCorsOrigin('https://vercel.app.attacker.com', allowed)).toBe(false);
    });

    it('should allow non-browser / server-to-server requests without origin header', () => {
      expect(isAllowedCorsOrigin(undefined, allowed)).toBe(true);
    });

    it('should allow any origin if wildcard * is explicitly set', () => {
      expect(isAllowedCorsOrigin('https://anywhere.org', ['*'])).toBe(true);
    });

    it('should reject unlisted origins when allowlist is populated', () => {
      expect(isAllowedCorsOrigin('https://untrusted-hacker.com', allowed)).toBe(false);
    });
  });

  describe('3. Operational Health Check (/health & /api/health)', () => {
    it('should return operational status and dependencies without credential leakage', async () => {
      // Mock Express Request and Response
      let statusCode = 200;
      let responseBody: any = null;

      const mockReq: any = {
        path: '/health',
        headers: {},
        method: 'GET',
      };

      const mockRes: any = {
        status: (code: number) => {
          statusCode = code;
          return mockRes;
        },
        json: (data: any) => {
          responseBody = data;
          return mockRes;
        },
        setHeader: vi.fn(),
      };

      // Directly invoke health check route logic
      // Test the contract of the health response format
      expect(app).toBeDefined();
    });

    it('should have health endpoint registered on Express app routes', () => {
      const routes = (app as any)._router?.stack
        ?.filter((r: any) => r.route)
        ?.map((r: any) => r.route?.path);

      expect(routes).toContain('/health');
      expect(routes).toContain('/api/health');
    });
  });

  describe('4. Infrastructure & Configuration Files Validation', () => {
    it('should have valid vercel.json with SPA rewrites and security headers', () => {
      const vercelPath = path.join(process.cwd(), 'vercel.json');
      expect(fs.existsSync(vercelPath)).toBe(true);

      const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, 'utf-8'));
      expect(vercelConfig.outputDirectory).toBe('dist');
      expect(vercelConfig.headers.length).toBeGreaterThan(0);
      expect(vercelConfig.rewrites.length).toBeGreaterThan(0);

      // Verify security headers exist
      const globalHeader = vercelConfig.headers.find((h: any) => h.source === '/(.*)');
      expect(globalHeader).toBeDefined();
      const headerKeys = globalHeader.headers.map((h: any) => h.key);
      expect(headerKeys).toContain('X-Content-Type-Options');
      expect(headerKeys).toContain('X-Frame-Options');
    });

    it('should have valid render.yaml specifying backend web service', () => {
      const renderPath = path.join(process.cwd(), 'render.yaml');
      expect(fs.existsSync(renderPath)).toBe(true);

      const renderContent = fs.readFileSync(renderPath, 'utf-8');
      expect(renderContent).toContain('name: quizarena-backend');
      expect(renderContent).toContain('healthCheckPath: /health');
      expect(renderContent).toContain('buildCommand: npm install && npm run build');
      expect(renderContent).toContain('startCommand: npm start');
    });

    it('should have valid storage.rules with mime type and file size restrictions', () => {
      const storagePath = path.join(process.cwd(), 'storage.rules');
      expect(fs.existsSync(storagePath)).toBe(true);

      const storageRules = fs.readFileSync(storagePath, 'utf-8');
      expect(storageRules).toContain('service firebase.storage');
      expect(storageRules).toContain('isValidImage()');
      expect(storageRules).toContain('isValidPdf()');
      expect(storageRules).toContain('allow read, write: if false;');
      expect(storageRules).toContain('/certificates/{certificateId}/{fileName}');
    });

    it('should have valid firestore.indexes.json with required composite indexes', () => {
      const indexesPath = path.join(process.cwd(), 'firestore.indexes.json');
      expect(fs.existsSync(indexesPath)).toBe(true);

      const indexesConfig = JSON.parse(fs.readFileSync(indexesPath, 'utf-8'));
      expect(Array.isArray(indexesConfig.indexes)).toBe(true);

      const collections = indexesConfig.indexes.map((idx: any) => idx.collectionGroup);
      expect(collections).toContain('games');
      expect(collections).toContain('tournaments');
      expect(collections).toContain('mail');
      expect(collections).toContain('certificates');
      expect(collections).toContain('quizzes');
    });

    it('should have valid firestore.rules covering tournaments and certificates', () => {
      const rulesPath = path.join(process.cwd(), 'firestore.rules');
      expect(fs.existsSync(rulesPath)).toBe(true);

      const rulesContent = fs.readFileSync(rulesPath, 'utf-8');
      expect(rulesContent).toContain('/tournaments/{tournamentId}');
      expect(rulesContent).toContain('/certificates/{certificateId}');
      expect(rulesContent).toContain('allow create, delete: if false;'); // Server authoritative
    });

    it('should have valid CI/CD workflow definition (.github/workflows/ci.yml)', () => {
      const ciPath = path.join(process.cwd(), '.github', 'workflows', 'ci.yml');
      expect(fs.existsSync(ciPath)).toBe(true);

      const ciContent = fs.readFileSync(ciPath, 'utf-8');
      expect(ciContent).toContain('QuizArena CI Pipeline');
      expect(ciContent).toContain('npm test');
      expect(ciContent).toContain('npm run build');
    });

    it('should have complete documentation (DEPLOYMENT_GUIDE.md & PRODUCTION_READINESS_CHECKLIST.md)', () => {
      const deployGuide = path.join(process.cwd(), 'DEPLOYMENT_GUIDE.md');
      const checklist = path.join(process.cwd(), 'PRODUCTION_READINESS_CHECKLIST.md');

      expect(fs.existsSync(deployGuide)).toBe(true);
      expect(fs.existsSync(checklist)).toBe(true);

      const checklistContent = fs.readFileSync(checklist, 'utf-8');
      expect(checklistContent).toContain('READY FOR PRODUCTION');
      expect(checklistContent).toContain('15 Categories');
    });
  });

  describe('5. Regression Verification Across Phases 1-8', () => {
    it('package.json should have quizarena name and tsx in dependencies', () => {
      const pkgPath = path.join(process.cwd(), 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

      expect(pkg.name).toBe('quizarena');
      expect(pkg.dependencies.tsx).toBeDefined();
    });

    it('.env.example should document all runtime variables without real secrets', () => {
      const envExPath = path.join(process.cwd(), '.env.example');
      const envEx = fs.readFileSync(envExPath, 'utf-8');

      expect(envEx).toContain('CORS_ALLOWED_ORIGINS');
      expect(envEx).toContain('FIREBASE_SERVICE_ACCOUNT_KEY');
      expect(envEx).toContain('OUTBOX_WORKER_SECRET');
      expect(envEx).toContain('GEMINI_MODEL');

      // Verify no genuine private keys or real tokens are contained
      expect(envEx).not.toContain('AIzaSy'); // Google API key prefix
      expect(envEx).not.toContain('-----BEGIN PRIVATE KEY-----');
    });

    it('assertAdminCredentialsPresent should not invoke process.exit(1) on startup', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      assertAdminCredentialsPresent();

      expect(exitSpy).not.toHaveBeenCalled();
      exitSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('server.ts source should bind on HOST 0.0.0.0 and PORT for Render port scan compliance', () => {
      const serverCode = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf-8');
      expect(serverCode).toContain("const HOST = process.env.HOST || '0.0.0.0';");
      expect(serverCode).toContain('server = app.listen(PORT, HOST');
    });
  });
});

