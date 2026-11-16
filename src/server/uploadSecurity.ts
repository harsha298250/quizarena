/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * QuizArena — Production Upload Security & Binary File Validation Engine
 * Enforces magic-byte inspection, declared MIME verification, active script / SVG XSS prevention,
 * strict size limits, path-traversal sanitization, and ownership-based authorization.
 */

import crypto from 'crypto';

export type AllowedUploadCategory = 'avatars' | 'quizzes' | 'tournaments' | 'certificates';

export interface FileValidationOptions {
  category?: AllowedUploadCategory;
  maxSizeBytes?: number;
  allowedMimes?: string[];
}

export interface FileValidationResult {
  valid: boolean;
  errorCode?: string;
  errorMessage?: string;
  detectedMime?: string;
  detectedExt?: string;
  sanitizedFilename?: string;
  safeStoragePath?: string;
}

export const CATEGORY_LIMITS: Record<AllowedUploadCategory, { maxBytes: number; allowedMimes: string[] }> = {
  avatars: {
    maxBytes: 5 * 1024 * 1024, // 5MB
    allowedMimes: ['image/png', 'image/jpeg', 'image/webp'],
  },
  quizzes: {
    maxBytes: 10 * 1024 * 1024, // 10MB
    allowedMimes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  },
  tournaments: {
    maxBytes: 10 * 1024 * 1024, // 10MB
    allowedMimes: ['image/png', 'image/jpeg', 'image/webp'],
  },
  certificates: {
    maxBytes: 15 * 1024 * 1024, // 15MB
    allowedMimes: ['application/pdf'],
  },
};

/**
 * Inspects binary magic numbers (signatures) at the start of the buffer.
 */
export function detectBinaryMimeType(buffer: Buffer): { mime: string; ext: string } | null {
  if (!buffer || buffer.length < 4) return null;

  // 1. JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    // Basic PNG chunk integrity: must contain IHDR shortly after signature
    if (buffer.length < 24 || !buffer.subarray(12, 16).equals(Buffer.from('IHDR', 'ascii'))) {
      return null; // Corrupted PNG
    }
    return { mime: 'image/png', ext: 'png' };
  }

  // 3. GIF: GIF87a or GIF89a (47 49 46 38 37 61 or 47 49 46 38 39 61)
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return { mime: 'image/gif', ext: 'gif' };
  }

  // 4. WebP: RIFF (0..3) .... WEBP (8..11)
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }

  // 5. PDF: %PDF- (25 50 44 46 2D)
  if (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  ) {
    return { mime: 'application/pdf', ext: 'pdf' };
  }

  return null;
}

/**
 * Scans buffer for dangerous active script content, XML entity injection, and SVG XSS.
 */
export function containsActiveScriptContent(buffer: Buffer): boolean {
  if (!buffer || buffer.length === 0) return false;
  // Check text sample (first 8KB and last 2KB)
  const head = buffer.subarray(0, Math.min(buffer.length, 8192)).toString('utf-8', 0);
  const tail = buffer.length > 8192 ? buffer.subarray(buffer.length - 2048).toString('utf-8') : '';
  const sample = (head + ' ' + tail).toLowerCase();

  const dangerousPatterns = [
    '<script',
    '</script>',
    'javascript:',
    'vbscript:',
    'onload=',
    'onerror=',
    'onclick=',
    'onmouseover=',
    '<svg',
    '</svg>',
    '<!entity',
    '<!doctype svg',
    '<?xml',
    '<iframe',
    '<embed',
    '<object',
  ];

  return dangerousPatterns.some(pattern => sample.includes(pattern));
}

/**
 * Sanitizes a user-provided filename:
 * Removes directory traversal sequences (../, ..\), null bytes, and non-printable characters.
 */
export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') return 'file';
  // Strip control characters and null bytes
  let clean = filename
    .replace(/[\0\x00-\x1F\x7F]/g, '')
    .trim();

  // Replace path separators with underscores
  clean = clean.replace(/[\\/]+/g, '_');

  // Strip traversal sequences like .._ or ..
  clean = clean.replace(/\.\.+/g, '');

  // Strip leading dots or underscores
  clean = clean.replace(/^[_.]+/, '');

  // Keep alphanumeric, dash, underscore, dot
  clean = clean.replace(/[^a-zA-Z0-9._-]/g, '_');

  // Collapse multiple underscores
  clean = clean.replace(/_+/g, '_');

  if (!clean || clean === '.') return 'file';
  return clean.substring(0, 128);
}

/**
 * Generates an unguessable, non-traversable safe storage path:
 * e.g. avatars/usr_123/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png
 */
export function generateSafeStoragePath(
  category: AllowedUploadCategory,
  entityId: string,
  sanitizedFilename: string,
  detectedExt: string
): string {
  const cleanEntityId = entityId.replace(/[^a-zA-Z0-9_-]/g, '');
  const uniqueId = crypto.randomUUID();
  return `${category}/${cleanEntityId}/${uniqueId}.${detectedExt}`;
}

/**
 * Primary validator for incoming upload buffers.
 */
export function validateUploadFile(
  buffer: Buffer,
  filename: string,
  declaredMimeType: string,
  options?: FileValidationOptions
): FileValidationResult {
  // 1. Check buffer presence and non-zero size
  if (!buffer || buffer.length === 0) {
    return {
      valid: false,
      errorCode: 'EMPTY_FILE',
      errorMessage: 'Uploaded file buffer is empty (0 bytes).',
    };
  }

  // 2. Resolve category bounds
  const category = options?.category || 'quizzes';
  const limits = CATEGORY_LIMITS[category] || CATEGORY_LIMITS.quizzes;
  const maxBytes = options?.maxSizeBytes || limits.maxBytes;
  const allowedMimes = options?.allowedMimes || limits.allowedMimes;

  // 3. Enforce file size limit
  if (buffer.length > maxBytes) {
    return {
      valid: false,
      errorCode: 'FILE_TOO_LARGE',
      errorMessage: `File size (${buffer.length} bytes) exceeds maximum limit of ${maxBytes} bytes for ${category}.`,
    };
  }

  // 4. Sanitize filename
  const cleanFilename = sanitizeFilename(filename);
  const extMatch = cleanFilename.match(/\.([a-zA-Z0-9]+)$/);
  const declaredExt = extMatch ? extMatch[1].toLowerCase() : '';

  // 5. Detect genuine binary signature (magic bytes)
  const detected = detectBinaryMimeType(buffer);
  if (!detected) {
    return {
      valid: false,
      errorCode: 'INVALID_BINARY_SIGNATURE',
      errorMessage: 'File content does not match any accepted image or document binary signature.',
    };
  }

  // 6. Verify detected MIME is in the allowed list for this category
  if (!allowedMimes.includes(detected.mime)) {
    return {
      valid: false,
      errorCode: 'UNSUPPORTED_MIME_TYPE',
      errorMessage: `Detected type ${detected.mime} is not permitted for category ${category}. Allowed: ${allowedMimes.join(', ')}.`,
      detectedMime: detected.mime,
      detectedExt: detected.ext,
    };
  }

  // 7. Verify declared MIME matches detected binary signature (Anti-Spoofing)
  const normalizedDeclared = declaredMimeType.trim().toLowerCase();
  // Treat image/jpg as image/jpeg
  const effectiveDeclared = normalizedDeclared === 'image/jpg' ? 'image/jpeg' : normalizedDeclared;

  if (effectiveDeclared && effectiveDeclared !== detected.mime) {
    return {
      valid: false,
      errorCode: 'SPOOFED_MIME_TYPE',
      errorMessage: `Declared MIME type (${declaredMimeType}) does not match genuine binary content (${detected.mime}).`,
      detectedMime: detected.mime,
      detectedExt: detected.ext,
    };
  }

  // 8. Verify file extension matches detected binary content
  const validExtsForMime: Record<string, string[]> = {
    'image/jpeg': ['jpg', 'jpeg'],
    'image/png': ['png'],
    'image/webp': ['webp'],
    'image/gif': ['gif'],
    'application/pdf': ['pdf'],
  };

  const expectedExts = validExtsForMime[detected.mime] || [];
  if (declaredExt && !expectedExts.includes(declaredExt)) {
    return {
      valid: false,
      errorCode: 'EXTENSION_MISMATCH',
      errorMessage: `File extension .${declaredExt} does not match detected binary signature for ${detected.mime}.`,
      detectedMime: detected.mime,
      detectedExt: detected.ext,
    };
  }

  // 9. Inspect for active scripts or embedded SVG XSS payloads
  if (containsActiveScriptContent(buffer)) {
    return {
      valid: false,
      errorCode: 'ACTIVE_CONTENT_DETECTED',
      errorMessage: 'File contains forbidden active scripts, embedded HTML tags, or SVG XML entities.',
      detectedMime: detected.mime,
      detectedExt: detected.ext,
    };
  }

  // 10. Generate safe storage path
  const safeStoragePath = generateSafeStoragePath(category, 'default', cleanFilename, detected.ext);

  return {
    valid: true,
    detectedMime: detected.mime,
    detectedExt: detected.ext,
    sanitizedFilename: cleanFilename,
    safeStoragePath,
  };
}

/**
 * Verifies caller authorization for upload target to prevent IDOR / cross-user overwrites.
 */
export function assertUploadAuthorization(
  callerUid: string,
  category: AllowedUploadCategory,
  targetEntityId: string,
  resourceOwnerUid?: string
): { authorized: boolean; errorCode?: string; errorMessage?: string } {
  if (!callerUid || typeof callerUid !== 'string') {
    return { authorized: false, errorCode: 'UNAUTHENTICATED', errorMessage: 'Authentication required for upload.' };
  }

  if (category === 'avatars') {
    // An avatar can only be uploaded by the user themselves
    if (callerUid !== targetEntityId) {
      return {
        authorized: false,
        errorCode: 'CROSS_USER_AVATAR_DENIED',
        errorMessage: 'Users may only upload avatars to their own profile.',
      };
    }
  }

  if (category === 'quizzes' || category === 'tournaments') {
    // Media can only be uploaded if caller is the owner/host of the resource
    if (resourceOwnerUid && resourceOwnerUid !== callerUid) {
      return {
        authorized: false,
        errorCode: 'CROSS_USER_RESOURCE_DENIED',
        errorMessage: 'Only the author or host of this resource is authorized to upload media.',
      };
    }
  }

  return { authorized: true };
}
