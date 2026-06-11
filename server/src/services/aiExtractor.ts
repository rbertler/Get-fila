/**
 * AI-powered medical record extraction using Claude.
 * Replaces the regex-based recordExtractor for all structured data extraction.
 *
 * Falls back gracefully to an empty result if ANTHROPIC_API_KEY is not set
 * or if the API call fails — the caller can then use the regex extractor as backup.
 */

import Anthropic from '@anthropic-ai/sdk';

// ── Output types (shared with records.ts) ────────────────────────────────────

export interface AIExtractedLab {
  testName: string;
  value: number;
  unit: string;
  referenceMin?: number;
  referenceMax?: number;
  isFlagged: boolean;
  recordedAt?: string; // ISO date of collection/report if different from overall record date
}

export interface AIExtractedCondition {
  name: string;
  details?: string;
  startDate?: string; // ISO date when condition was diagnosed/noted in this record
}

export interface AIExtractedMedication {
  name: string;
  dosage?: string;
  details?: string;
  startDate?: string; // ISO date when prescribed/noted in this record
}

export type AIImagingStudyType =
  | 'XRAY' | 'MRI' | 'CT_SCAN' | 'ULTRASOUND'
  | 'PET_SCAN' | 'MAMMOGRAM' | 'ECHOCARDIOGRAM' | 'OTHER';

export interface AIExtractedImaging {
  studyType: AIImagingStudyType;
  bodyPart: string;
  description?: string; // Human-readable study name override (especially for OTHER types)
  summary: string;
  facility?: string;
  studyDate?: string; // ISO date string
}

export interface AIExtractedSurgery {
  name: string;       // e.g. "Appendectomy", "Laparoscopic Cholecystectomy"
  details?: string;   // optional notes (approach, findings, complications)
  startDate?: string; // ISO date of the procedure
}

export interface AIExtractedProvider {
  name: string;
  providerType?: string;
  specialty?: string;
}

export type AIVitalType =
  | 'WEIGHT' | 'BLOOD_PRESSURE' | 'HEART_RATE' | 'TEMPERATURE'
  | 'OXYGEN_SATURATION' | 'BLOOD_GLUCOSE';

export interface AIExtractedVital {
  type: AIVitalType;
  value: number;       // primary value (systolic for BP)
  value2?: number;     // diastolic for BLOOD_PRESSURE only
  unit: string;        // standardized: lbs, mmHg, bpm, °F, %, mg/dL
  recordedAt?: string; // ISO date of this reading if distinct from record date
}

export type AIRecordType =
  | 'LAB_REPORT' | 'VISIT_SUMMARY' | 'IMAGING' | 'PRESCRIPTION'
  | 'REFERRAL' | 'OPERATIVE_REPORT' | 'OTHER';

export interface AIExtractionResult {
  recordType: AIRecordType;
  recordDate: string | null;
  provider: AIExtractedProvider | null;
  labs: AIExtractedLab[];
  conditions: AIExtractedCondition[];
  medications: AIExtractedMedication[];
  surgeries: AIExtractedSurgery[];
  imaging: AIExtractedImaging | null;
  vitals: AIExtractedVital[];
}

// ── Client ───────────────────────────────────────────────────────────────────

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

// ── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a medical records data extraction assistant. Your job is to read medical document text and extract structured health data from it.

You MUST respond with ONLY a valid JSON object — no markdown, no explanation, no code fences. Just raw JSON.

The JSON must match this exact schema:
{
  "recordType": "LAB_REPORT" | "VISIT_SUMMARY" | "IMAGING" | "PRESCRIPTION" | "REFERRAL" | "OPERATIVE_REPORT" | "OTHER",
  "recordDate": string | null,  // ISO 8601 date string (YYYY-MM-DD) of when the record was created/visit occurred, or null if not found
  "provider": {
    "name": string,           // Full name as it appears (e.g. "Jane Smith, MD")
    "providerType": string,   // e.g. "Medical Doctor", "Nurse Practitioner", "Physician Assistant" — no abbreviations in parentheses
    "specialty": string       // e.g. "Cardiology", "Family Medicine"
  } | null,
  "labs": [
    {
      "testName": string,       // Normalized, human-readable name (e.g. "Iron Binding Capacity (TIBC)" not "Iron Bind.Cap.(TIBC)")
      "value": number,
      "unit": string,
      "referenceMin": number | null,
      "referenceMax": number | null,
      "isFlagged": boolean,     // true if value is outside reference range, or marked H/L/HIGH/LOW/ABNORMAL
      "recordedAt": string | null  // ISO 8601 date of specimen collection or result report for THIS test, if it differs from the overall record date. Use the most specific date available (e.g. the collection date printed next to this result, not the document print date).
    }
  ],
  "conditions": [
    {
      "name": string,           // Short, clean condition name (e.g. "Type 2 Diabetes", "ADHD")
      "details": string | null, // Optional: stage, severity, or qualifier
      "startDate": string | null  // ISO 8601 date when this condition was diagnosed or first noted in this document. Use the visit/encounter date associated with this specific entry, not the document print date if they differ.
    }
  ],
  "medications": [
    {
      "name": string,           // Drug name only, no dosage (e.g. "Metformin", "Sertraline")
      "dosage": string | null,  // Strength + form only (e.g. "500 mg", "25 mg tablet"). Do NOT include frequency or route here.
      "details": string | null, // Frequency, route, and any other instructions (e.g. "twice daily with meals", "1 tablet orally once a day")
      "startDate": string | null  // ISO 8601 date when this medication was prescribed or most recently noted as active. Use the visit/encounter date for this specific entry. If no specific prescription date is found, use the overall record date (recordDate). Only return null if the document has no date at all.
    }
  ],
  "surgeries": [
    {
      "name": string,           // Procedure name in Title Case (e.g. "Laparoscopic Appendectomy", "Total Hip Replacement")
      "details": string | null, // Approach, surgeon, facility, findings, or complications if mentioned
      "startDate": string | null  // ISO 8601 date of the procedure. Use the record date if no specific date is given.
    }
  ],
  "imaging": {
    "studyType": "XRAY" | "MRI" | "CT_SCAN" | "ULTRASOUND" | "PET_SCAN" | "MAMMOGRAM" | "ECHOCARDIOGRAM" | "OTHER",
    "bodyPart": string,         // Anatomical body part (e.g. "Right Pelvis", "Chest", "Brain"). For OTHER types, use the anatomical region or organ if clear.
    "description": string | null, // For OTHER types: the specific study name in Title Case (e.g. "ECG Stress Test", "Holter Monitor", "EEG"). For named types: null.
    "summary": string,          // Impression / Conclusion / Final Diagnosis / Assessment / Findings — whichever is most diagnostic (max 500 chars)
    "facility": string | null,
    "studyDate": string | null  // ISO 8601 date string if found, else null
  } | null,
  "vitals": [
    {
      "type": "WEIGHT" | "BLOOD_PRESSURE" | "HEART_RATE" | "TEMPERATURE" | "OXYGEN_SATURATION" | "BLOOD_GLUCOSE",
      "value": number,          // primary value; for BLOOD_PRESSURE this is systolic
      "value2": number | null,  // diastolic only for BLOOD_PRESSURE; null for all others
      "unit": string,           // standardized unit — see VITALS rules below
      "recordedAt": string | null  // ISO 8601 date of this specific reading if different from overall record date; otherwise null
    }
  ]
}

CRITICAL RULES — follow these exactly:

RECORD DATE:
- Extract the top-level record date: the primary visit date, specimen collection date, or report date that best represents the overall encounter.
- Return as an ISO 8601 string (YYYY-MM-DD). If only a month and year are present, use the first of that month (e.g. "2024-03-01").
- Set to null if no date is found.

PER-ITEM DATES (labs.recordedAt, vitals.recordedAt, conditions.startDate, medications.startDate):
- Many records contain multiple sections with different dates (e.g. a combined record with a visit summary dated Feb 2, lab results collected Mar 1, and a medication list updated Apr 5).
- For each item, extract the MOST SPECIFIC date associated with that particular entry — the collection date printed next to a lab result, the encounter date of the visit where a condition was diagnosed, or the date a medication was prescribed or last updated.
- If an item has no date distinct from the overall record date, set its date field to null (the system will fall back to the record date).
- Always prefer the date closest to the actual event over print dates or document generation dates.

LABS:
- Only extract rows that have BOTH a numeric value AND a unit. Skip qualitative results like "Positive", "Negative", "Normal".
- Normalize abbreviated test names to full readable English: "WBC" → "White Blood Cell Count", "HGB" → "Hemoglobin", "Iron Bind.Cap.(TIBC)" → "Iron Binding Capacity (TIBC)", "eGFR NonAfricn Am" → "eGFR (Non-African American)", etc.
- Set isFlagged=true if the line shows H, L, HIGH, LOW, ABNORMAL, CRITICAL, or if value is clearly outside the reference range.
- Set recordedAt to the collection or report date for this specific test if available, otherwise null.

CONDITIONS:
- ONLY include actual medical diagnoses stated by a clinician: ICD-10 coded conditions, problem list entries, or Assessment/Impression diagnoses.
- DO NOT include: patient name, date of birth, address, phone numbers, insurance info, lab test names, medication names, procedure names, or any administrative metadata.
- DO NOT include vague descriptions like "Patient presents with..." — only confirmed diagnoses.
- Normalize names: "Attention Deficit Hyperactivity Disorder" → "ADHD", keep ICD codes out of the name.
- Always use Title Case for condition names (e.g. "Generalized Anxiety Disorder", "Major Depressive Disorder", "Sleep Difficulties"). Preserve acronyms like "ADHD", "GERD", "PTSD" in all-caps.
- NEVER include both a general and a specific form of the same condition. Always use the MOST SPECIFIC name available. If the document says "Cul-de-sac Endometriosis", do NOT also include "Endometriosis". If it says "Right Hemorrhagic Ovarian Cyst", do NOT also include "Hemorrhagic Ovarian Cyst" or "Ovarian Cyst". Output each distinct diagnosis exactly once, at its most specific level.
- Set startDate to the date this condition was first diagnosed or noted in this document if available, otherwise null.

MEDICATIONS:
- Only include actual prescribed/dispensed drugs. Do NOT include lab reagents, procedures, or diagnoses.
- name: drug name only, no dosage strength (e.g. "Sertraline", not "Sertraline 25 mg").
- dosage: strength and form only (e.g. "25 mg", "500 mg tablet"). No frequency or route.
- details: frequency, route, and any other administration instructions (e.g. "once daily", "1 tablet orally twice daily with meals").
- startDate: the date this medication was prescribed or last noted as active, if available; otherwise null.

SURGERIES:
- Extract any surgical or procedural history explicitly mentioned: operative reports, procedure notes, surgical history sections, or post-operative summaries.
- Include: surgeries, biopsies, ablations, laparoscopies, endoscopies, catheterizations, excisions, implant placements, and other invasive procedures.
- Do NOT include: medication administrations, lab draws, imaging scans, or non-invasive diagnostic tests.
- name: use the standard medical procedure name in Title Case (e.g. "Diagnostic Laparoscopy", "Colonoscopy").
- Return [] if no surgical procedures are found.

IMAGING:
- Populate for radiology reports AND cardiac/neurological diagnostic studies: X-ray, MRI, CT, ultrasound, PET, mammogram, echocardiogram, ECG/EKG, stress tests, Holter monitor, EEG, nerve conduction studies, and similar diagnostic imaging/tracing reports.
- Use studyType "OTHER" for ECG, EKG, stress tests, Holter, EEG, and any type not in the enum. When using OTHER, set description to the specific study name in Title Case (e.g. "ECG Stress Test", "Holter Monitor", "EEG", "Nerve Conduction Study"), and set bodyPart to the relevant anatomical region (e.g. "Heart", "Brain") or the study name if no clear anatomical region applies. For named studyTypes (XRAY, MRI, etc.) set description to null.
- Extract the most clinically meaningful section as the summary. In order of preference: Impression, Conclusion, Final Diagnosis, Assessment, Results, Findings. Use whichever section is present and most diagnostic — do NOT fall back to procedure description or patient instructions. If multiple sections exist, prefer Impression or Conclusion over Findings. Summarize the key clinical finding in plain language (max 500 chars).
- Set to null for lab reports, visit notes, prescriptions, or referral letters.

VITALS:
- Extract any clinical measurements for: weight, blood pressure, heart rate (pulse), body temperature, oxygen saturation (SpO2/O2 sat), and blood glucose (blood sugar).
- Standardize ALL units as follows (convert if needed):
  - WEIGHT: always lbs (pounds). Convert kg → lbs by multiplying by 2.20462. Round to 1 decimal.
  - BLOOD_PRESSURE: always mmHg. value = systolic, value2 = diastolic (e.g. "120/80" → value=120, value2=80, unit="mmHg").
  - HEART_RATE: always bpm.
  - TEMPERATURE: always °F. Convert °C → °F: (°C × 9/5) + 32. Round to 1 decimal.
  - OXYGEN_SATURATION: always % (e.g. 98 for 98%).
  - BLOOD_GLUCOSE: always mg/dL. Convert mmol/L → mg/dL by multiplying by 18.0182. Round to whole number.
- Do NOT extract vitals that are only mentioned as target ranges or goals — only actual measured readings.
- If multiple readings of the same type appear (e.g. two BP readings), extract each as a separate entry.
- Set recordedAt to the date this measurement was taken if different from the overall record date; otherwise null.
- Return an empty array [] if no vitals are found.

PROVIDER:
- Extract the ordering or attending provider — the clinician who ordered or is responsible for the patient's care.
- For lab reports: the ordering physician. For visit notes: the attending provider. For imaging: the ordering physician (not the interpreting radiologist). Only use the radiologist if no ordering provider is present.
- Set to null if no provider is clearly identifiable.

If a category has no data to extract, return an empty array [] for arrays, or null for objects.`;

// ── Main extraction function ──────────────────────────────────────────────────

/**
 * Extract structured health data from PDF text using Claude.
 * Returns null if the API key is missing or the call fails.
 */
export async function extractWithAI(
  text: string,
  recordType?: string,
): Promise<AIExtractionResult | null> {
  const client = getClient();
  if (!client) {
    console.log('[aiExtractor] ANTHROPIC_API_KEY not set — skipping AI extraction');
    return null;
  }

  // Truncate text to ~12000 words. Claude Haiku has a 200K-token context window;
  // 12K words ≈ 16K tokens input, leaving ample room for a large JSON response.
  // Quest Diagnostics lab reports are verbose (reference range paragraphs repeat per
  // test), so we need headroom to capture all tests across multi-page reports.
  const truncated = text.split(/\s+/).slice(0, 12000).join(' ');

  const userMessage = recordType && recordType !== 'OTHER'
    ? `This document has been categorized as: ${recordType}\n\nDocument text:\n\n${truncated}`
    : `Document text:\n\n${truncated}`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const content = response.content[0];
    if (content.type !== 'text') return null;

    // Strip any accidental markdown fences
    const raw = content.text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(raw) as AIExtractionResult;

    const result = sanitize(parsed);
    console.log(`[aiExtractor] OK — type=${result.recordType} labs=${result.labs.length} conds=${result.conditions.length} meds=${result.medications.length} surgeries=${result.surgeries.length} imaging=${result.imaging ? 1 : 0}`);
    return result;
  } catch (err) {
    console.error('[aiExtractor] Extraction failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Sanitize / validate the parsed response ───────────────────────────────────

function sanitize(raw: AIExtractionResult): AIExtractionResult {
  const VALID_RECORD_TYPES: AIRecordType[] = [
    'LAB_REPORT', 'VISIT_SUMMARY', 'IMAGING', 'PRESCRIPTION',
    'REFERRAL', 'OPERATIVE_REPORT', 'OTHER',
  ];
  const VALID_IMAGING_TYPES: AIImagingStudyType[] = [
    'XRAY', 'MRI', 'CT_SCAN', 'ULTRASOUND', 'PET_SCAN', 'MAMMOGRAM', 'ECHOCARDIOGRAM', 'OTHER',
  ];
  const VALID_VITAL_TYPES: AIVitalType[] = [
    'WEIGHT', 'BLOOD_PRESSURE', 'HEART_RATE', 'TEMPERATURE', 'OXYGEN_SATURATION', 'BLOOD_GLUCOSE',
  ];

  return {
    recordType: VALID_RECORD_TYPES.includes(raw.recordType) ? raw.recordType : 'OTHER',

    recordDate: raw.recordDate && /^\d{4}-\d{2}-\d{2}$/.test(String(raw.recordDate))
      ? String(raw.recordDate)
      : null,

    provider: raw.provider?.name
      ? {
          name: String(raw.provider.name).trim(),
          providerType: raw.provider.providerType ? String(raw.provider.providerType).trim().replace(/\s*\([^)]*\)\s*$/, '') : undefined,
          specialty: raw.provider.specialty ? String(raw.provider.specialty).trim() : undefined,
        }
      : null,

    labs: (Array.isArray(raw.labs) ? raw.labs : [])
      .filter(l => l && typeof l.testName === 'string' && typeof l.value === 'number' && !isNaN(l.value))
      .map(l => ({
        testName: String(l.testName).trim(),
        value: Number(l.value),
        unit: l.unit ? String(l.unit).trim() : '',
        referenceMin: l.referenceMin != null ? Number(l.referenceMin) : undefined,
        referenceMax: l.referenceMax != null ? Number(l.referenceMax) : undefined,
        isFlagged: Boolean(l.isFlagged),
        recordedAt: l.recordedAt && /^\d{4}-\d{2}-\d{2}$/.test(String(l.recordedAt))
          ? String(l.recordedAt) : undefined,
      })),

    conditions: (Array.isArray(raw.conditions) ? raw.conditions : [])
      .filter(c => c && typeof c.name === 'string' && c.name.trim().length >= 2)
      .map(c => ({
        name: String(c.name).trim(),
        details: c.details ? String(c.details).trim() : undefined,
        startDate: c.startDate && /^\d{4}-\d{2}-\d{2}$/.test(String(c.startDate))
          ? String(c.startDate) : undefined,
      })),

    medications: (Array.isArray(raw.medications) ? raw.medications : [])
      .filter(m => m && typeof m.name === 'string' && m.name.trim().length >= 2)
      .map(m => ({
        name: String(m.name).trim(),
        dosage: m.dosage ? String(m.dosage).trim() : undefined,
        details: m.details ? String(m.details).trim() : undefined,
        startDate: m.startDate && /^\d{4}-\d{2}-\d{2}$/.test(String(m.startDate))
          ? String(m.startDate) : undefined,
      })),

    surgeries: (Array.isArray((raw as any).surgeries) ? (raw as any).surgeries : [])
      .filter((s: any) => s && typeof s.name === 'string' && s.name.trim().length >= 2)
      .map((s: any) => ({
        name: String(s.name).trim(),
        details: s.details ? String(s.details).trim() : undefined,
        startDate: s.startDate && /^\d{4}-\d{2}-\d{2}$/.test(String(s.startDate))
          ? String(s.startDate) : undefined,
      })),

    imaging: raw.imaging && typeof raw.imaging.bodyPart === 'string'
      ? {
          studyType: VALID_IMAGING_TYPES.includes(raw.imaging.studyType)
            ? raw.imaging.studyType
            : 'OTHER',
          bodyPart: String(raw.imaging.bodyPart).trim(),
          description: raw.imaging.description ? String(raw.imaging.description).trim() : undefined,
          summary: raw.imaging.summary ? String(raw.imaging.summary).trim().slice(0, 500) : 'See original report.',
          facility: raw.imaging.facility ? String(raw.imaging.facility).trim() : undefined,
          studyDate: raw.imaging.studyDate ? String(raw.imaging.studyDate) : undefined,
        }
      : null,

    vitals: (Array.isArray(raw.vitals) ? raw.vitals : [])
      .filter(v => v && VALID_VITAL_TYPES.includes(v.type) && typeof v.value === 'number' && !isNaN(v.value))
      .map(v => ({
        type: v.type as AIVitalType,
        value: Number(v.value),
        value2: v.type === 'BLOOD_PRESSURE' && v.value2 != null && typeof v.value2 === 'number' && !isNaN(v.value2)
          ? Number(v.value2)
          : undefined,
        unit: v.unit ? String(v.unit).trim() : '',
        recordedAt: v.recordedAt && /^\d{4}-\d{2}-\d{2}$/.test(String(v.recordedAt))
          ? String(v.recordedAt) : undefined,
      })),
  };
}
