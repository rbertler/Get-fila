export interface User {
  id: string;
  email: string;
  name: string;
  dateOfBirth?: string;
  googleConnected?: boolean;
}

export type RecordType =
  | 'LAB_REPORT'
  | 'VISIT_SUMMARY'
  | 'IMAGING'
  | 'PRESCRIPTION'
  | 'REFERRAL'
  | 'OPERATIVE_REPORT'
  | 'AI_SUMMARY'
  | 'OTHER';

export type HistoryCategory =
  | 'CONDITION'
  | 'MEDICATION'
  | 'SUPPLEMENT'
  | 'ALLERGY'
  | 'SURGERY'
  | 'VACCINATION'
  | 'FAMILY_HISTORY';

export type ImagingStudyType =
  | 'XRAY'
  | 'MRI'
  | 'CT_SCAN'
  | 'ULTRASOUND'
  | 'PET_SCAN'
  | 'MAMMOGRAM'
  | 'ECHOCARDIOGRAM'
  | 'OTHER';

export interface ImagingStudy {
  id: string;
  studyType: ImagingStudyType;
  bodyPart: string;
  description?: string;
  studyDate: string;
  facility?: string;
  radiologist?: string;
  providerName?: string;
  summary: string;
  notes?: string;
  sourceRecordId?: string;
  createdAt: string;
}

export type VitalType =
  | 'WEIGHT'
  | 'BLOOD_PRESSURE'
  | 'HEART_RATE'
  | 'TEMPERATURE'
  | 'OXYGEN_SATURATION'
  | 'BLOOD_GLUCOSE'
  | 'STEPS'
  | 'SLEEP_HOURS';

export type AppointmentSource = 'MANUAL' | 'GOOGLE_CALENDAR' | 'GMAIL';

export interface MedicalRecord {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  recordType: RecordType;
  recordDate?: string;
  providerName?: string;
  notes?: string;
  aiSummary?: string;
  createdAt: string;
}

export interface MedicalHistoryEntry {
  id: string;
  category: HistoryCategory;
  name: string;
  details?: string;
  relative?: string;
  startDate?: string;
  endDate?: string;
  sourceRecordId?: string;
  isManual: boolean;
  createdAt: string;
}

export interface Appointment {
  id: string;
  providerName: string;
  specialty?: string;
  scheduledAt: string;
  duration?: number;
  reason?: string;
  notes?: string;
  location?: string;
  source: AppointmentSource;
  googleEventId?: string;
}

export interface LabResult {
  id: string;
  testName: string;
  value: number;
  unit: string;
  referenceMin?: number;
  referenceMax?: number;
  isFlagged: boolean;
  recordedAt: string;
  sourceRecordId?: string;
  providerName?: string;
  notes?: string;
}

export interface Vital {
  id: string;
  type: VitalType;
  value: number;
  value2?: number;
  unit: string;
  recordedAt: string;
  notes?: string;
  source: string;
}

export interface InsightItem {
  title: string;
  description: string;
  confidence: 'low' | 'moderate' | 'high';
  supportingEvidence: Array<{ text: string; source: string; date: string }>;
  suggestedDiscussion: string;
  relatedConditions: string[];
}

export interface HealthInsightReport {
  id: string;
  summary: string;
  insights: InsightItem[];
  gaps: string[];
  generatedAt: string;
  reportType: 'general' | 'focused' | 'thematic';
  scopeLabel?: string;
}

export interface Provider {
  id: string;
  name: string;
  providerType?: string;
  specialty?: string;
  affiliation?: string;
  phone?: string;
  fax?: string;
  address?: string;
  email?: string;
  website?: string;
  notes?: string;
  isManual: boolean;
  isArchived: boolean;
  sourceRecordIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ShareToken {
  id: string;
  token: string;
  expiresAt: string;
  createdAt: string;
  accessCount: number;
  config: Record<string, unknown>;
}

export interface DashboardStats {
  recordCount: number;
  lastAppointment?: { scheduledAt: string; providerName: string; specialty?: string } | null;
  flaggedLabCount: number;
  latestInsightDate?: string | null;
}
