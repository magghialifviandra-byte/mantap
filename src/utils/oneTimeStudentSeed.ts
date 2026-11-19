import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Student, UserProfile } from '../types';
import { importStudentsBatch } from './studentImport';

const ONE_TIME_MIGRATION_ID = 'batch14_unassigned_20261118';

const INITIAL_UNASSIGNED_COHORT = [
  'ADSELA WAHYU AL ARIF',
  'DEDEN KURNIA',
  'DILA STEVANI',
  'HILDA AL FITRI',
  'KIKI FARHAN TAKDIR',
  'RUSLIAN',
  'SAMUEL WIBOWO SIM',
  'STEILLA SWITTENIA PUSPITA ALYA',
  'CRISTEVEN ARDIANSYAH',
  'GABRIEL ADIAZ PRIYATNA',
  'RAFI AFRIYADI',
  'RIYAN PRANATA',
  'SELLA PITRIYAH',
  'TIKA WIDIA ASTUTI',
] as const;

export interface OneTimeSeedResult {
  executed: boolean;
  addedCount: number;
  skippedCount: number;
}

let inFlightSeed: Promise<OneTimeSeedResult | null> | null = null;

/**
 * Self-disabling one-time seed executed ONLY for an active Admin ('head').
 * Reads `systemMigrations/batch14_unassigned_20261118` first; once marked complete,
 * it exits immediately on all future sessions without querying or writing students.
 */
export async function runOneTimeStudentSeedIfAdmin(
  profile: UserProfile | null
): Promise<OneTimeSeedResult | null> {
  if (!profile || profile.role !== 'head' || profile.status !== 'active') {
    return null;
  }

  if (inFlightSeed) {
    return inFlightSeed;
  }

  inFlightSeed = (async () => {
    try {
      const migRef = doc(db, 'systemMigrations', ONE_TIME_MIGRATION_ID);
      const migSnap = await getDoc(migRef);
      if (migSnap.exists()) {
        return null;
      }

      const existingSnap = await getDocs(collection(db, 'students'));
      const existingStudents: Pick<Student, 'name'>[] = existingSnap.docs.map((d) => ({
        name: String(d.data()?.name || ''),
      }));

      const result = await importStudentsBatch({
        names: [...INITIAL_UNASSIGNED_COHORT],
        classId: '',
        actor: profile,
        existingStudents,
        logLabel: '14 students imported',
        logDetail: `Unassigned batch seed (${INITIAL_UNASSIGNED_COHORT.length} target)`,
      });

      await setDoc(migRef, {
        executedBy: profile.uid,
        addedCount: result.addedCount,
        skippedCount: result.skippedCount,
        createdAt: serverTimestamp(),
      });

      return {
        executed: true,
        addedCount: result.addedCount,
        skippedCount: result.skippedCount,
      };
    } catch (err) {
      console.warn('One-time student seed skipped due to error:', err);
      return null;
    } finally {
      inFlightSeed = null;
    }
  })();

  return inFlightSeed;
}
