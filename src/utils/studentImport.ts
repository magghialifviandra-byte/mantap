import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { ClassId, Student, UserProfile } from '../types';
import { logActivity } from './activityLog';
import { clampStr } from './payloadGuards';

export function normalizeStudentNameKey(name: string): string {
  return (name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export interface BatchImportResult {
  addedCount: number;
  skippedCount: number;
  addedNames: string[];
  skippedNames: string[];
}

export async function importStudentsBatch(params: {
  names: string[];
  classId: ClassId | '';
  actor: Pick<UserProfile, 'uid' | 'displayName' | 'nickname'>;
  existingStudents: Pick<Student, 'name'>[];
  logLabel?: string;
  logDetail?: string;
}): Promise<BatchImportResult> {
  const { names, classId, actor, existingStudents, logLabel, logDetail } = params;

  const existingKeys = new Set(
    existingStudents.map((s) => normalizeStudentNameKey(s.name)).filter(Boolean)
  );

  const toCreate: string[] = [];
  const skippedNames: string[] = [];

  for (const raw of names) {
    const cleanName = clampStr(raw, 120);
    if (!cleanName) continue;
    const key = normalizeStudentNameKey(cleanName);
    if (existingKeys.has(key)) {
      skippedNames.push(cleanName);
      continue;
    }
    existingKeys.add(key);
    toCreate.push(cleanName);
  }

  // Commit in chunks <= 400 to stay safely within Firestore batch limits
  const CHUNK_SIZE = 400;
  for (let i = 0; i < toCreate.length; i += CHUNK_SIZE) {
    const chunk = toCreate.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((studentName) => {
      const ref = doc(collection(db, 'students'));
      batch.set(ref, {
        name: studentName,
        studentCode: '',
        classId,
        targetGoal: '',
        active: true,
        notes: '',
        createdBy: clampStr(actor.uid, 128),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }

  if (toCreate.length > 0) {
    const destLabel = classId === '' ? 'Unassigned' : classId;
    await logActivity({
      actor,
      actionType: 'data_create',
      targetType: 'student',
      targetLabel: clampStr(logLabel || `${toCreate.length} students imported`, 200),
      detail: clampStr(
        logDetail ||
          `Imported ${toCreate.length} student(s) to ${destLabel}${
            skippedNames.length > 0 ? ` (${skippedNames.length} duplicate skipped)` : ''
          }`,
        400
      ),
    });
  }

  return {
    addedCount: toCreate.length,
    skippedCount: skippedNames.length,
    addedNames: toCreate,
    skippedNames,
  };
}
