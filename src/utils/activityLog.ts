import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { ActivityActionType, ActivityTargetType, UserProfile } from '../types';
import { clampStr } from './payloadGuards';

export async function logActivity(params: {
  actor: Pick<UserProfile, 'uid' | 'displayName' | 'nickname'>;
  actionType: ActivityActionType;
  targetType: ActivityTargetType;
  targetLabel: string;
  detail: string;
}): Promise<void> {
  const { actor, actionType, targetType, targetLabel, detail } = params;
  if (!actor.uid) return;
  try {
    await addDoc(collection(db, 'activityLogs'), {
      actorUid: clampStr(actor.uid, 128),
      actorName: clampStr(actor.nickname || actor.displayName, 100) || 'Staff',
      actionType,
      targetType,
      targetLabel: clampStr(targetLabel, 200),
      detail: clampStr(detail, 400),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    // Non-blocking audit logging so primary operations never fail silently on log write
    console.warn('Activity log write skipped:', err);
  }
}
