/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';

export const ACCOUNT_DELETION_JOBS_COLLECTION = 'accountDeletionJobs';
export const ACCOUNT_DELETION_LOCKS_COLLECTION = 'accountDeletionLocks';
export const ACCOUNT_DELETION_EMAIL_BLOCKS_COLLECTION = 'accountDeletionEmailBlocks';
export const DELETION_JOB_RETENTION_DAYS = 90;

export type DeletionJobStatus = 'requested' | 'processing' | 'completed' | 'failed';

export type DeletionStage =
  | 'mark_pending'
  | 'purge_personal_content'
  | 'purge_mail_outbox'
  | 'handle_tournaments'
  | 'handle_games'
  | 'handle_certificates'
  | 'purge_storage'
  | 'delete_auth_and_profile'
  | 'finalize_job';

export const ALL_DELETION_STAGES: DeletionStage[] = [
  'mark_pending',
  'purge_personal_content',
  'purge_mail_outbox',
  'handle_tournaments',
  'handle_games',
  'handle_certificates',
  'purge_storage',
  'delete_auth_and_profile',
  'finalize_job',
];

export interface DeletionCounts {
  deletedQuizzes: number;
  deletedQuestionBank: number;
  deletedGames: number;
  anonymizedGames: number;
  deletedPlayerRecords: number;
  anonymizedTournaments: number;
  anonymizedCertificates: number;
  cancelledEmails: number;
  deletedStorageFiles: number;
}

export interface AccountDeletionJob {
  id: string;
  uid: string;
  uidHash: string;
  status: DeletionJobStatus;
  currentStage: DeletionStage;
  completedStages: DeletionStage[];
  attempts: number;
  recoveryTokenHash?: string | null;
  createdAt: string;
  processingStartedAt?: string;
  completedAt?: string;
  updatedAt: string;
  retentionExpiresAt: string;
  sanitizedError?: string | null;
  counts: DeletionCounts;
}

export interface AccountDeletionDependencies {
  adminAuth: Auth;
  adminDb: Firestore;
  adminStorage?: any;
}

export function hashIdentifier(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * Generates a one-way, non-reversible pseudonymous identifier for shared historical records.
 * Never persisted alongside the original UID in any reversible mapping.
 */
export function createPseudonymousId(uid: string): string {
  const randomSalt = crypto.randomBytes(16).toString('hex');
  return `deleted_${crypto.createHash('sha256').update(`${uid}:${randomSalt}`).digest('hex').slice(0, 16)}`;
}

function createEmptyCounts(): DeletionCounts {
  return {
    deletedQuizzes: 0,
    deletedQuestionBank: 0,
    deletedGames: 0,
    anonymizedGames: 0,
    deletedPlayerRecords: 0,
    anonymizedTournaments: 0,
    anonymizedCertificates: 0,
    cancelledEmails: 0,
    deletedStorageFiles: 0,
  };
}

export function sanitizeStageError(stage: DeletionStage, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err || '');
  if (stage === 'purge_storage' && /unavailable|not configured/i.test(msg)) {
    return 'Storage purge service is unavailable; deletion incomplete.';
  }
  if (stage === 'delete_auth_and_profile') {
    return 'Authentication account deletion failed; please retry.';
  }
  if (stage === 'finalize_job') {
    return 'Final deletion status update failed; please retry.';
  }
  return `Deletion stage "${stage}" did not complete cleanly; please retry.`;
}

/**
 * Checks whether an account is currently marked deletion_pending or has a deletion lock.
 * Safe for unrelated users: inspects only the caller's own user and lock documents.
 */
export async function isAccountDeletionPending(adminDb: any, uid: string): Promise<boolean> {
  if (!adminDb || typeof adminDb.collection !== 'function' || !uid) {
    return false;
  }
  try {
    const userSnap = await adminDb.collection('users').doc(uid).get();
    if (userSnap?.exists && userSnap.data()?.status === 'deletion_pending') {
      return true;
    }
    const lockSnap = await adminDb
      .collection(ACCOUNT_DELETION_LOCKS_COLLECTION)
      .doc(hashIdentifier(uid))
      .get();
    if (lockSnap?.exists) {
      const lockStatus = lockSnap.data()?.status;
      if (
        lockStatus === 'requested' ||
        lockStatus === 'processing' ||
        lockStatus === 'completed' ||
        lockStatus === 'failed'
      ) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

export async function assertAccountActive(
  adminDb: any,
  uid: string
): Promise<{ active: boolean; error?: string }> {
  const blocked = await isAccountDeletionPending(adminDb, uid);
  if (blocked) {
    return {
      active: false,
      error: 'Forbidden: Account is pending deletion or has been deleted.',
    };
  }
  return { active: true };
}

export async function isEmailBlockedForDeletion(adminDb: any, email?: string | null): Promise<boolean> {
  if (!adminDb || typeof adminDb.collection !== 'function' || !email) {
    return false;
  }
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  try {
    const blockSnap = await adminDb
      .collection(ACCOUNT_DELETION_EMAIL_BLOCKS_COLLECTION)
      .doc(hashIdentifier(normalized))
      .get();
    return Boolean(blockSnap?.exists);
  } catch {
    return false;
  }
}

async function deleteDocsInBatches(adminDb: any, docs: any[]): Promise<number> {
  if (!docs || docs.length === 0) return 0;
  const BATCH_LIMIT = 400;
  let deleted = 0;

  for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
    const chunk = docs.slice(i, i + BATCH_LIMIT);
    if (typeof adminDb.batch === 'function') {
      const batch = adminDb.batch();
      for (const doc of chunk) {
        batch.delete(doc.ref);
      }
      await batch.commit();
      deleted += chunk.length;
    } else {
      for (const doc of chunk) {
        await doc.ref.delete();
        deleted++;
      }
    }
  }

  return deleted;
}

async function queryAndDeleteAll(adminDb: any, baseQuery: any): Promise<number> {
  const PAGE_SIZE = 400;
  let totalDeleted = 0;

  while (true) {
    const pageQuery = typeof baseQuery.limit === 'function' ? baseQuery.limit(PAGE_SIZE) : baseQuery;
    const snap = await pageQuery.get();
    const docs = snap?.docs || [];
    if (docs.length === 0) break;

    totalDeleted += await deleteDocsInBatches(adminDb, docs);

    if (typeof baseQuery.limit !== 'function' || docs.length < PAGE_SIZE) {
      break;
    }
  }

  return totalDeleted;
}

async function getAllDocsPaginated(queryOrCol: any): Promise<any[]> {
  if (typeof queryOrCol.limit !== 'function' || typeof queryOrCol.startAfter !== 'function') {
    const snap = await queryOrCol.get();
    return snap?.docs || [];
  }

  const PAGE_SIZE = 400;
  const allDocs: any[] = [];
  let cursor: any = null;

  while (true) {
    let q = queryOrCol.limit(PAGE_SIZE);
    if (cursor) {
      q = q.startAfter(cursor);
    }
    const snap = await q.get();
    const docs = snap?.docs || [];
    if (docs.length === 0) break;
    allDocs.push(...docs);
    if (docs.length < PAGE_SIZE) break;
    cursor = docs[docs.length - 1];
  }

  return allDocs;
}

export interface AcquireJobResult {
  job: AccountDeletionJob;
  recoveryToken?: string;
  isDuplicate: boolean;
  alreadyCompleted: boolean;
}

/**
 * Acquires a deterministic per-user deletion lock inside a Firestore transaction,
 * preventing concurrent or duplicate destructive jobs.
 */
export async function acquireDeletionJob(
  adminDb: Firestore,
  uid: string
): Promise<AcquireJobResult> {
  const uidHash = hashIdentifier(uid);
  const now = new Date();
  const nowIso = now.toISOString();
  const retentionExpiresAt = new Date(
    now.getTime() + DELETION_JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const lockRef = adminDb.collection(ACCOUNT_DELETION_LOCKS_COLLECTION).doc(uidHash);

  return adminDb.runTransaction(async tx => {
    const lockSnap = await tx.get(lockRef);

    if (lockSnap.exists) {
      const lockData = lockSnap.data() || {};
      const existingJobRef = adminDb
        .collection(ACCOUNT_DELETION_JOBS_COLLECTION)
        .doc(lockData.jobId);
      const existingJobSnap = await tx.get(existingJobRef);
      const existingJob = existingJobSnap.exists
        ? (existingJobSnap.data() as AccountDeletionJob)
        : null;

      if (lockData.status === 'requested' || lockData.status === 'processing') {
        return {
          job:
            existingJob ||
            ({
              id: lockData.jobId,
              uid,
              uidHash,
              status: lockData.status,
              currentStage: 'mark_pending',
              completedStages: [],
              attempts: 1,
              createdAt: lockData.lockedAt || nowIso,
              updatedAt: nowIso,
              retentionExpiresAt,
              counts: createEmptyCounts(),
            } as AccountDeletionJob),
          isDuplicate: true,
          alreadyCompleted: false,
        };
      }

      if (lockData.status === 'completed') {
        return {
          job:
            existingJob ||
            ({
              id: lockData.jobId,
              uid: '[purged]',
              uidHash,
              status: 'completed',
              currentStage: 'finalize_job',
              completedStages: [...ALL_DELETION_STAGES],
              attempts: 1,
              createdAt: lockData.lockedAt || nowIso,
              completedAt: lockData.completedAt || nowIso,
              updatedAt: nowIso,
              retentionExpiresAt,
              counts: createEmptyCounts(),
            } as AccountDeletionJob),
          isDuplicate: true,
          alreadyCompleted: true,
        };
      }

      // Failed job: allow safe resumption
      const recoveryToken = crypto.randomBytes(32).toString('hex');
      const recoveryTokenHash = hashIdentifier(recoveryToken);
      const resumedJob: AccountDeletionJob = {
        ...(existingJob || {
          id: lockData.jobId,
          uid,
          uidHash,
          currentStage: 'mark_pending',
          completedStages: [],
          attempts: 0,
          createdAt: nowIso,
          retentionExpiresAt,
          counts: createEmptyCounts(),
        }),
        status: 'processing',
        attempts: (existingJob?.attempts || 1) + 1,
        processingStartedAt: nowIso,
        updatedAt: nowIso,
        sanitizedError: null,
        recoveryTokenHash,
      };

      tx.set(lockRef, { ...lockData, status: 'processing', updatedAt: nowIso }, { merge: true });
      tx.set(existingJobRef, resumedJob);

      return {
        job: resumedJob,
        recoveryToken,
        isDuplicate: false,
        alreadyCompleted: false,
      };
    }

    const jobId = `del_${crypto.randomUUID()}`;
    const recoveryToken = crypto.randomBytes(32).toString('hex');
    const recoveryTokenHash = hashIdentifier(recoveryToken);
    const jobRef = adminDb.collection(ACCOUNT_DELETION_JOBS_COLLECTION).doc(jobId);

    const newJob: AccountDeletionJob = {
      id: jobId,
      uid,
      uidHash,
      status: 'processing',
      currentStage: 'mark_pending',
      completedStages: [],
      attempts: 1,
      recoveryTokenHash,
      createdAt: nowIso,
      processingStartedAt: nowIso,
      updatedAt: nowIso,
      retentionExpiresAt,
      sanitizedError: null,
      counts: createEmptyCounts(),
    };

    tx.set(lockRef, {
      jobId,
      uidHash,
      status: 'processing',
      lockedAt: nowIso,
      updatedAt: nowIso,
    });
    tx.set(jobRef, newJob);

    return {
      job: newJob,
      recoveryToken,
      isDuplicate: false,
      alreadyCompleted: false,
    };
  });
}

async function persistJobProgress(
  adminDb: Firestore,
  job: AccountDeletionJob,
  lockStatus?: DeletionJobStatus
): Promise<void> {
  const nowIso = new Date().toISOString();
  job.updatedAt = nowIso;
  const jobRef = adminDb.collection(ACCOUNT_DELETION_JOBS_COLLECTION).doc(job.id);
  await jobRef.set(job);

  if (lockStatus) {
    const lockRef = adminDb.collection(ACCOUNT_DELETION_LOCKS_COLLECTION).doc(job.uidHash);
    await lockRef.set(
      {
        jobId: job.id,
        uidHash: job.uidHash,
        status: lockStatus,
        updatedAt: nowIso,
        ...(lockStatus === 'completed' ? { completedAt: nowIso } : {}),
      },
      { merge: true }
    );
  }
}

/**
 * Executes all incomplete stages of an AccountDeletionJob idempotently.
 * Handles partial failures safely without marking incomplete jobs as completed.
 */
export async function executeDeletionJob(
  job: AccountDeletionJob,
  deps: AccountDeletionDependencies,
  userEmail?: string | null
): Promise<AccountDeletionJob> {
  const { adminAuth, adminDb, adminStorage } = deps;
  const uid = job.uid;
  const pseudoId = createPseudonymousId(uid);

  let resolvedEmail = userEmail ? userEmail.trim().toLowerCase() : '';
  if (!resolvedEmail && uid && uid !== '[purged]') {
    try {
      const userSnap = await adminDb.collection('users').doc(uid).get();
      if (userSnap?.exists && typeof userSnap.data()?.email === 'string') {
        resolvedEmail = userSnap.data()!.email.trim().toLowerCase();
      }
    } catch {
      // Handled inside stages
    }
  }

  for (const stage of ALL_DELETION_STAGES) {
    if (job.completedStages.includes(stage)) {
      continue;
    }

    job.currentStage = stage;

    try {
      switch (stage) {
        case 'mark_pending': {
          const nowIso = new Date().toISOString();
          await adminDb.collection('users').doc(uid).set(
            {
              status: 'deletion_pending',
              deletionRequestedAt: nowIso,
            },
            { merge: true }
          );

          if (resolvedEmail) {
            await adminDb
              .collection(ACCOUNT_DELETION_EMAIL_BLOCKS_COLLECTION)
              .doc(hashIdentifier(resolvedEmail))
              .set({
                blockedAt: nowIso,
                reason: 'account_deletion',
              });
          }

          if (typeof (adminAuth as any).revokeRefreshTokens === 'function') {
            try {
              await (adminAuth as any).revokeRefreshTokens(uid);
            } catch (authErr: any) {
              if (authErr?.code !== 'auth/user-not-found') {
                throw authErr;
              }
            }
          }
          break;
        }

        case 'purge_personal_content': {
          job.counts.deletedQuizzes += await queryAndDeleteAll(
            adminDb,
            adminDb.collection('quizzes').where('authorId', '==', uid)
          );
          job.counts.deletedQuestionBank += await queryAndDeleteAll(
            adminDb,
            adminDb.collection('questionBank').where('authorId', '==', uid)
          );
          await queryAndDeleteAll(
            adminDb,
            adminDb.collection('emailTemplates').where('ownerId', '==', uid)
          );
          await queryAndDeleteAll(
            adminDb,
            adminDb.collection('competitions').where('organizerId', '==', uid)
          );
          break;
        }

        case 'purge_mail_outbox': {
          const nowIso = new Date().toISOString();
          const mailByOwner = await getAllDocsPaginated(
            adminDb.collection('mail').where('ownerId', '==', uid)
          );
          const mailByEmail = resolvedEmail
            ? await getAllDocsPaginated(adminDb.collection('mail').where('to', '==', resolvedEmail))
            : [];

          const seenIds = new Set<string>();
          const allMailDocs = [...mailByOwner, ...mailByEmail].filter(d => {
            if (seenIds.has(d.id)) return false;
            seenIds.add(d.id);
            return true;
          });

          const toDelete: any[] = [];
          for (const mailDoc of allMailDocs) {
            const data = mailDoc.data() || {};
            const st = String(data.status || '').toLowerCase();
            if (st === 'pending' || st === 'queued' || st === 'processing') {
              await mailDoc.ref.set(
                {
                  status: 'cancelled',
                  to: '[deleted]',
                  recipientName: 'Deleted User',
                  subject: '[cancelled]',
                  html: '',
                  text: '',
                  ownerId: pseudoId,
                  cancelledAt: nowIso,
                  cancelReason: 'account_deleted',
                },
                { merge: true }
              );
              job.counts.cancelledEmails++;
            } else {
              toDelete.push(mailDoc);
            }
          }

          if (toDelete.length > 0) {
            await deleteDocsInBatches(adminDb, toDelete);
          }
          break;
        }

        case 'handle_tournaments': {
          const nowIso = new Date().toISOString();
          const tournamentDocs = await getAllDocsPaginated(adminDb.collection('tournaments'));

          for (const tDoc of tournamentDocs) {
            const tRef = tDoc.ref;
            const txOutcome = await adminDb.runTransaction(async tx => {
              const tSnap: any = await tx.get(tRef);
              if (!tSnap.exists) return { deleteDraft: false };
              const tournament = tSnap.data() || {};
              const regRef = tRef.collection('registrations').doc(uid);
              const regSnap: any = await tx.get(regRef);
              const resultRef = tRef.collection('results').doc(uid);
              const resultSnap: any = await tx.get(resultRef);

              const isHost = tournament.hostId === uid;
              const isParticipant = regSnap.exists;
              if (!isHost && !isParticipant && !resultSnap.exists) {
                return { deleteDraft: false };
              }

              // Draft hosted tournament: mark deleting_draft inside tx, then delete subcollections in paginated 400-op batches outside tx
              if (isHost && (tournament.status === 'draft' || tournament.status === 'deleting_draft')) {
                tx.set(tRef, { ...tournament, status: 'deleting_draft', updatedAt: nowIso }, { merge: true });
                return { deleteDraft: true };
              }

              const updatedTournament: any = { ...tournament, updatedAt: nowIso };

              if (isHost) {
                updatedTournament.hostId = pseudoId;
                updatedTournament.hostName = 'Deleted Host';
                updatedTournament.hostAnonymized = true;
                if (
                  tournament.status === 'registration_open' ||
                  tournament.status === 'active'
                ) {
                  updatedTournament.status = 'cancelled';
                  updatedTournament.cancelReason = 'host_account_deleted';
                  updatedTournament.cancelledAt = nowIso;
                }
              }

              if (updatedTournament.championId === uid) {
                updatedTournament.championId = pseudoId;
                updatedTournament.championNickname = 'Deleted Participant';
              }

              // Anonymize participant references in bracket rounds & match documents
              if (Array.isArray(updatedTournament.rounds)) {
                updatedTournament.rounds = updatedTournament.rounds.map((round: any) => ({
                  ...round,
                  matches: Array.isArray(round.matches)
                    ? round.matches.map((m: any) => {
                        const updatedMatch = { ...m };
                        let changed = false;
                        if (updatedMatch.player1Id === uid) {
                          updatedMatch.player1Id = pseudoId;
                          updatedMatch.player1Nickname = 'Deleted Participant';
                          changed = true;
                        }
                        if (updatedMatch.player2Id === uid) {
                          updatedMatch.player2Id = pseudoId;
                          updatedMatch.player2Nickname = 'Deleted Participant';
                          changed = true;
                        }
                        if (updatedMatch.winnerId === uid) {
                          updatedMatch.winnerId = pseudoId;
                          changed = true;
                        }
                        if (changed) {
                          tx.set(tRef.collection('matches').doc(updatedMatch.id), updatedMatch);
                        }
                        return updatedMatch;
                      })
                    : [],
                }));
              }

              if (isParticipant) {
                const regData = regSnap.data() || {};
                if (
                  tournament.status === 'registration_open' &&
                  regData.status === 'registered'
                ) {
                  updatedTournament.participantCount = Math.max(
                    0,
                    (Number(updatedTournament.participantCount) || 1) - 1
                  );
                  tx.set(
                    regRef,
                    {
                      ...regData,
                      participantId: pseudoId,
                      participantNickname: 'Deleted Participant',
                      nickname: 'Deleted Participant',
                      status: 'withdrawn',
                      withdrawnAt: nowIso,
                      anonymized: true,
                    },
                    { merge: true }
                  );
                } else {
                  tx.set(
                    regRef,
                    {
                      ...regData,
                      participantId: pseudoId,
                      participantNickname: 'Deleted Participant',
                      nickname: 'Deleted Participant',
                      anonymized: true,
                    },
                    { merge: true }
                  );
                }
              }

              if (resultSnap.exists) {
                tx.set(
                  resultRef,
                  {
                    ...resultSnap.data(),
                    participantId: pseudoId,
                    nickname: 'Deleted Participant',
                    anonymized: true,
                  },
                  { merge: true }
                );
              }

              tx.set(tRef, updatedTournament);
              job.counts.anonymizedTournaments++;
              return { deleteDraft: false };
            });

            if (txOutcome?.deleteDraft) {
              for (const sub of ['registrations', 'matches', 'results']) {
                await queryAndDeleteAll(adminDb, tRef.collection(sub));
              }
              await tRef.delete();
              job.counts.anonymizedTournaments++;
            }
          }
          break;
        }

        case 'handle_games': {
          const gameDocs = await getAllDocsPaginated(adminDb.collection('games'));

          for (const gameDoc of gameDocs) {
            const game = gameDoc.data() || {};
            const isHost = game.hostId === uid;

            const playersDocs = await getAllDocsPaginated(gameDoc.ref.collection('players'));
            const otherPlayers = playersDocs.filter(p => p.id !== uid);
            const isSharedOrLinked = otherPlayers.length > 0 || Boolean(game.tournamentId);

            if (isHost && !isSharedOrLinked) {
              const subcollections = [
                'players',
                'answers',
                'secrets',
                'kickedPlayers',
                'guestEmails',
                'flags',
                'questionsQA',
              ];
              for (const sub of subcollections) {
                await queryAndDeleteAll(adminDb, gameDoc.ref.collection(sub));
              }
              await gameDoc.ref.delete();
              job.counts.deletedGames++;
              continue;
            }

            let touched = false;
            if (isHost) {
              await gameDoc.ref.set(
                {
                  hostId: pseudoId,
                  hostName: 'Deleted Host',
                  hostAnonymized: true,
                },
                { merge: true }
              );
              touched = true;
            }

            // Delete user's private guestEmail and kickedPlayers markers
            const guestEmailRef = gameDoc.ref.collection('guestEmails').doc(uid);
            const guestEmailSnap = await guestEmailRef.get();
            if (guestEmailSnap?.exists) {
              await guestEmailRef.delete();
              touched = true;
            }

            const kickedRef = gameDoc.ref.collection('kickedPlayers').doc(uid);
            const kickedSnap = await kickedRef.get();
            if (kickedSnap?.exists) {
              await kickedRef.delete();
              touched = true;
            }

            // Anonymize player record in shared game to preserve cohort totals
            const playerRef = gameDoc.ref.collection('players').doc(uid);
            const playerSnap = await playerRef.get();
            if (playerSnap?.exists) {
              await playerRef.set(
                {
                  id: pseudoId,
                  name: 'Deleted Player',
                  nickname: 'Deleted Player',
                  email: null,
                  avatar: null,
                  avatarConfig: null,
                  anonymized: true,
                },
                { merge: true }
              );
              job.counts.deletedPlayerRecords++;
              touched = true;
            }

            // Anonymize user-owned answers, flags, and Q&A in shared games
            const userAnswers = await getAllDocsPaginated(
              gameDoc.ref.collection('answers').where('playerId', '==', uid)
            );
            for (const aDoc of userAnswers) {
              await aDoc.ref.set({ playerId: pseudoId, anonymized: true }, { merge: true });
              touched = true;
            }

            const userFlags = await getAllDocsPaginated(
              gameDoc.ref.collection('flags').where('playerId', '==', uid)
            );
            for (const fDoc of userFlags) {
              await fDoc.ref.set({ playerId: pseudoId, anonymized: true }, { merge: true });
              touched = true;
            }

            const userQa = await getAllDocsPaginated(
              gameDoc.ref.collection('questionsQA').where('authorId', '==', uid)
            );
            for (const qDoc of userQa) {
              await qDoc.ref.set(
                { authorId: pseudoId, authorName: 'Deleted Participant', anonymized: true },
                { merge: true }
              );
              touched = true;
            }

            if (touched) {
              job.counts.anonymizedGames++;
            }
          }
          break;
        }

        case 'handle_certificates': {
          const nowIso = new Date().toISOString();

          // Certificates owned by the deleted user: anonymize PII while preserving validity/status
          const ownedCerts = await getAllDocsPaginated(
            adminDb.collection('certificates').where('ownerId', '==', uid)
          );
          for (const certDoc of ownedCerts) {
            const cert = certDoc.data() || {};
            await certDoc.ref.set(
              {
                ownerId: pseudoId,
                recipientName: 'Deleted Participant',
                recipientEmail: null,
                anonymized: true,
                anonymizedAt: nowIso,
              },
              { merge: true }
            );
            if (cert.verificationId) {
              const verifRef = adminDb
                .collection('certificateVerification')
                .doc(cert.verificationId);
              const verifSnap = await verifRef.get();
              if (verifSnap?.exists) {
                await verifRef.set(
                  {
                    recipientName: 'Deleted Participant',
                    anonymized: true,
                    anonymizedAt: nowIso,
                  },
                  { merge: true }
                );
              }
            }
            job.counts.anonymizedCertificates++;
          }

          // Certificates issued by the deleted user to OTHER users: anonymize issuer only; never revoke
          const issuedCerts = await getAllDocsPaginated(
            adminDb.collection('certificates').where('issuerId', '==', uid)
          );
          for (const certDoc of issuedCerts) {
            await certDoc.ref.set(
              {
                issuerId: pseudoId,
                issuerName: 'Former Host',
                issuerAnonymized: true,
              },
              { merge: true }
            );
            job.counts.anonymizedCertificates++;
          }
          break;
        }

        case 'purge_storage': {
          if (!adminStorage) {
            throw new Error('Firebase Storage service is unavailable for purge.');
          }
          const bucket =
            typeof adminStorage.bucket === 'function' ? adminStorage.bucket() : adminStorage;
          if (!bucket || typeof bucket.getFiles !== 'function' || typeof bucket.deleteFiles !== 'function') {
            throw new Error('Firebase Storage bucket is unavailable for purge.');
          }
          const [files] = await bucket.getFiles({ prefix: `users/${uid}/` });
          if (Array.isArray(files) && files.length > 0) {
            await bucket.deleteFiles({ prefix: `users/${uid}/` });
            job.counts.deletedStorageFiles += files.length;
          }
          break;
        }

        case 'delete_auth_and_profile': {
          // 1. Delete Firebase Auth account FIRST; preserve users/{uid} in deletion_pending if Auth deletion fails
          try {
            await adminAuth.deleteUser(uid);
          } catch (authErr: any) {
            if (authErr?.code !== 'auth/user-not-found') {
              throw authErr;
            }
          }

          // 2. Delete Firestore user profile ONLY after Auth deletion succeeds or confirms user-not-found
          const userDocRef = adminDb.collection('users').doc(uid);
          const userDocSnap = await userDocRef.get();
          if (userDocSnap?.exists) {
            await userDocRef.delete();
          }
          break;
        }

        case 'finalize_job': {
          const completedAt = new Date().toISOString();
          const finalizedJob: AccountDeletionJob = {
            ...job,
            completedStages: [...job.completedStages, 'finalize_job'],
            status: 'completed',
            completedAt,
            uid: '[purged]',
            recoveryTokenHash: null,
            sanitizedError: null,
          };
          await persistJobProgress(adminDb, finalizedJob, 'completed');
          Object.assign(job, finalizedJob);
          continue;
        }
      }

      job.completedStages.push(stage);
      await persistJobProgress(adminDb, job);
    } catch (err: any) {
      job.status = 'failed';
      job.sanitizedError = sanitizeStageError(stage, err);
      await persistJobProgress(adminDb, job, 'failed');
      return job;
    }
  }

  return job;
}

export function toSanitizedJobResponse(
  job: AccountDeletionJob,
  recoveryToken?: string
) {
  return {
    jobId: job.id,
    status: job.status,
    currentStage: job.currentStage,
    completedStages: job.completedStages,
    attempts: job.attempts,
    createdAt: job.createdAt,
    processingStartedAt: job.processingStartedAt,
    completedAt: job.completedAt,
    updatedAt: job.updatedAt,
    retentionExpiresAt: job.retentionExpiresAt,
    error: job.sanitizedError || undefined,
    counts: job.counts,
    ...(recoveryToken ? { recoveryToken } : {}),
  };
}
