/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * QuizArena — Phase 8 Workstream B: Upload Security & File Validation Test Suite
 */

import { describe, it, expect } from 'vitest';
import {
  validateUploadFile,
  detectBinaryMimeType,
  containsActiveScriptContent,
  sanitizeFilename,
  generateSafeStoragePath,
  assertUploadAuthorization,
} from '../server/uploadSecurity.ts';

describe('Phase 8 — Upload Security and Binary File Validation Suite', () => {
  // Fixtures: Valid binary headers
  const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const validPng = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG signature
    Buffer.from([0x00, 0x00, 0x00, 0x0d]), // Chunk length (13)
    Buffer.from('IHDR', 'ascii'), // Chunk type
    Buffer.alloc(13, 0), // IHDR data
    Buffer.from([0x00, 0x00, 0x00, 0x00]), // CRC
  ]);
  const validWebp = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x20, 0x00, 0x00, 0x00]), // size
    Buffer.from('WEBP', 'ascii'),
    Buffer.from('VP8 ', 'ascii'),
    Buffer.alloc(16, 0),
  ]);
  const validGif = Buffer.concat([
    Buffer.from('GIF89a', 'ascii'),
    Buffer.alloc(10, 0),
  ]);
  const validPdf = Buffer.concat([
    Buffer.from('%PDF-1.7\n', 'ascii'),
    Buffer.alloc(32, 0x20),
  ]);

  describe('1. Valid File Formats & Signatures', () => {
    it('accepts valid JPEG with matching extension and declared MIME', () => {
      const res = validateUploadFile(validJpeg, 'banner.jpg', 'image/jpeg', { category: 'quizzes' });
      expect(res.valid).toBe(true);
      expect(res.detectedMime).toBe('image/jpeg');
      expect(res.detectedExt).toBe('jpg');
      expect(res.safeStoragePath).toContain('quizzes/');
    });

    it('accepts valid PNG with proper IHDR chunk and declared MIME', () => {
      const res = validateUploadFile(validPng, 'avatar.png', 'image/png', { category: 'avatars' });
      expect(res.valid).toBe(true);
      expect(res.detectedMime).toBe('image/png');
      expect(res.detectedExt).toBe('png');
    });

    it('accepts valid WebP file with matching RIFF/WEBP signature', () => {
      const res = validateUploadFile(validWebp, 'photo.webp', 'image/webp', { category: 'tournaments' });
      expect(res.valid).toBe(true);
      expect(res.detectedMime).toBe('image/webp');
    });

    it('accepts valid GIF for quizzes where supported', () => {
      const res = validateUploadFile(validGif, 'animation.gif', 'image/gif', { category: 'quizzes' });
      expect(res.valid).toBe(true);
      expect(res.detectedMime).toBe('image/gif');
    });

    it('accepts valid PDF for certificates category', () => {
      const res = validateUploadFile(validPdf, 'award.pdf', 'application/pdf', { category: 'certificates' });
      expect(res.valid).toBe(true);
      expect(res.detectedMime).toBe('application/pdf');
    });
  });

  describe('2. Anti-Spoofing & Signature Integrity', () => {
    it('rejects spoofed MIME: declared image/png, but binary is JPEG', () => {
      const res = validateUploadFile(validJpeg, 'fake.png', 'image/png', { category: 'quizzes' });
      expect(res.valid).toBe(false);
      expect(res.errorCode).toBe('SPOOFED_MIME_TYPE');
      expect(res.errorMessage).toContain('does not match genuine binary content');
    });

    it('rejects spoofed MIME: declared image/jpeg, but binary is arbitrary text', () => {
      const fakeText = Buffer.from('Hello, I am a disguised text payload!');
      const res = validateUploadFile(fakeText, 'doc.jpg', 'image/jpeg', { category: 'quizzes' });
      expect(res.valid).toBe(false);
      expect(res.errorCode).toBe('INVALID_BINARY_SIGNATURE');
    });

    it('rejects extension mismatch: valid PNG content with .exe extension', () => {
      const res = validateUploadFile(validPng, 'malware.exe', 'image/png', { category: 'quizzes' });
      expect(res.valid).toBe(false);
      expect(res.errorCode).toBe('EXTENSION_MISMATCH');
    });

    it('rejects extension mismatch: valid JPEG content with .html extension', () => {
      const res = validateUploadFile(validJpeg, 'page.html', 'image/jpeg', { category: 'quizzes' });
      expect(res.valid).toBe(false);
      expect(res.errorCode).toBe('EXTENSION_MISMATCH');
    });

    it('rejects corrupt PNG: valid 8-byte signature but truncated before IHDR', () => {
      const corruptPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
      const res = validateUploadFile(corruptPng, 'corrupt.png', 'image/png', { category: 'quizzes' });
      expect(res.valid).toBe(false);
      expect(res.errorCode).toBe('INVALID_BINARY_SIGNATURE');
    });
  });

  describe('3. File Size Bounds & Empty Buffer Handling', () => {
    it('rejects empty (0 byte) file uploads', () => {
      const res = validateUploadFile(Buffer.alloc(0), 'empty.jpg', 'image/jpeg');
      expect(res.valid).toBe(false);
      expect(res.errorCode).toBe('EMPTY_FILE');
    });

    it('rejects avatar exceeding 5MB category ceiling', () => {
      // 5MB + 1 byte
      const oversized = Buffer.alloc(5 * 1024 * 1024 + 1);
      validJpeg.copy(oversized, 0);
      const res = validateUploadFile(oversized, 'huge.jpg', 'image/jpeg', { category: 'avatars' });
      expect(res.valid).toBe(false);
      expect(res.errorCode).toBe('FILE_TOO_LARGE');
    });

    it('rejects quiz banner exceeding 10MB category ceiling', () => {
      const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
      validJpeg.copy(oversized, 0);
      const res = validateUploadFile(oversized, 'huge_banner.jpg', 'image/jpeg', { category: 'quizzes' });
      expect(res.valid).toBe(false);
      expect(res.errorCode).toBe('FILE_TOO_LARGE');
    });
  });

  describe('4. Active Script Content & SVG XSS Prevention', () => {
    it('detects embedded <script> tag disguised in image payload', () => {
      const payload = Buffer.concat([
        validJpeg,
        Buffer.from('Some comment <script>alert("XSS")</script>', 'utf-8'),
      ]);
      const res = validateUploadFile(payload, 'exploit.jpg', 'image/jpeg', { category: 'quizzes' });
      expect(res.valid).toBe(false);
      expect(res.errorCode).toBe('ACTIVE_CONTENT_DETECTED');
    });

    it('detects embedded SVG XML entity or onload attribute', () => {
      const payload = Buffer.concat([
        validPng,
        Buffer.from('<svg onload="fetch(\'https://attacker.com\')"></svg>', 'utf-8'),
      ]);
      const res = validateUploadFile(payload, 'svg_exploit.png', 'image/png', { category: 'quizzes' });
      expect(res.valid).toBe(false);
      expect(res.errorCode).toBe('ACTIVE_CONTENT_DETECTED');
    });

    it('containsActiveScriptContent returns true for iframe or javascript: payloads', () => {
      expect(containsActiveScriptContent(Buffer.from('<iframe src="http://evil.com"></iframe>'))).toBe(true);
      expect(containsActiveScriptContent(Buffer.from('javascript:alert(1)'))).toBe(true);
      expect(containsActiveScriptContent(validJpeg)).toBe(false);
    });
  });

  describe('5. Path Traversal & Safe Filename Sanitization', () => {
    it('strips directory traversal components ../ and ..\\', () => {
      expect(sanitizeFilename('../../../etc/passwd')).toBe('etc_passwd');
      expect(sanitizeFilename('..\\..\\windows\\system32\\cmd.exe')).toBe('windows_system32_cmd.exe');
    });

    it('strips null bytes and non-printable control characters', () => {
      expect(sanitizeFilename('photo\0.png.exe')).toBe('photo.png.exe');
      expect(sanitizeFilename('\x1b\x00safe.png')).toBe('safe.png');
    });

    it('generates non-traversable safe storage path with unique UUID', () => {
      const path1 = generateSafeStoragePath('avatars', 'user_123', 'avatar.png', 'png');
      const path2 = generateSafeStoragePath('avatars', 'user_123', 'avatar.png', 'png');
      expect(path1).toMatch(/^avatars\/user_123\/[a-f0-9-]+\.png$/);
      expect(path2).toMatch(/^avatars\/user_123\/[a-f0-9-]+\.png$/);
      expect(path1).not.toBe(path2); // Each upload gets unique path
    });
  });

  describe('6. Authorization & Cross-User Isolation Boundaries', () => {
    it('requires authentication for upload', () => {
      const res = assertUploadAuthorization('', 'avatars', 'user_123');
      expect(res.authorized).toBe(false);
      expect(res.errorCode).toBe('UNAUTHENTICATED');
    });

    it('allows user to upload avatar to their own profile', () => {
      const res = assertUploadAuthorization('user_alice', 'avatars', 'user_alice');
      expect(res.authorized).toBe(true);
    });

    it('denies user from uploading avatar to another users profile', () => {
      const res = assertUploadAuthorization('user_alice', 'avatars', 'user_bob');
      expect(res.authorized).toBe(false);
      expect(res.errorCode).toBe('CROSS_USER_AVATAR_DENIED');
    });

    it('allows quiz author to upload quiz media', () => {
      const res = assertUploadAuthorization('author_101', 'quizzes', 'quiz_555', 'author_101');
      expect(res.authorized).toBe(true);
    });

    it('denies non-author from uploading media to another authors quiz', () => {
      const res = assertUploadAuthorization('intruder_999', 'quizzes', 'quiz_555', 'author_101');
      expect(res.authorized).toBe(false);
      expect(res.errorCode).toBe('CROSS_USER_RESOURCE_DENIED');
    });
  });
});

