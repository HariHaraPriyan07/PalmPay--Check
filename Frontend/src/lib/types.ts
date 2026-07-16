// Shared domain types — mirrors the Firestore data model (§4 of the brief).

export type Role = "advisor" | "coordinator" | "hod";

export type AttendanceStatus = "present" | "absent" | "od" | "others";
export type AttendanceMethod = "palm" | "manual";
export type EnrollmentStatus = "not_enrolled" | "enrolled" | "failed";
export type VerifyOutcome = "accept" | "retry" | "reject";
/** Which hand MediaPipe reported. Labels are self-consistent enroll↔verify. */
export type Handedness = "Left" | "Right";

export interface UserDoc {
  uid: string;
  email: string;
  role: Role;
  /** Advisors only — section they own (A–Q). */
  assignedSection?: string;
  name: string;
}

export interface SectionDoc {
  sectionId: string; // 'A'..'Q'
  advisorUid: string;
  year: number; // 3
  department: string; // 'CSE'
}

export interface StudentDoc {
  studentId: string; // roll number, doc id
  name: string;
  sectionId: string;
  enrollmentStatus: EnrollmentStatus;
  consentGiven: boolean;
  consentTimestamp?: number; // epoch ms
}

export interface EmbeddingDoc {
  studentId: string; // doc id
  sectionId: string; // denormalized so security rules can enforce section isolation
  embedding: number[]; // 256 floats, L2-normalized (stored RAW; centered at match time)
  modelVersion: string;
  enrollmentDate: string; // YYYY-MM-DD
  deviceInfo: string;
  qualityScore: number; // 0..1 average capture quality
  /** Hand enrolled — verification requires the SAME hand (left/right, §5). */
  handedness?: Handedness;
}

export interface AttendanceRecordDoc {
  studentId: string;
  sectionId: string;
  date: string; // YYYY-MM-DD — doc id is `${date}_${studentId}` (prevents duplicates)
  status: AttendanceStatus;
  /** Required when status === 'others'. */
  reason?: string;
  markedBy: string; // advisor uid
  method: AttendanceMethod;
  similarityScore?: number; // present only when method === 'palm'
  /** 1:N identification: 2nd-best score + who, so a low margin is auditable. */
  runnerUpScore?: number;
  runnerUpStudentId?: string;
  livenessScore?: number; // anti-spoof signal logged with palm marks (§9)
  timestamp: number; // epoch ms
}

export interface CalendarDayDoc {
  date: string; // YYYY-MM-DD, doc id
  isWorkingDay: boolean;
  reason?: string; // holiday name / exam / etc.
}

export interface AttendanceSummaryDoc {
  studentId: string; // doc id
  sectionId: string;
  workingDaysSoFar: number;
  presentCount: number;
  percentage: number; // 0..100
  belowThreshold: boolean; // true when percentage < ATTENDANCE_THRESHOLD_PERCENT
  updatedAt: number;
}

export interface VerificationEventDoc {
  studentId: string;
  sectionId: string;
  date: string;
  similarity: number;
  outcome: VerifyOutcome;
  qualityScore: number;
  livenessScore: number;
  modelVersion: string;
  timestamp: number;
  /** 1:N identification telemetry (FAR/FRR): best-match margin over 2nd place. */
  runnerUpScore?: number;
  runnerUpStudentId?: string;
  /** How many section templates the probe was searched against (1:N cohort size). */
  cohortSize?: number;
}
