import { describe, it, expect } from 'vitest';
import {
  executeDeletionJob,
  hashIdentifier,
  AccountDeletionJob,
} from '../server/accountDeletionEngine.ts';

function createStatefulFirestoreMock() {
  const store = new Map<string, Record<string, any>>();

  const matchesWhere = (docData: any, filters: Array<{ field: string; op: string; value: any }>) => {
    for (const f of filters) {
      const actual = docData?.[f.field];
      if (f.op === '==' && actual !== f.value) return false;
    }
    return true;
  };

  const makeDocRef = (docPath: string): any => ({
    id: docPath.split('/').pop()!,
    path: docPath,
    collection: (subCol: string) => makeCollectionRef(`${docPath}/${subCol}`),
    get: async () => {
      const data = store.get(docPath);
      return {
        exists: data !== undefined,
        id: docPath.split('/').pop()!,
        ref: makeDocRef(docPath),
        data: () => (data ? structuredClone(data) : undefined),
      };
    },
    set: async (data: any, opts?: { merge?: boolean }) => {
      if (opts?.merge && store.has(docPath)) {
        store.set(docPath, { ...store.get(docPath)!, ...structuredClone(data) });
      } else {
        store.set(docPath, structuredClone(data));
      }
    },
    delete: async () => {
      store.delete(docPath);
    },
  });

  const makeQuery = (colPath: string, filters: Array<{ field: string; op: string; value: any }>, limitNum?: number): any => ({
    where: (field: string, op: string, value: any) =>
      makeQuery(colPath, [...filters, { field, op, value }], limitNum),
    limit: (n: number) => makeQuery(colPath, filters, n),
    get: async () => {
      const prefix = `${colPath}/`;
      const docs: any[] = [];
      for (const [k, v] of store.entries()) {
        if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) {
          if (matchesWhere(v, filters)) {
            docs.push({
              id: k.slice(prefix.length),
              ref: makeDocRef(k),
              data: () => structuredClone(v),
            });
          }
        }
      }
      const sliced = typeof limitNum === 'number' ? docs.slice(0, limitNum) : docs;
      return {
        empty: sliced.length === 0,
        size: sliced.length,
        docs: sliced,
      };
    },
  });

  const makeCollectionRef = (colPath: string): any => ({
    doc: (id: string) => makeDocRef(`${colPath}/${id}`),
    where: (field: string, op: string, value: any) =>
      makeQuery(colPath, [{ field, op, value }]),
    limit: (n: number) => makeQuery(colPath, [], n),
    get: async () => makeQuery(colPath, []).get(),
  });

  const db: any = {
    collection: (colPath: string) => makeCollectionRef(colPath),
    batch: () => {
      const ops: Array<() => void> = [];
      return {
        delete: (ref: any) => ops.push(() => store.delete(ref.path)),
        set: (ref: any, data: any, opts?: { merge?: boolean }) =>
          ops.push(() => {
            if (opts?.merge && store.has(ref.path)) {
              store.set(ref.path, { ...store.get(ref.path)!, ...structuredClone(data) });
            } else {
              store.set(ref.path, structuredClone(data));
            }
          }),
        commit: async () => {
          for (const op of ops) op();
        },
      };
    },
    runTransaction: async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
      const pendingWrites: Array<() => void> = [];
      const tx = {
        get: async (target: any) => target.get(),
        set: (ref: any, data: any, opts?: { merge?: boolean }) => {
          pendingWrites.push(() => {
            if (opts?.merge && store.has(ref.path)) {
              store.set(ref.path, { ...store.get(ref.path)!, ...structuredClone(data) });
            } else {
              store.set(ref.path, structuredClone(data));
            }
          });
        },
        delete: (ref: any) => {
          pendingWrites.push(() => store.delete(ref.path));
        },
      };
      const result = await fn(tx);
      for (const w of pendingWrites) w();
      return result;
    },
  };

  return db;
}

function buildJob(uid: string, token: string): AccountDeletionJob {
  const nowIso = new Date().toISOString();
  return {
    id: `job_${uid}`,
    uid,
    uidHash: hashIdentifier(uid),
    status: 'processing',
    currentStage: 'mark_pending',
    completedStages: [],
    attempts: 1,
    recoveryTokenHash: hashIdentifier(token),
    createdAt: nowIso,
    processingStartedAt: nowIso,
    updatedAt: nowIso,
    retentionExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    sanitizedError: null,
    counts: {
      deletedQuizzes: 0,
      deletedQuestionBank: 0,
      deletedGames: 0,
      anonymizedGames: 0,
      deletedPlayerRecords: 0,
      anonymizedTournaments: 0,
      anonymizedCertificates: 0,
      cancelledEmails: 0,
      deletedStorageFiles: 0,
    },
  };
}

describe('Phase 4: Account Deletion Storage Purge Hardening', () => {
  const uid = 'test_user_p4';

  it('marks purge_storage as skipped when storage bucket is unconfigured (isConfigured: false)', async () => {
    const adminDb = createStatefulFirestoreMock();
    const adminAuth: any = {
      deleteUser: async () => {},
      revokeRefreshTokens: async () => {},
    };
    const adminStorage: any = {
      bucket: () => ({
        isConfigured: false,
        name: 'unconfigured',
        getFiles: async () => {
          throw new Error('Should not be called when unconfigured');
        },
      }),
    };

    const job = buildJob(uid, 'test_token_hash_1');
    const result = await executeDeletionJob(job, { adminAuth, adminDb, adminStorage });

    expect(result.status).toBe('completed');
    expect(result.completedStages).toContain('purge_storage');
    expect(result.completedStages).toContain('finalize_job');
  });

  it('marks purge_storage as skipped when bucket getFiles returns 404 (Not Found)', async () => {
    const adminDb = createStatefulFirestoreMock();
    const adminAuth: any = {
      deleteUser: async () => {},
      revokeRefreshTokens: async () => {},
    };
    const adminStorage: any = {
      bucket: () => ({
        name: 'quizarena-storage-test',
        getFiles: async () => {
          const err: any = new Error('The specified bucket does not exist');
          err.code = 404;
          err.status = 404;
          throw err;
        },
        deleteFiles: async () => {},
      }),
    };

    const job = buildJob(uid, 'test_token_hash_2');
    const result = await executeDeletionJob(job, { adminAuth, adminDb, adminStorage });

    expect(result.status).toBe('completed');
    expect(result.completedStages).toContain('purge_storage');
    expect(result.completedStages).toContain('finalize_job');
  });

  it('marks purge_storage as skipped when bucket.exists() returns [false]', async () => {
    const adminDb = createStatefulFirestoreMock();
    const adminAuth: any = {
      deleteUser: async () => {},
      revokeRefreshTokens: async () => {},
    };
    const adminStorage: any = {
      bucket: () => ({
        name: 'missing-bucket',
        exists: async () => [false],
        getFiles: async () => [],
        deleteFiles: async () => {},
      }),
    };

    const job = buildJob(uid, 'test_token_hash_3');
    const result = await executeDeletionJob(job, { adminAuth, adminDb, adminStorage });

    expect(result.status).toBe('completed');
    expect(result.completedStages).toContain('purge_storage');
  });

  it('retains failure and remains retry-safe on genuine storage error (e.g. 403 Forbidden)', async () => {
    const adminDb = createStatefulFirestoreMock();
    const adminAuth: any = {
      deleteUser: async () => {},
      revokeRefreshTokens: async () => {},
    };
    const adminStorage: any = {
      bucket: () => ({
        name: 'quizarena-forbidden-bucket',
        getFiles: async () => {
          const err: any = new Error('Access denied to storage bucket');
          err.code = 403;
          err.status = 403;
          throw err;
        },
        deleteFiles: async () => {},
      }),
    };

    const job = buildJob(uid, 'test_token_hash_4');
    const result = await executeDeletionJob(job, { adminAuth, adminDb, adminStorage });

    expect(result.status).toBe('failed');
    expect(result.currentStage).toBe('purge_storage');
    expect(result.completedStages).not.toContain('purge_storage');
    expect(result.completedStages).not.toContain('finalize_job');
    expect(result.recoveryTokenHash).toBeTruthy();
  });

  it('executes idempotently without re-running previously completed stages', async () => {
    const adminDb = createStatefulFirestoreMock();
    const adminAuth: any = {
      deleteUser: async () => {},
      revokeRefreshTokens: async () => {},
    };
    const adminStorage: any = {
      bucket: () => ({
        name: 'quizarena-storage-clean',
        getFiles: async () => [[]],
        deleteFiles: async () => {},
      }),
    };

    const job = buildJob(uid, 'test_token_hash_5');
    // Pre-mark first few stages as already completed
    job.completedStages = ['mark_pending', 'purge_personal_content', 'purge_mail_outbox'];

    const result = await executeDeletionJob(job, { adminAuth, adminDb, adminStorage });
    expect(result.status).toBe('completed');
    expect(result.completedStages).toContain('purge_storage');
    expect(result.completedStages).toContain('finalize_job');
  });
});
