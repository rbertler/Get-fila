/**
 * Extracts structured health data from PDF-extracted text.
 * Used by the /api/records/sync endpoint.
 */

// ── Lab Results ───────────────────────────────────────────────────────────────

export interface ExtractedLab {
  testName: string;
  value: number;
  unit: string;
  referenceMin?: number;
  referenceMax?: number;
  isFlagged: boolean;
}

const UNIT_PATTERN = '(?:mg/dL|mmol/L|mIU/mL|mIU/L|IU/L|U/L|g/dL|g/L|%|mEq/L|ng/mL|ng/dL|pg/mL|µg/dL|ug/dL|mcg/dL|nmol/L|pmol/L|fL|fl|10\\^3/µL|10\\^3/uL|10\\^6/µL|10\\^6/uL|K/µL|K/uL|M/µL|M/uL|cells/µL|cells/uL|mm/hr|seconds?|sec|mg/L|µmol/L|umol/L|mmHg|bpm|beats/min|copies/mL|titer|ratio|index|µU/mL|uU/mL|mU/L|µg/L|ug/L|µg/g|ug/g|mosm/kg|mosm/L|pH|units|U)';

export function parseLabResultsFromText(text: string, recordDate?: Date): ExtractedLab[] {
  const results: ExtractedLab[] = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Skip header/footer lines and very short/long lines
    if (line.length > 160 || line.length < 5) continue;
    if (/^(page\s*\d|patient\s*(name|id|dob)|dob\b|physician|lab\s*id|specimen|collected\s*(by|on)|reported|address|ordering|npi\b|account)/i.test(line)) continue;

    // Pattern 1: "Test Name   5.4   mg/dL   H   65-99"  or  "Test Name   5.4  H  mg/dL   (65-99)"
    // Handles: lots of whitespace, H/L/HIGH/LOW flags anywhere, optional parens around ref range
    const pattern1 = new RegExp(
      `^([A-Za-z][A-Za-z0-9\\s\\(\\)\\-\\/\\.]{2,45}?)\\s{2,}` +
      `([<>]?\\d+\\.?\\d*)\\s*` +
      `(?:[HL]\\b|HIGH|LOW|CRIT(?:ICAL)?|\\*)?\\s*` +
      `(${UNIT_PATTERN})?\\s*` +
      `(?:[HL]\\b|HIGH|LOW|CRIT(?:ICAL)?|\\*)?\\s*` +
      `(?:[Rr]ef(?:erence)?\\s*[:\\s]*|Normal[:\\s]*|[\\(\\[\\s])?` +
      `(\\d+\\.?\\d*)\\s*[-–to]\\s*(\\d+\\.?\\d*)`,
      'i'
    );

    // Pattern 2: "Test Name: 5.4 mg/dL (Ref: 65-99)" or "Test Name: 5.4 mg/dL"
    const pattern2 = new RegExp(
      `^([A-Za-z][A-Za-z0-9\\s\\(\\)\\-\\/\\.]{2,45}?):\\s*` +
      `([<>]?\\d+\\.?\\d*)\\s*` +
      `(?:[HL]\\b|HIGH|LOW|CRIT(?:ICAL)?|\\*)?\\s*` +
      `(${UNIT_PATTERN})` +
      `(?:[^\\d]*(\\d+\\.?\\d*)\\s*[-–to]\\s*(\\d+\\.?\\d*))?`,
      'i'
    );

    // Pattern 3: single-space table "Glucose 95 mg/dL 65-99"
    const pattern3 = new RegExp(
      `^([A-Za-z][A-Za-z0-9\\s\\(\\)\\-\\/\\.]{2,45?})\\s+` +
      `([<>]?\\d+\\.?\\d*)\\s+` +
      `(${UNIT_PATTERN})\\s+` +
      `(\\d+\\.?\\d*)\\s*[-–]\\s*(\\d+\\.?\\d*)`,
      'i'
    );

    // Pattern 4: spaceless PDF columns — name ends with a letter or ")", value starts immediately
    // e.g. "Free Testosterone (Bioavailable)7.4 pg/mL0.1 - 6.4 pg/mLHIGH"
    const pattern4 = new RegExp(
      `^([A-Za-z][A-Za-z0-9\\s\\(\\)\\-\\/\\.]{2,50}?[A-Za-z\\)])` +
      `([<>]?\\d+\\.?\\d*)\\s*` +
      `(${UNIT_PATTERN})\\s*` +
      `(\\d+\\.?\\d*)\\s*[-–]\\s*(\\d+\\.?\\d*)`,
      'i'
    );

    const match = line.match(pattern1) || line.match(pattern2) || line.match(pattern3) || line.match(pattern4);
    if (!match) continue;

    const testName = match[1].trim().replace(/\s+/g, ' ');
    const rawValue = match[2]?.replace(/[<>]/g, '');
    const value = rawValue ? parseFloat(rawValue) : NaN;
    if (isNaN(value)) continue;
    if (testName.length < 2 || testName.length > 55) continue;
    // Skip obvious non-lab header lines
    if (/^(page|total|result|value|test|name|unit|range|reference|normal|flag|date|time|id|no\.|#|component|analyte|ordered\s+by)/i.test(testName)) continue;
    // Skip lines that look like section headers (all caps, short)
    if (/^[A-Z\s\/]{4,30}$/.test(testName) && testName === testName.toUpperCase()) continue;

    const unit = match[3] ?? '';
    const refMin = match[4] ? parseFloat(match[4]) : undefined;
    const refMax = match[5] ? parseFloat(match[5]) : undefined;

    // Also detect flag from H/L/HIGH/LOW tokens in the line
    const lineHasFlag = /\b(H|L|HIGH|LOW|CRIT|CRITICAL|ABNORMAL|PANIC)\b/i.test(line);
    const isFlagged =
      lineHasFlag ||
      (refMin !== undefined && value < refMin) ||
      (refMax !== undefined && value > refMax);

    // Deduplicate by normalized testName
    if (!results.find(r => normalizeLabTestName(r.testName) === normalizeLabTestName(testName))) {
      results.push({ testName, value, unit, referenceMin: refMin, referenceMax: refMax, isFlagged });
    }
  }

  return results;
}

/** Normalize a lab test name for deduplication — strips trailing numeric/unit garbage
 *  so "Free Testosterone (Bioavailable)7.4 pg/mL0.1 -" matches "Free Testosterone (Bioavailable)" */
/** Canonical display names keyed by exact input string. */
const LAB_CANONICAL: Record<string, string> = {
  // ── Aminotransferases / Liver ──
  'ALT': 'Alanine Aminotransferase (ALT)',
  'ALT (Alanine Aminotransferase)': 'Alanine Aminotransferase (ALT)',
  'Alanine Aminotransferase': 'Alanine Aminotransferase (ALT)',
  'SGPT': 'Alanine Aminotransferase (ALT)',
  'AST': 'Aspartate Aminotransferase (AST)',
  'AST (Aspartate Aminotransferase)': 'Aspartate Aminotransferase (AST)',
  'Aspartate Aminotransferase': 'Aspartate Aminotransferase (AST)',
  'SGOT': 'Aspartate Aminotransferase (AST)',
  'Alkaline Phosphatase': 'Alkaline Phosphatase (ALP)',
  'ALP': 'Alkaline Phosphatase (ALP)',
  'Alk Phos': 'Alkaline Phosphatase (ALP)',
  'Alk. Phos.': 'Alkaline Phosphatase (ALP)',
  'GGT': 'Gamma-Glutamyl Transferase (GGT)',
  'Gamma-Glutamyl Transferase': 'Gamma-Glutamyl Transferase (GGT)',
  'Gamma-Glutamyltransferase': 'Gamma-Glutamyl Transferase (GGT)',
  'Gamma-Glutamyltransferase (GGT)': 'Gamma-Glutamyl Transferase (GGT)',
  'Gamma Glutamyl Transferase': 'Gamma-Glutamyl Transferase (GGT)',
  'LDH': 'Lactate Dehydrogenase (LDH)',
  'Lactate Dehydrogenase': 'Lactate Dehydrogenase (LDH)',
  'LD': 'Lactate Dehydrogenase (LDH)',
  // ── Bilirubin ──
  'Bilirubin': 'Bilirubin, Total',
  'Total Bilirubin': 'Bilirubin, Total',
  'Direct Bilirubin': 'Bilirubin, Direct',
  'Bilirubin, Direct (DBIL)': 'Bilirubin, Direct',
  'Indirect Bilirubin': 'Bilirubin, Indirect',
  'Bilirubin, Indirect (IBIL)': 'Bilirubin, Indirect',
  // ── Basic metabolic panel electrolytes ──
  'Sodium, Serum': 'Sodium',
  'Serum Sodium': 'Sodium',
  'Na': 'Sodium',
  'Potassium, Serum': 'Potassium',
  'Serum Potassium': 'Potassium',
  'K': 'Potassium',
  'Chloride, Serum': 'Chloride',
  'Serum Chloride': 'Chloride',
  'Cl': 'Chloride',
  'Calcium, Serum': 'Calcium, Total',
  'Calcium': 'Calcium, Total',
  'Serum Calcium': 'Calcium, Total',
  'Carbon Dioxide, Serum': 'Carbon Dioxide, Total',
  'Glucose, Serum': 'Glucose',
  'Serum Glucose': 'Glucose',
  'Blood Glucose': 'Glucose',
  'Creatinine, Serum': 'Creatinine',
  'Serum Creatinine': 'Creatinine',
  'Phosphorus': 'Phosphorus',
  'Phosphorus, Serum': 'Phosphorus',
  'Phosphate': 'Phosphorus',
  'Serum Phosphorus': 'Phosphorus',
  'Magnesium, Serum': 'Magnesium',
  'Serum Magnesium': 'Magnesium',
  'Mg': 'Magnesium',
  'Uric Acid, Serum': 'Uric Acid',
  'Serum Uric Acid': 'Uric Acid',
  // ── Lipids ──
  'Cholesterol': 'Total Cholesterol',
  'Cholesterol, Total': 'Total Cholesterol',
  'Cholesterol, Total, Serum': 'Total Cholesterol',
  'LDL Cholesterol': 'LDL Cholesterol',
  'LDL-Cholesterol': 'LDL Cholesterol',
  'LDL-C': 'LDL Cholesterol',
  'LDL Cholesterol, Calc': 'LDL Cholesterol',
  'LDL Cholesterol (Calc)': 'LDL Cholesterol',
  'Low-Density Lipoprotein Cholesterol': 'LDL Cholesterol',
  'Low Density Lipoprotein': 'LDL Cholesterol',
  'HDL Cholesterol': 'HDL Cholesterol',
  'HDL-Cholesterol': 'HDL Cholesterol',
  'HDL-C': 'HDL Cholesterol',
  'High-Density Lipoprotein Cholesterol': 'HDL Cholesterol',
  'High Density Lipoprotein': 'HDL Cholesterol',
  'Triglycerides, Serum': 'Triglycerides',
  'Serum Triglycerides': 'Triglycerides',
  // ── Inflammation ──
  'CRP': 'C-Reactive Protein',
  'C-Reactive Protein (CRP)': 'C-Reactive Protein',
  'hsCRP': 'C-Reactive Protein, High Sensitivity',
  'hs-CRP': 'C-Reactive Protein, High Sensitivity',
  'C-Reactive Protein, High Sensitivity (hs-CRP)': 'C-Reactive Protein, High Sensitivity',
  'C-Reactive Protein (High Sensitivity)': 'C-Reactive Protein, High Sensitivity',
  'High Sensitivity C-Reactive Protein': 'C-Reactive Protein, High Sensitivity',
  // ── Iron studies ──
  'Iron, Serum': 'Iron, Total',
  'Serum Iron': 'Iron, Total',
  'Ferritin, Serum': 'Ferritin',
  'Serum Ferritin': 'Ferritin',
  // ── CBC / Hematology ──
  'Hgb': 'Hemoglobin',
  'Hct': 'Hematocrit',
  'PLT': 'Platelet Count',
  'Plt': 'Platelet Count',
  'Leukocytes': 'White Blood Cell Count',
  'WBC Count': 'White Blood Cell Count',
  'Erythrocytes': 'Red Blood Cell Count',
  // ── Other common tests ──
  'PSA': 'Prostate-Specific Antigen (PSA)',
  'Prostate Specific Antigen': 'Prostate-Specific Antigen (PSA)',
  'Prostate-Specific Antigen': 'Prostate-Specific Antigen (PSA)',
  'Homocysteine, Plasma': 'Homocysteine',
  'Homocysteine, Serum': 'Homocysteine',
  'Anti-TPO': 'Thyroid Peroxidase Antibody (TPO)',
  'Thyroid Peroxidase Ab': 'Thyroid Peroxidase Antibody (TPO)',
  'Thyroid Peroxidase Antibodies': 'Thyroid Peroxidase Antibody (TPO)',
  'Thyroid-Stimulating Immunoglobulin': 'Thyroid Stimulating Immunoglobulin (TSI)',
  'TSI': 'Thyroid Stimulating Immunoglobulin (TSI)',
  'INR': 'International Normalized Ratio (INR)',
  'International Normalized Ratio': 'International Normalized Ratio (INR)',
  'PT (Prothrombin Time)': 'Prothrombin Time (PT)',
  'Prothrombin Time': 'Prothrombin Time (PT)',
  'aPTT': 'Activated Partial Thromboplastin Time (aPTT)',
  'PTT': 'Activated Partial Thromboplastin Time (aPTT)',
  'Cortisol, AM': 'Cortisol, Morning',
  'Cortisol, PM': 'Cortisol, Afternoon',
  'Insulin, Fasting': 'Fasting Insulin',
  'Albumin, Serum': 'Albumin',
  'Serum Albumin': 'Albumin',
  // ── CBC differentials — "Absolute X" → "X, Absolute" ──
  'Absolute Basophils': 'Basophils, Absolute',
  'Absolute Eosinophils': 'Eosinophils, Absolute',
  'Absolute Granulocytes': 'Granulocytes, Absolute',
  'Absolute Immature Granulocytes': 'Immature Granulocytes, Absolute',
  'Absolute Lymphocytes': 'Lymphocytes, Absolute',
  'Absolute Monocytes': 'Monocytes, Absolute',
  'Absolute Neutrophils': 'Neutrophils, Absolute',
  'Basophils (Absolute)': 'Basophils, Absolute',
  'Eosinophils (Absolute)': 'Eosinophils, Absolute',
  'Immature Granulocytes (Absolute)': 'Immature Granulocytes, Absolute',
  'Lymphocytes (Absolute)': 'Lymphocytes, Absolute',
  'Monocytes (Absolute)': 'Monocytes, Absolute',
  'Neutrophils (Absolute)': 'Neutrophils, Absolute',
  // ── Blood chemistry ──
  'Anti-Müllerian Hormone (AMH), Female': 'Anti-Müllerian Hormone (AMH)',
  'Anti-Mullerian Hormone (AMH), Female': 'Anti-Müllerian Hormone (AMH)',
  'Anti-Mullerian Hormone (AMH)': 'Anti-Müllerian Hormone (AMH)',
  'AMH': 'Anti-Müllerian Hormone (AMH)',
  'Blood Urea Nitrogen': 'Blood Urea Nitrogen (BUN)',
  'BUN': 'Blood Urea Nitrogen (BUN)',
  'Urea Nitrogen (BUN)': 'Blood Urea Nitrogen (BUN)',
  'Urea Nitrogen': 'Blood Urea Nitrogen (BUN)',
  'HbA1c': 'Hemoglobin A1c',
  'HBA1C': 'Hemoglobin A1c',
  'A1c': 'Hemoglobin A1c',
  'Glycated Hemoglobin': 'Hemoglobin A1c',
  'Glycosylated Hemoglobin': 'Hemoglobin A1c',
  'Carbon Dioxide': 'Carbon Dioxide, Total',
  'DHEA-Sulfate': 'Dehydroepiandrosterone Sulfate (DHEA-S)',
  'DHEA Sulfate': 'Dehydroepiandrosterone Sulfate (DHEA-S)',
  'DHEA-S': 'Dehydroepiandrosterone Sulfate (DHEA-S)',
  'Estrogen, Total, Serum': 'Estrogen, Total',
  'Folate (Folic Acid), Serum': 'Folate, Serum',
  'Folic Acid, Serum': 'Folate, Serum',
  'FSH (Follicle Stimulating Hormone)': 'Follicle Stimulating Hormone (FSH)',
  'FSH (Follicle-Stimulating Hormone)': 'Follicle Stimulating Hormone (FSH)',
  'Follicle-Stimulating Hormone (FSH)': 'Follicle Stimulating Hormone (FSH)',
  'Globulin': 'Globulin, Total',
  'Iron': 'Iron, Total',
  'Iron Saturation Percentage': 'Iron Saturation',
  'Magnesium, Red Blood Cell': 'Magnesium, RBC',
  'Magnesium RBC': 'Magnesium, RBC',
  'Iron Binding Capacity (TIBC)': 'Iron Binding Capacity, Total (TIBC)',
  'LH (Luteinizing Hormone)': 'Luteinizing Hormone (LH)',
  'MCH (Mean Corpuscular Hemoglobin)': 'Mean Corpuscular Hemoglobin (MCH)',
  'Mean Corpuscular Hemoglobin': 'Mean Corpuscular Hemoglobin (MCH)',
  'MCHC (Mean Corpuscular Hemoglobin Concentration)': 'Mean Corpuscular Hemoglobin Concentration (MCHC)',
  'Mean Corpuscular Hemoglobin Concentration': 'Mean Corpuscular Hemoglobin Concentration (MCHC)',
  'MCV (Mean Corpuscular Volume)': 'Mean Corpuscular Volume (MCV)',
  'Mean Corpuscular Volume': 'Mean Corpuscular Volume (MCV)',
  'MPV (Mean Platelet Volume)': 'Mean Platelet Volume (MPV)',
  'Platelets': 'Platelet Count',
  'Protein, Total': 'Protein, Total',
  'Total Protein': 'Protein, Total',
  'RBC Count': 'Red Blood Cell Count',
  'RDW (Red Cell Distribution Width)': 'Red Cell Distribution Width (RDW)',
  'RDW-CV': 'Red Cell Distribution Width (RDW)',
  'Red Blood Cell Distribution Width (RDW)': 'Red Cell Distribution Width (RDW)',
  'Red Cell Distribution Width': 'Red Cell Distribution Width (RDW)',
  'Reverse T3, Serum': 'Reverse T3',
  'Reverse Triiodothyronine': 'Reverse T3',
  'Sedimentation Rate (Modified Westergren)': 'Erythrocyte Sedimentation Rate (ESR)',
  'Sedimentation Rate (SED) by Modified Westergren': 'Erythrocyte Sedimentation Rate (ESR)',
  'Sedimentation Rate (ESR) by Modified Westergren': 'Erythrocyte Sedimentation Rate (ESR)',
  'Sedimentation Rate (Westergren)': 'Erythrocyte Sedimentation Rate (ESR)',
  'ESR': 'Erythrocyte Sedimentation Rate (ESR)',
  'Serum Viscosity': 'Viscosity, Serum',
  'Sex Hormone Binding Globulin': 'Sex Hormone Binding Globulin (SHBG)',
  'SHBG': 'Sex Hormone Binding Globulin (SHBG)',
  'Testosterone': 'Testosterone, Total',
  'Testosterone, Total, MS': 'Testosterone, Total',
  'Testosterone, Free (Direct)': 'Testosterone, Free',
  'Free Testosterone (Direct)': 'Testosterone, Free',
  'Free Testosterone': 'Testosterone, Free',
  'Testosterone, Bioavailable/Free': 'Testosterone, Bioavailable',
  'Testosterone, Bioavailable (Free)': 'Testosterone, Bioavailable',
  'Free Testosterone (Bioavailable)': 'Testosterone, Bioavailable',
  'Testosterone, Free and Weakly Bound': 'Testosterone, Bioavailable',
  'Thyroid Peroxidase (TPO) Antibody': 'Thyroid Peroxidase Antibody (TPO)',
  'TPO Antibody': 'Thyroid Peroxidase Antibody (TPO)',
  'TSH': 'Thyroid Stimulating Hormone (TSH)',
  'TSH (Thyroid Stimulating Hormone)': 'Thyroid Stimulating Hormone (TSH)',
  'Thyroid-Stimulating Hormone (TSH)': 'Thyroid Stimulating Hormone (TSH)',
  'Thyroxine (T4), Free': 'Thyroxine, Free (T4)',
  'Thyroxine (T4), Free (Direct)': 'Thyroxine, Free (T4)',
  'Thyroxine (T4), Free Direct': 'Thyroxine, Free (T4)',
  'Thyroxine (T4), Free, Direct': 'Thyroxine, Free (T4)',
  'Free T4': 'Thyroxine, Free (T4)',
  'T4, Free': 'Thyroxine, Free (T4)',
  'Triiodothyronine (T3), Free': 'Triiodothyronine, Free (T3)',
  'Free T3': 'Triiodothyronine, Free (T3)',
  'T3, Free': 'Triiodothyronine, Free (T3)',
  'Unsaturated Iron Binding Capacity': 'Unsaturated Iron Binding Capacity (UIBC)',
  'Vitamin B12, Serum': 'Vitamin B12',
  'B12': 'Vitamin B12',
  'Cobalamin': 'Vitamin B12',
  'Vitamin D, 25-Hydroxy': 'Vitamin D, 25-Hydroxy, Total',
  'Vitamin D, 25-OH': 'Vitamin D, 25-Hydroxy, Total',
  'Vitamin D, 25-OH, Total': 'Vitamin D, 25-Hydroxy, Total',
  '25-Hydroxyvitamin D': 'Vitamin D, 25-Hydroxy, Total',
  'eGFR (African American)': 'eGFR',
  'eGFR (Non-African American)': 'eGFR',
  'eGFR Non-African American': 'eGFR',
  'eGFR Non-Afr. American': 'eGFR',
  'eGFR African American': 'eGFR',
  'eGFR (Chronic Kidney Disease Epidemiology Collaboration)': 'eGFR',
  'eGFR (CKD-EPI)': 'eGFR',
  'eGFR, CKD-EPI': 'eGFR',
  'eGFR CKD-EPI': 'eGFR',
  'Estimated GFR': 'eGFR',
  'GFR': 'eGFR',
  'CO2': 'Carbon Dioxide, Total',
  'CO2, Total': 'Carbon Dioxide, Total',
  'WBC': 'White Blood Cell Count',
  'RBC': 'Red Blood Cell Count',
  'HGB': 'Hemoglobin',
  'HCT': 'Hematocrit',
};

/**
 * Apply a general structural rule: "Absolute X" → "X, Absolute"
 * for any CBC differential not already in the lookup.
 */
function applyNamingConvention(name: string): string {
  const absolutePrefix = /^Absolute\s+(.+)$/i;
  const m = absolutePrefix.exec(name);
  if (m) return `${m[1]}, Absolute`;
  return name;
}

/** Return the canonical display name for a lab test, or the original if not in the lookup. */
export function canonicalizeLabTestName(name: string): string {
  const trimmed = name.trim();
  if (LAB_CANONICAL[trimmed]) return LAB_CANONICAL[trimmed];
  // Strip common sample-type qualifiers and retry (e.g. "Ferritin, Serum" → "Ferritin")
  const stripped = trimmed.replace(/,\s*(Serum|Plasma|Blood|Urine|Whole Blood|Capillary)$/i, '').trim();
  if (stripped !== trimmed && LAB_CANONICAL[stripped]) return LAB_CANONICAL[stripped];
  return applyNamingConvention(trimmed);
}

/** Normalize for deduplication comparisons (case-insensitive key after canonicalization). */
export function normalizeLabTestName(name: string): string {
  const canonical = canonicalizeLabTestName(name);
  return canonical
    .replace(/[\d\s./\-–+]+[a-zA-Z/]*[\d\s./\-–+]*$/, '')
    .replace(/-/g, ' ')   // treat hyphens as spaces so "Follicle-Stimulating" == "Follicle Stimulating"
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

// ── Conditions / Diagnoses ────────────────────────────────────────────────────

export interface ExtractedCondition {
  name: string;
  details?: string;
}

export function parseConditionsFromText(text: string): ExtractedCondition[] {
  const results: ExtractedCondition[] = [];
  const seenKeys = new Set<string>();
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let inSection = false;

  const addCondition = (rawName: string, details?: string) => {
    const name = rawName.trim();
    const key = name.toLowerCase();
    if (key.length < 3 || key.length > 80) return;
    if (seenKeys.has(key)) return;
    // Skip generic status words, table headers, and boilerplate
    if (/^(condition|diagnosis|onset|status|severity|snomed|icd|code|year|type|page|symptomatic|active|chronic|management|treatment|combined|stage|moderate|severe|mild|signed|finalized|synthetic|confidential|objective|subjective|plan|referral|follow)\b/i.test(name)) return;
    // Skip prose sentence fragments — real condition names don't contain these patterns
    if (/\b(overshadowed|masked by|historically|systematically|predominantly|reportedly|typically|generally|particularly|specifically|especially|previously unmanaged|were historically|have been|has been|is being|characterized by|driven by|stemming from|related to|due to|attributed to)\b/i.test(name)) return;
    // Skip lines that start with a lowercase word that isn't a known medical prefix
    if (/^[a-z]/.test(name) && !/^(type|stage|grade|class|von |de |la |le )/i.test(name)) return;
    seenKeys.add(key);
    results.push({ name, details: details || undefined });
  };

  for (const line of lines) {
    // ── Inline "Diagnosis: X" extraction — works anywhere in document ──────────
    const diagMatch = line.match(/^(?:\d+\.\s+)?[Dd]iagnos(?:is|es)?\s*:\s*(.{5,})/);
    if (diagMatch) {
      const raw = diagMatch[1]
        .replace(/\s*\(ICD[-\s]?\d+[:\s][^\)]*\)/gi, '')  // strip ICD-10 codes
        .split(/[,.]/)                                       // split at first comma/period
        [0]
        .trim();
      if (raw.length > 3) addCondition(raw);
      // End any active section — the condition was on this line itself;
      // the lines that follow are clinical narrative, not additional conditions.
      inSection = false;
      continue;
    }

    // ── Section header detection ─────────────────────────────────────────────
    const isConditionHeader =
      /^(diagnos(?:es|is|ed)|problem\s+list|active\s+problems?|medical\s+history|clinical\s+history|clinical\s+assessment|assessment|impression|discharge\s+diagnos|chief\s+complaint|active\s+clinical\s+diagnos)\s*:?\s*$/i.test(line) ||
      /^\d+\.\s+(?:active\s+)?(?:clinical\s+)?diagnos/i.test(line);
    if (isConditionHeader) {
      inSection = true;
      continue;
    }

    // ── Section end detection ────────────────────────────────────────────────
    if (inSection) {
      // New numbered section that isn't another diagnoses section ends it
      if (/^\d+\.\s+/i.test(line) && !/(?:diagnos|condition|problem|assessment)/i.test(line)) {
        inSection = false;
      }
      // Known non-condition section headers
      if (/^(medications?|allergies|labs?|vital|treatment\s+plan|procedure|referral|follow|signature|attending|provider|date|time|address|phone|surgical|family\s+(?:medical|history))\s*[:\s&]/i.test(line) && line.length < 80) {
        inSection = false;
      }
    }
    if (!inSection) continue;

    // ── Filter out table headers and non-condition lines ─────────────────────
    if (/^(condition|onset|status|severity|snomed|code|year)\b/i.test(line)) continue;
    if (line.length < 3 || line.length > 130) continue;
    // Lines starting with 4+ digits are SNOMED/year codes, not condition names
    if (/^\d{4,}/.test(line)) continue;
    // Parenthesized acronym-only lines like "(ADHD)"
    if (/^\([A-Z]{2,8}\)$/.test(line)) continue;

    // Strip leading bullets/numbers and trailing SNOMED codes (6+ digits)
    const cleaned = line
      .replace(/^[-•*·\d.)\s]+/, '')
      .replace(/\d{6,}.*$/, '')   // strip SNOMED code and everything after
      .trim();
    if (cleaned.length < 3) continue;

    // Split name from details at em-dash or colon only (preserve hyphens in names)
    const colonMatch = cleaned.match(/^([^–—:]+)\s*[–—:]?\s*(.*)$/);
    const name = (colonMatch ? colonMatch[1] : cleaned).trim();
    const details = (colonMatch?.[2] ?? '').trim() || undefined;

    addCondition(name, details);
  }

  return results;
}

// ── Imaging Studies ───────────────────────────────────────────────────────────

export interface ExtractedImaging {
  studyType: 'XRAY' | 'MRI' | 'CT_SCAN' | 'ULTRASOUND' | 'PET_SCAN' | 'MAMMOGRAM' | 'ECHOCARDIOGRAM' | 'OTHER';
  bodyPart: string;
  summary: string;
  facility?: string;
  studyDate?: Date;
}

export function parseImagingFromText(text: string, recordDate?: Date): ExtractedImaging | null {
  let studyType: ExtractedImaging['studyType'] = 'OTHER';
  if (/echocardiogram/i.test(text)) {
    studyType = 'ECHOCARDIOGRAM';
  } else if (/ultrasound|sonograph|sonogram/i.test(text)) {
    studyType = 'ULTRASOUND';
  } else if (/\bMRI\b|magnetic resonance imaging/i.test(text)) {
    studyType = 'MRI';
  } else if (/\bCT\s+scan\b|\bCT\s*[-–]\s*\w|\bcomputed tomography\b|\bcat scan\b/i.test(text)) {
    // Require "CT scan" (with space/dash) to avoid matching "SNOMED-CT" in visit summaries
    studyType = 'CT_SCAN';
  } else if (/\bX-?ray\b|radiograph/i.test(text)) {
    studyType = 'XRAY';
  } else if (/mammogram|mammography/i.test(text)) {
    studyType = 'MAMMOGRAM';
  } else if (/\bPET\s+scan\b|\bPET\s*[-–]\s*CT\b/i.test(text)) {
    studyType = 'PET_SCAN';
  } else {
    return null; // Not an imaging report
  }

  // Extract body part — look in the first 300 chars (often the report title) first, then full text
  const BODY_PARTS = 'pelvi[sc]|abdomen|abdominal|pelvic|chest|thorax|thoracic|brain|head|skull|spine|lumbar|cervical|sacral|knee|hip|shoulder|wrist|ankle|foot|feet|hand|elbow|neck|thyroid|breast|liver|kidney|renal|heart|cardiac|ovarian?|ovaries|uterus|uterine|bladder|prostate|gallbladder|pancreas|spleen|aorta|femur|tibia|fibula|orbit|sinus|sinuses|extremit(?:y|ies)';
  const bodyRe = new RegExp(`(?:(?:right|left|bilateral|both|of|the)\\s+)?(${BODY_PARTS})`, 'i');
  const bodyPartMatch = text.slice(0, 300).match(bodyRe) || text.match(bodyRe);
  const bodyPart = bodyPartMatch ? bodyPartMatch[0].trim() : 'Not specified';

  // Extract summary — prefer "Diagnostic Impression" > "Impression" > "Findings" sections.
  // Handles both "Header:\ncontent" and standalone "Header\ncontent" formats.
  let summary = '';

  // 1. Standalone "Diagnostic Impression" or "Impression" header followed by content lines
  const impHeaderMatch = text.match(/(?:diagnostic\s+)?impression\s*:?\s*\n((?:[^\n]+\n?){1,10})/i);
  if (impHeaderMatch) {
    summary = impHeaderMatch[1].replace(/\s+/g, ' ').trim().slice(0, 500);
  }

  // 2. "Impression:" or "Conclusion:" inline
  if (!summary) {
    const impColonMatch = text.match(/(?:impression|conclusion)[s]?\s*:\s*([\s\S]{20,500}?)(?:\n\s*\n|\n[A-Z][A-Za-z\s]{5,}\n|$)/i);
    if (impColonMatch) summary = impColonMatch[1].replace(/\s+/g, ' ').trim().slice(0, 500);
  }

  // 3. Standalone "Findings" or "Ultrasound Findings" header followed by content
  if (!summary) {
    const findHeaderMatch = text.match(/(?:\w+\s+)?findings\s*:?\s*\n((?:[^\n]+\n?){1,12})/i);
    if (findHeaderMatch) summary = findHeaderMatch[1].replace(/\s+/g, ' ').trim().slice(0, 500);
  }

  // 4. "Findings:" inline
  if (!summary) {
    const findColonMatch = text.match(/findings?\s*:\s*([\s\S]{20,500}?)(?:\n\s*\n|$)/i);
    if (findColonMatch) summary = findColonMatch[1].replace(/\s+/g, ' ').trim().slice(0, 500);
  }

  // No fallback to document header — if we can't find a real summary, mark clearly
  if (!summary) summary = 'See original report for findings.';

  // Extract facility
  const facilityMatch = text.match(/(?:facility|hospital|clinic|center|imaging\s+center|radiology)[:\s]+([A-Z][^\n]{3,60})/i)
    || text.match(/^([A-Z][A-Za-z\s&'.-]{5,50}(?:Hospital|Clinic|Medical|Health|Imaging|Radiology|Center|Centre))/m);
  const facility = facilityMatch ? facilityMatch[1].trim() : undefined;

  // Try to extract study date from text (e.g. "Date: 01/15/2024" or "Study Date: January 15, 2024")
  let studyDate: Date | undefined = recordDate;
  const dateMatch = text.match(/(?:study\s+date|exam\s+date|date\s+of\s+(?:exam|study|service)|date\s+performed)[:\s]+(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\w+ \d{1,2},?\s*\d{4})/i);
  if (dateMatch) {
    const parsed = new Date(dateMatch[1]);
    if (!isNaN(parsed.getTime())) studyDate = parsed;
  }

  return { studyType, bodyPart, summary, facility, studyDate };
}

// ── Provider / Facility ───────────────────────────────────────────────────────

// Strips credential suffixes and returns null if the value still looks like non-name content
function cleanProviderName(raw: string): string | null {
  // Remove trailing credentials
  let name = raw
    .replace(/\s*,?\s*(?:MD|DO|NP|PA|RN|PhD|FACOG|FACP|FACS|FAAFP|MPH|MBA|MS|BS)\.?(\s*,\s*(?:MD|DO|NP|PA|RN|PhD|FACOG|FACP|FACS|FAAFP|MPH|MBA|MS|BS)\.?)*$/gi, '')
    .trim();
  // Reject if too short, too long, or contains lab/report metadata keywords
  if (name.length < 3 || name.length > 80) return null;
  if (/\b(fasting|status|specimen|collected|dob|npi|account|requisition|date|time|\d{4,})\b/i.test(name)) return null;
  // Reject lines that contain a colon mid-string (likely "Label: Value" metadata)
  if (/:.+/.test(name)) return null;
  return name;
}

/** Keywords that suggest a name refers to a medical group/organization rather than
 *  an individual clinician (e.g., "Function Health", "Quest Diagnostics", "OHSU Neurology"). */
const ORGANIZATION_NAME_RE = /\b(?:hospital|clinic|medical\s+(?:center|group)|health(?:care|\s+system)?|physicians?|associates?|imaging|radiology|patholog(?:y|ists)|laborator(?:y|ies)|labs?|diagnostics?|wellness|institute|network|partners|group|functional\s+medicine|ob.?gyn|obstetrics|gynecology|pediatrics|oncology|cardiology|dermatology|orthopedics?|neurology|rheumatology|urgent\s+care|family\s+(?:medicine|practice))\b/i;

/** True when a resolved "provider" string looks like a medical group/organization
 *  rather than an individual clinician — e.g., "Function Health" or "Quest Diagnostics".
 *  Used to skip person-name normalization ("Last, First") and to populate the
 *  provider's affiliation instead of requiring an individual's name. */
export function isOrganizationProviderName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  // Starts with "Dr." or contains a credential — almost certainly an individual
  if (/^Dr\.?\s+/i.test(trimmed)) return false;
  if (/\b(?:MD|DO|NP|PA|RN|PhD|FACOG|FACP|FACS|FAAFP|MPH|MBA|MS|BS|ND)\.?\b/i.test(trimmed)) return false;
  return ORGANIZATION_NAME_RE.test(trimmed);
}

/** Extract specifically the ordering/referring provider — used as the highest-priority
 *  provider for lab results and imaging studies. */
export function parseOrderingProviderFromText(text: string): string | null {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Pattern 1: inline "Label: Value" (e.g. "Ordering Provider: Tong, MD, Scott")
  const inlinePattern = /^(?:ordering\s+(?:provider|physician|doctor|clinician)|referring\s+(?:provider|physician|doctor)|ordered\s+by|requested\s+by|admitting\s+physician|admitting\s+provider)\s*[:\-]\s*(.+)/i;

  // Pattern 2: table header followed by value on next non-empty line
  // e.g. "ORDERING PROVIDER" or "ORDERING\nPROVIDER" as column header
  const headerPattern = /^(?:ordering\s+(?:provider|physician)?|ordering)$/i;

  for (let i = 0; i < Math.min(lines.length, 100); i++) {
    const line = lines[i];

    // Inline match
    const m = line.match(inlinePattern);
    if (m) {
      const raw = m[1].split(/\s{2,}|\t/)[0].trim();
      const cleaned = cleanProviderName(raw);
      if (cleaned) return cleaned;
    }

    // Table header: "ORDERING PROVIDER" (whole line) → value is on the next line
    if (headerPattern.test(line) || /^ordering\s+provider$/i.test(line)) {
      // Look at the next 1–2 lines for the name value
      for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
        const next = lines[j].split(/\s{2,}|\t/)[0].trim();
        const cleaned = cleanProviderName(next);
        if (cleaned) return cleaned;
      }
    }
  }

  return null;
}

export function parseProviderFromText(text: string): string | null {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // 1. Explicit labeled fields — extract ONLY the name portion before any metadata
  const labelPatterns = [
    /^(?:ordering\s+(?:provider|physician)|attending\s+physician|signed\s+by|provider|physician|doctor|clinician|referred?\s+by|primary\s+care\s+(?:provider|physician)|rendered\s+by)\s*[:\-]\s*(.+)/i,
  ];
  for (const line of lines.slice(0, 60)) {
    for (const pat of labelPatterns) {
      const m = line.match(pat);
      if (m) {
        // Take only up to the first comma or non-name character after credentials
        const raw = m[1].split(/\s{2,}|\t/)[0].trim(); // stop at double-space (tabular data)
        const cleaned = cleanProviderName(raw);
        if (cleaned) return cleaned;
      }
    }
  }

  // 2. "From:" line (fax / referral letters)
  const fromMatch = text.match(/^From\s*[:\-]\s*(.{3,60})$/im);
  if (fromMatch) {
    const cleaned = cleanProviderName(fromMatch[1].trim());
    if (cleaned && !/\d{5}/.test(cleaned)) return cleaned;
  }

  // 3. Clinic/hospital/medical-group name in the first 5 lines (letterhead)
  for (const line of lines.slice(0, 5)) {
    if (ORGANIZATION_NAME_RE.test(line) && line.length >= 4 && line.length <= 80) {
      const cleaned = cleanProviderName(line.replace(/^\W+|\W+$/g, '').trim());
      if (cleaned) return cleaned;
    }
  }

  // 4. "Dr. Firstname Lastname" — match only the name, stop at comma/extra content
  for (const line of lines.slice(0, 30)) {
    const drMatch = line.match(/\bDr\.?\s+([A-Z][a-z]+(?: [A-Z][a-z]+)+)(?:\s*,\s*(?:MD|DO|NP|PA|RN|PhD|FACOG|FACP|FACS|FAAFP)\.?)?/);
    if (drMatch) {
      const name = `Dr. ${drMatch[1]}`;
      const cleaned = cleanProviderName(name);
      if (cleaned) return cleaned;
    }
  }

  return null;
}

/** Extract a provider name from the file name as a last resort.
 *  Handles patterns like "Dr. Williams Visit Summary" → "Dr. Williams"
 *  or "Amanda Vance MD Lab Report" → "Amanda Vance MD" */
export function parseProviderFromFileName(fileName: string): string | null {
  // "Dr. Lastname ..." or "Dr Lastname ..."
  const drMatch = fileName.match(/\bDr\.?\s+([A-Z][a-zA-Z\-']+(?:\s+[A-Z][a-zA-Z\-']+)?)/);
  if (drMatch) return `Dr. ${drMatch[1].trim()}`;

  // "Firstname Lastname MD/DO/NP ..."
  const credMatch = fileName.match(/\b([A-Z][a-zA-Z\-']+\s+[A-Z][a-zA-Z\-']+)\s*,?\s*(MD|DO|NP|PA|RN|PhD)\b/i);
  if (credMatch) return `${credMatch[1].trim()}, ${credMatch[2].toUpperCase()}`;

  return null;
}

export function parseDateFromFileName(fileName: string): string | null {
  // YYYY-MM-DD anywhere in the filename (e.g. "2026-06-10_Lab Report.pdf")
  const m = fileName.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];

  // MM-DD-YYYY or MM_DD_YYYY
  const m2 = fileName.match(/(\d{2})[-_](\d{2})[-_](\d{4})/);
  if (m2) return `${m2[3]}-${m2[1]}-${m2[2]}`;

  return null;
}
