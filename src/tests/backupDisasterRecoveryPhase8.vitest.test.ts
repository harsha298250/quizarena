/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * QuizArena — Phase 8 Workstream I: Backup & Disaster Recovery Verification Suite
 */

import { describe, it, expect } from 'vitest';
import {
  generateSnapshot,
  verifySnapshotIntegrity,
  computeChecksum,
  serializeFirestoreValue,
  deserializeFirestoreValue,
  exportFirestoreCollections,
  restoreFirestoreCollections,
  CORE_COLLECTIONS,
} from '../../scripts/backup-firestore.js';

describe('Phase 8: Disaster Recovery, Backup & Snapshot Integrity', () => {
  it('covers all critical collections in disaster recovery plan', () => {
    expect(CORE_COLLECTIONS).toContain('quizzes');
    expect(CORE_COLLECTIONS).toContain('tournaments');
    expect(CORE_COLLECTIONS).toContain('certificates');
    expect(CORE_COLLECTIONS).toContain('users');
    expect(CORE_COLLECTIONS).toContain('email_outbox_jobs');
    expect(CORE_COLLECTIONS).toContain('system_config');
    expect(CORE_COLLECTIONS).toContain('games');
  });

  it('generates a snapshot with valid cryptographic checksums', () => {
    const mockData = {
      quizzes: [
        { id: 'quiz_1', data: { title: 'CS Fundamentals', questions: [] } },
        { id: 'quiz_2', data: { title: 'Data Structures', questions: [] } },
      ],
      tournaments: [
        { id: 'tourney_1', data: { title: 'National Coding Cup', maxContenders: 128 } },
      ],
    };

    const snapshot = generateSnapshot(mockData, 'test');

    const collections = snapshot.metadata.collections as Record<string, { count: number; sha256: string }>;
    expect(snapshot.metadata.totalDocuments).toBe(3);
    expect(collections.quizzes.count).toBe(2);
    expect(collections.tournaments.count).toBe(1);
    expect(collections.quizzes.sha256).toBeDefined();
    expect(snapshot.metadata.overallChecksum).toBeDefined();

    const verification = verifySnapshotIntegrity(snapshot);
    expect(verification.valid).toBe(true);
    expect(verification.errors).toHaveLength(0);
  });

  it('detects tampering or corruption in snapshot collection data', () => {
    const mockData = {
      certificates: [
        { id: 'cert_1', data: { recipientName: 'Alice', score: 100 } },
      ],
    };

    const snapshot = generateSnapshot(mockData, 'test');

    // Tamper with data after metadata checksum was computed
    snapshot.data.certificates[0].data.score = 999;

    const verification = verifySnapshotIntegrity(snapshot);
    expect(verification.valid).toBe(false);
    expect(verification.errors.some((e: string) => e.includes('Checksum mismatch'))).toBe(true);
  });

  it('detects missing documents or truncated collections', () => {
    const mockData = {
      users: [
        { id: 'user_1', data: { email: 'teacher@school.edu' } },
        { id: 'user_2', data: { email: 'student@school.edu' } },
      ],
    };

    const snapshot = generateSnapshot(mockData, 'test');

    // Remove one document
    snapshot.data.users.pop();

    const verification = verifySnapshotIntegrity(snapshot);
    expect(verification.valid).toBe(false);
    expect(verification.errors.some((e: string) => e.includes('Document count mismatch'))).toBe(true);
  });

  it('deterministic checksum produces identical outputs for identical objects regardless of property insertion order', () => {
    const objA = { alpha: 1, beta: 2, gamma: [3, 4] };
    const objB = { gamma: [3, 4], beta: 2, alpha: 1 };

    expect(computeChecksum(objA)).toBe(computeChecksum(objB));
  });

  it('preserves Firestore Timestamp and nested structure across serialization/deserialization', () => {
    const mockTimestamp = {
      seconds: 1700000000,
      nanoseconds: 500000,
      toMillis: () => 1700000000500,
    };
    const original = {
      title: 'History Quiz',
      createdAt: mockTimestamp,
      metadata: { author: 'Dr. Jane' },
      tags: ['history', 'edu'],
    };

    const serialized = serializeFirestoreValue(original);
    expect(serialized.createdAt._type).toBe('firestore_timestamp');
    expect(serialized.createdAt.seconds).toBe(1700000000);

    class FakeTimestamp {
      seconds: number;
      nanoseconds: number;
      constructor(s: number, ns: number) {
        this.seconds = s;
        this.nanoseconds = ns;
      }
      static fromMillis(m: number) {
        return new FakeTimestamp(Math.floor(m / 1000), 0);
      }
    }

    const deserialized = deserializeFirestoreValue(serialized, FakeTimestamp);
    expect(deserialized.createdAt instanceof FakeTimestamp).toBe(true);
    expect(deserialized.createdAt.seconds).toBe(1700000000);
    expect(deserialized.metadata.author).toBe('Dr. Jane');
  });

  it('enforces safety guards on restoreFirestoreCollections', async () => {
    const validSnapshot = generateSnapshot({ quizzes: [] }, 'test');

    // 1. Without confirmRestore -> throws SAFETY_ABORT
    await expect(
      restoreFirestoreCollections({} as any, validSnapshot, { confirmRestore: false })
    ).rejects.toThrow(/SAFETY_ABORT/i);

    // 2. In non-emulator environment without allowProduction -> throws PRODUCTION_SAFETY_GUARD
    const origHost = process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    try {
      await expect(
        restoreFirestoreCollections({} as any, validSnapshot, { confirmRestore: true, allowProduction: false })
      ).rejects.toThrow(/PRODUCTION_SAFETY_GUARD/i);
    } finally {
      if (origHost) process.env.FIRESTORE_EMULATOR_HOST = origHost;
    }
  });

  it('exports and restores collections against mock Firestore database cleanly', async () => {
    const mockStore: Record<string, Record<string, any>> = {
      quizzes: {
        q1: { title: 'Math Quiz', timeLimit: 30 },
      },
    };

    const mockAdminDb: any = {
      collection: (col: string) => ({
        get: async () => ({
          docs: Object.entries(mockStore[col] || {}).map(([id, data]) => ({
            id,
            data: () => data,
          })),
        }),
        doc: (id: string) => ({
          id,
          path: `${col}/${id}`,
        }),
      }),
      batch: () => {
        const operations: Array<() => void> = [];
        return {
          set: (docRef: any, data: any) => {
            const col = docRef.path.split('/')[0];
            if (!mockStore[col]) mockStore[col] = {};
            operations.push(() => {
              mockStore[col][docRef.id] = data;
            });
          },
          commit: async () => {
            operations.forEach(op => op());
          },
        };
      },
    };

    // Export
    const exported = await exportFirestoreCollections(mockAdminDb, ['quizzes']);
    expect(exported.metadata.totalDocuments).toBe(1);
    expect(exported.data.quizzes[0].id).toBe('q1');

    // Modify mock store
    mockStore.quizzes = {};

    // Restore (simulating emulator environment)
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
    try {
      const restoreRes = await restoreFirestoreCollections(mockAdminDb, exported, { confirmRestore: true });
      expect(restoreRes.success).toBe(true);
      expect(restoreRes.restoredCount).toBe(1);
      expect(mockStore.quizzes.q1.title).toBe('Math Quiz');
    } finally {
      delete process.env.FIRESTORE_EMULATOR_HOST;
    }
  });
});
