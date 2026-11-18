export type ClassId = 'hokkaido' | 'saitama' | 'nara' | 'kaigo';

export type LanguageMode = 'both' | 'ja' | 'id';

export type QuestionCategory =
  | 'kana'
  | 'vocab'
  | 'kanji'
  | 'grammar'
  | 'reading'
  | 'listening'
  | 'conversation'
  | 'kaigo'
  | 'jlpt_jft';

export type TestType = 'daily' | 'weekly';

export interface ClassMeta {
  id: ClassId;
  nameJa: string;
  nameId: string;
  subtitleJa: string;
  subtitleId: string;
  focus: 'kana_minna' | 'irodori_jlpt' | 'conversation' | 'kaigo';
}

export const CLASSES: ClassMeta[] = [
  {
    id: 'hokkaido',
    nameJa: '北海道クラス',
    nameId: 'Kelas Hokkaido',
    subtitleJa: '初級ゼロから（かな・みんなの日本語 L6-7）',
    subtitleId: 'Pemula dari nol (Kana & Minna no Nihongo Bab 6-7)',
    focus: 'kana_minna',
  },
  {
    id: 'saitama',
    nameJa: '埼玉クラス',
    nameId: 'Kelas Saitama',
    subtitleJa: 'いろどり・JFT / JLPT 毎日対策',
    subtitleId: 'Buku Irodori & Latihan Harian JFT / JLPT',
    focus: 'irodori_jlpt',
  },
  {
    id: 'nara',
    nameJa: '奈良クラス',
    nameId: 'Kelas Nara',
    subtitleJa: '会話中心（特定技能・JLPT合格後）',
    subtitleId: 'Fokus Percakapan (Lulus JLPT / SSW)',
    focus: 'conversation',
  },
  {
    id: 'kaigo',
    nameJa: '介護クラス',
    nameId: 'Kelas Kaigo',
    subtitleJa: '介護日本語・特定技能介護面接対策',
    subtitleId: 'Kosakata Perawatan & Wawancara Tokutei Ginou',
    focus: 'kaigo',
  },
];

export const QUESTION_CATEGORIES: {
  id: QuestionCategory;
  ja: string;
  idLabel: string;
}[] = [
  { id: 'kana', ja: 'ひらがな・カタカナ', idLabel: 'Hiragana & Katakana' },
  { id: 'vocab', ja: '語彙・単語', idLabel: 'Kosakata (Goi)' },
  { id: 'kanji', ja: '漢字', idLabel: 'Kanji' },
  { id: 'grammar', ja: '文法', idLabel: 'Tata Bahasa (Bunpou)' },
  { id: 'reading', ja: '読解', idLabel: 'Membaca (Dokkai)' },
  { id: 'listening', ja: '聴解', idLabel: 'Mendengar (Choukai)' },
  { id: 'conversation', ja: '会話', idLabel: 'Percakapan (Kaiwa)' },
  { id: 'kaigo', ja: '介護専門用語', idLabel: 'Istilah Kaigo' },
  { id: 'jlpt_jft', ja: 'JLPT / JFT模擬', idLabel: 'Latihan JLPT / JFT' },
];

export interface UserProfile {
  uid: string;
  displayName: string;
  role: 'head' | 'teacher';
  status: 'active' | 'pending' | 'disabled';
  assignedClasses: ClassId[];
  fullName?: string;
  nickname?: string;
  avatarDataUrl?: string;
  profileCompleted?: boolean;
  lastLoginAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StaffInvite {
  id: string;
  email: string;
  displayName: string;
  role: 'head' | 'teacher';
  assignedClasses: ClassId[];
  createdBy: string;
  createdAt?: unknown;
}

export interface Student {
  id: string;
  name: string;
  studentCode: string;
  classId: ClassId;
  targetGoal: string;
  active: boolean;
  notes: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StudentNote {
  studentId: string;
  studentName: string;
  note: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'revision_needed';

export interface DailyReport {
  id: string;
  date: string;
  classId: ClassId;
  teacherUid: string;
  teacherName: string;
  totalStudents: number;
  presentCount: number;
  absentNames: string[];
  lateNames: string[];
  kanaProgress: string;
  textbookUnit: string;
  examPractice: string;
  conversationTopic: string;
  kaigoTopic: string;
  homework: string;
  atmosphere: number;
  issues: string;
  tomorrowPlan: string;
  overallComment: string;
  studentNotes: StudentNote[];
  approvalStatus: ApprovalStatus;
  headFeedback: string;
  approvedBy: string;
  approvedAt: string;
  commentedAt?: string;
  commentReadByTeacher?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface WeeklyStudentEntry {
  studentId: string;
  studentName: string;
  progressNote: string;
  comment: string;
  attitudeScore: number; // 1-5 overall attitude
  subAttendance?: number; // 1-5
  subDiscipline?: number; // 1-5
  subEffort?: number; // 1-5
  subCooperation?: number; // 1-5
  attitudeNote?: string;
}

export interface WeeklyReport {
  id: string;
  weekKey: string;
  classId: ClassId;
  teacherUid: string;
  teacherName: string;
  status: 'draft' | 'submitted';
  submittedAt: string;
  summaryTaught: string;
  classProgress: string;
  issues: string;
  nextWeekPlan: string;
  studentEntries: WeeklyStudentEntry[];
  headComment: string;
  headCommentBy: string;
  headCommentAt: string;
  commentReadByTeacher: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ScheduleRow {
  id: string;
  day: string;
  timeSlot: string;
  className: string;
  teacher: string;
  teacherUid?: string;
  subject: string;
  room: string;
  note: string;
}

export interface ScheduleDoc {
  id: string;
  title: string;
  periodLabel: string;
  rows: ScheduleRow[];
  updatedBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type QuestionReviewStatus = 'draft' | 'pending' | 'approved' | 'rejected';

export interface QuestionItem {
  id: string;
  classId: ClassId | 'all';
  category: QuestionCategory;
  testType: TestType;
  questionFormat: 'multiple_choice' | 'written';
  prompt: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  points: number;
  chapterGroup?: string;
  audioDataUrl?: string;
  audioFileName?: string;
  reviewStatus?: QuestionReviewStatus;
  reviewReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface TestSheet {
  id: string;
  title: string;
  classId: ClassId;
  testType: TestType;
  date: string;
  weekKey: string;
  questionIds: string[];
  totalPoints: number;
  createdBy: string;
  createdByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface TestResult {
  id: string;
  studentId: string;
  studentName: string;
  classId: ClassId;
  testType: TestType;
  date: string;
  weekKey: string;
  sheetId: string;
  testTitle: string;
  category: string;
  entryMode: 'answer_key' | 'manual';
  earnedScore: number;
  maxScore: number;
  scorePercent: number;
  questionOutcomes: boolean[];
  wrongCategories: string[];
  note: string;
  gradedBy: string;
  gradedByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type HeadJournalCategory =
  | 'decision'
  | 'meeting'
  | 'incident'
  | 'idea'
  | 'evaluation'
  | 'todo';

export interface JournalTodoItem {
  id: string;
  text: string;
  dueDate: string;
  done: boolean;
}

export interface HeadJournalEntry {
  id: string;
  date: string;
  title: string;
  category: HeadJournalCategory;
  content: string;
  relatedClassId: ClassId | '';
  relatedTeacherUid: string;
  relatedTeacherName: string;
  relatedStudentId: string;
  relatedStudentName: string;
  attachmentName: string;
  attachmentDataUrl: string;
  pinned: boolean;
  todoItems: JournalTodoItem[];
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Announcement {
  id: string;
  title: string;
  message: string;
  pinned: boolean;
  createdBy: string;
  createdByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AnnouncementRead {
  id: string;
  annId: string;
  uid: string;
  name: string;
  readAt?: unknown;
}

export interface QualityThresholds {
  minWeeklyAvgThreshold: number;
  consecutiveDropWeeks: number;
  maxAbsentDays: number;
  minAttitudeThreshold: number;
  examWeightPercent: number;
  attitudeWeightPercent: number;
  updatedBy: string;
  updatedAt?: unknown;
}

export const DEFAULT_QUALITY_THRESHOLDS: QualityThresholds = {
  minWeeklyAvgThreshold: 70,
  consecutiveDropWeeks: 2,
  maxAbsentDays: 2,
  minAttitudeThreshold: 2.5,
  examWeightPercent: 70,
  attitudeWeightPercent: 30,
  updatedBy: '',
};

export type AlertTypeKey = 'score_drop' | 'low_avg' | 'frequent_absence' | 'low_attitude';

export interface HandledAlert {
  id: string;
  studentId: string;
  studentName: string;
  classId: ClassId;
  alertKey: AlertTypeKey;
  reasonSummary: string;
  note: string;
  handledBy: string;
  handledByName: string;
  handledAt: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StudentProfileNote {
  id: string;
  studentId: string;
  classId: ClassId;
  authorUid: string;
  authorName: string;
  authorRole: 'head' | 'teacher';
  note: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type ActivityActionType =
  | 'role_change'
  | 'user_add'
  | 'user_remove'
  | 'schedule_update'
  | 'data_create'
  | 'data_update'
  | 'data_delete'
  | 'report_review'
  | 'question_approve'
  | 'question_reject'
  | 'announcement_create'
  | 'weekly_report_submit'
  | 'alert_handle'
  | 'threshold_update';

export type ActivityTargetType =
  | 'user'
  | 'schedule'
  | 'student'
  | 'report'
  | 'weeklyReport'
  | 'question'
  | 'sheet'
  | 'testResult'
  | 'announcement'
  | 'alert'
  | 'settings';

export interface ActivityLogEntry {
  id: string;
  actorUid: string;
  actorName: string;
  actionType: ActivityActionType;
  targetType: ActivityTargetType;
  targetLabel: string;
  detail: string;
  createdAt?: unknown;
}

