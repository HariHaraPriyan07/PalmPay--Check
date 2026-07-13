// Shared domain types — mirrors the Firestore data model (§4 of the brief).

export type Role = "advisor" | "coordinator" | "hod";

export type AttendanceStatus = "present" | "absent" | "od" | "others";
export type AttendanceMethod = "palm" | "manual";
export type EnrollmentStatus = "not_enrolled" | "enrolled" | "failed";
export type VerifyOutcome = "accept" | "retry" | "reject";

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
  embedding: number[]; // 256 floats, L2-normalized
  modelVersion: string;
  enrollmentDate: string; // YYYY-MM-DD
  deviceInfo: string;
  qualityScore: number; // 0..1 average capture quality
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
}
