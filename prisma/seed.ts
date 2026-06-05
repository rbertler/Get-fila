import { PrismaClient, RecordType, HistoryCategory, AppointmentSource, VitalType, ImagingStudyType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Remove old demo accounts and wipe related data for current ones (idempotent)
  const allDemoEmails = [
    'sarah@demo.fila.health', 'marcus@demo.fila.health',
    'maggie@demo.fila.health', 'jordan@demo.fila.health', 'derek@demo.fila.health',
  ];
  for (const email of allDemoEmails) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) continue;
    const uid = user.id;
    await prisma.medicalHistoryEntry.deleteMany({ where: { userId: uid } });
    await prisma.appointment.deleteMany({ where: { userId: uid } });
    await prisma.labResult.deleteMany({ where: { userId: uid } });
    await prisma.vital.deleteMany({ where: { userId: uid } });
    await prisma.provider.deleteMany({ where: { userId: uid } });
    await prisma.healthInsightReport.deleteMany({ where: { userId: uid } });
    await prisma.imagingStudy.deleteMany({ where: { userId: uid } });
    // Delete old accounts (Sarah, Marcus) entirely
    if (['sarah@demo.fila.health', 'marcus@demo.fila.health'].includes(email)) {
      await prisma.user.delete({ where: { id: uid } });
    }
  }

  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
  const daysFromNow = (d: number) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000);

  // ── Persona 1: Margaret "Maggie" Reyes ──────────────────────────────────────
  const maggie = await prisma.user.upsert({
    where: { email: 'maggie@demo.fila.health' },
    update: {},
    create: {
      email: 'maggie@demo.fila.health',
      passwordHash: await bcrypt.hash('demo1234', 12),
      name: 'Margaret Reyes',
      dateOfBirth: new Date('1959-03-14'),
    },
  });

  const maggieHistory = [
    { category: 'CONDITION' as HistoryCategory, name: 'Type 2 Diabetes Mellitus', details: 'ICD-10: E11.9. Diagnosed 2015. Currently managed with Metformin and Empagliflozin.', startDate: new Date('2015-04-10') },
    { category: 'CONDITION' as HistoryCategory, name: 'Hypertension, Essential', details: 'ICD-10: I10. Diagnosed 2013. Managed with Lisinopril and Amlodipine.', startDate: new Date('2013-09-01') },
    { category: 'CONDITION' as HistoryCategory, name: 'Chronic Kidney Disease, Stage 3a', details: 'ICD-10: N18.31. eGFR 44 mL/min/1.73m². Diagnosed 2022 after progressive decline in kidney function noted by nephrology.', startDate: new Date('2022-02-14') },
    { category: 'CONDITION' as HistoryCategory, name: 'Hypothyroidism', details: 'ICD-10: E03.9. On Levothyroxine 75mcg QAM. TSH stable at 3.2 mIU/L.', startDate: new Date('2018-06-01') },
    { category: 'CONDITION' as HistoryCategory, name: 'Dyslipidemia', details: 'ICD-10: E78.5. LDL-C 98 mg/dL on Atorvastatin 40mg QHS.', startDate: new Date('2016-01-15') },
    { category: 'CONDITION' as HistoryCategory, name: 'Osteoarthritis, Bilateral Knee', details: 'ICD-10: M17.11. Managed with Meloxicam 7.5mg QD (prescribed by orthopedics). NSAIDs relatively contraindicated given CKD Stage 3a — nephrology not notified of this prescription.', startDate: new Date('2021-11-03') },
    { category: 'MEDICATION' as HistoryCategory, name: 'Metformin 1000mg', details: 'Twice daily with meals. Prescribed by Dr. Patel (nephrology) — dose reduced from 1500mg BID due to declining eGFR. PCP and endocrinology not notified of dose change for 3 weeks.', startDate: new Date('2015-05-01') },
    { category: 'MEDICATION' as HistoryCategory, name: 'Empagliflozin 10mg', details: 'Once daily. Initiated by endocrinology without cardiology review despite active cardiovascular risk flags.', startDate: new Date('2023-01-10') },
    { category: 'MEDICATION' as HistoryCategory, name: 'Lisinopril 10mg', details: 'Once daily. Combination with Meloxicam in CKD Stage 3a patient is a documented adverse event pattern — no prescriber has full picture.', startDate: new Date('2013-09-15') },
    { category: 'MEDICATION' as HistoryCategory, name: 'Amlodipine 5mg', details: 'Once daily. Prescribed by cardiology.', startDate: new Date('2020-03-01') },
    { category: 'MEDICATION' as HistoryCategory, name: 'Atorvastatin 40mg', details: 'Once daily at bedtime (QHS). Prescribed by PCP.', startDate: new Date('2016-01-20') },
    { category: 'MEDICATION' as HistoryCategory, name: 'Levothyroxine 75mcg', details: 'Once daily on empty stomach, 30 minutes before breakfast (QAM). Prescribed by endocrinology.', startDate: new Date('2018-06-15') },
    { category: 'MEDICATION' as HistoryCategory, name: 'Aspirin 81mg', details: 'Once daily. Cardiovascular prophylaxis.', startDate: new Date('2016-01-20') },
    { category: 'MEDICATION' as HistoryCategory, name: 'Meloxicam 7.5mg', details: 'Once daily as needed for knee pain. Prescribed by orthopedics (Dr. Russo). NSAID use in CKD Stage 3a is relatively contraindicated — nephrology and PCP were not notified this was prescribed.', startDate: new Date('2021-11-10') },
    { category: 'ALLERGY' as HistoryCategory, name: 'Sulfonamides', details: 'Rash — documented allergy. Do not prescribe trimethoprim-sulfamethoxazole.' },
    { category: 'ALLERGY' as HistoryCategory, name: 'Contrast dye (iodinated)', details: 'Mild allergic reaction during CT with contrast in 2019. Pre-medicate if contrast required.' },
    { category: 'SURGERY' as HistoryCategory, name: 'Total Right Knee Replacement', details: 'Performed by Dr. Russo at Northwestern Orthopaedics. Uncomplicated recovery.', startDate: new Date('2023-08-14') },
    { category: 'SURGERY' as HistoryCategory, name: 'Cholecystectomy', details: 'Laparoscopic. Gallstone disease.', startDate: new Date('2009-05-22') },
    { category: 'VACCINATION' as HistoryCategory, name: 'COVID-19 Booster (Moderna)', startDate: daysAgo(240) },
    { category: 'VACCINATION' as HistoryCategory, name: 'Flu Vaccine', startDate: daysAgo(210) },
    { category: 'VACCINATION' as HistoryCategory, name: 'Pneumococcal (PPSV23)', details: 'Indicated for CKD patients.', startDate: daysAgo(400) },
    { category: 'FAMILY_HISTORY' as HistoryCategory, name: 'Type 2 Diabetes', details: 'Both parents. Maternal aunt — died of diabetic kidney failure.' },
    { category: 'FAMILY_HISTORY' as HistoryCategory, name: 'Hypertension', details: 'Father — stroke at age 71.' },
    { category: 'FAMILY_HISTORY' as HistoryCategory, name: 'Cardiovascular Disease', details: 'Father — MI at age 68.' },
  ];

  for (const entry of maggieHistory) {
    await prisma.medicalHistoryEntry.create({ data: { userId: maggie.id, ...entry, isManual: true } });
  }

  await prisma.provider.createMany({
    data: [
      { userId: maggie.id, name: 'Okafor, David, MD', providerType: 'Medical Doctor', specialty: 'Primary Care', affiliation: 'Northwestern Medicine Medical Group', phone: '(312) 555-0101', isManual: true },
      { userId: maggie.id, name: 'Chen, Linda, MD', providerType: 'Medical Doctor', specialty: 'Endocrinology', affiliation: 'University of Chicago Medicine', phone: '(773) 555-0182', isManual: true },
      { userId: maggie.id, name: 'Patel, Ravi, MD', providerType: 'Medical Doctor', specialty: 'Nephrology', affiliation: 'Rush University Medical Center', phone: '(312) 555-0244', isManual: true },
      { userId: maggie.id, name: 'Williams, Karen, MD', providerType: 'Medical Doctor', specialty: 'Cardiology', affiliation: 'Northwestern Medicine — Bluhm Cardiovascular Institute', phone: '(312) 555-0367', isManual: true },
      { userId: maggie.id, name: 'Russo, Anthony, MD', providerType: 'Medical Doctor', specialty: 'Orthopedics', affiliation: 'Northwestern Orthopaedics', phone: '(312) 555-0419', isManual: true },
    ],
  });

  const maggieAppointments = [
    { providerName: 'Dr. Patel, Nephrology', specialty: 'Nephrology', scheduledAt: daysFromNow(12), reason: 'Quarterly kidney function review — eGFR monitoring', source: 'MANUAL' as AppointmentSource },
    { providerName: 'Dr. Chen, Endocrinology', specialty: 'Endocrinology', scheduledAt: daysFromNow(28), reason: 'Diabetes management — HbA1c recheck, Empagliflozin review', source: 'MANUAL' as AppointmentSource },
    { providerName: 'Dr. Russo, Orthopedics', specialty: 'Orthopedics', scheduledAt: daysAgo(14), reason: 'Post-operative knee follow-up — 12-month check', notes: 'Renewed Meloxicam prescription. Nephrology not notified.', source: 'MANUAL' as AppointmentSource },
    { providerName: 'Dr. Okafor, Primary Care', specialty: 'Primary Care', scheduledAt: daysAgo(45), reason: 'Annual wellness visit', notes: 'Medication list reviewed but orthopedics Meloxicam prescription was missing. Paper med list last updated 14 months ago.', source: 'MANUAL' as AppointmentSource },
    { providerName: 'Dr. Williams, Cardiology', specialty: 'Cardiology', scheduledAt: daysAgo(62), reason: 'Cardiovascular risk assessment', notes: 'Not aware Empagliflozin was initiated by endocrinology. No shared records between systems.', source: 'MANUAL' as AppointmentSource },
    { providerName: 'Dr. Patel, Nephrology', specialty: 'Nephrology', scheduledAt: daysAgo(90), reason: 'eGFR decline follow-up — Metformin dose adjustment', notes: 'Reduced Metformin to 1000mg BID. Did not have mechanism to notify PCP or endocrinology.', source: 'MANUAL' as AppointmentSource },
  ];

  for (const appt of maggieAppointments) {
    await prisma.appointment.create({ data: { userId: maggie.id, ...appt } });
  }

  // Labs — multiple time points to show trends
  const maggieLabs = [
    // HbA1c trend (worsening)
    { testName: 'HbA1c', value: 7.8, unit: '%', referenceMin: 0, referenceMax: 7.0, recordedAt: daysAgo(30), isFlagged: true, providerName: 'Dr. Chen' },
    { testName: 'HbA1c', value: 7.5, unit: '%', referenceMin: 0, referenceMax: 7.0, recordedAt: daysAgo(120), isFlagged: true, providerName: 'Dr. Chen' },
    { testName: 'HbA1c', value: 7.2, unit: '%', referenceMin: 0, referenceMax: 7.0, recordedAt: daysAgo(240), isFlagged: true, providerName: 'Dr. Okafor' },
    // eGFR trend (declining)
    { testName: 'eGFR', value: 44, unit: 'mL/min/1.73m²', referenceMin: 60, referenceMax: 120, recordedAt: daysAgo(30), isFlagged: true, providerName: 'Dr. Patel' },
    { testName: 'eGFR', value: 48, unit: 'mL/min/1.73m²', referenceMin: 60, referenceMax: 120, recordedAt: daysAgo(120), isFlagged: true, providerName: 'Dr. Patel' },
    { testName: 'eGFR', value: 55, unit: 'mL/min/1.73m²', referenceMin: 60, referenceMax: 120, recordedAt: daysAgo(360), isFlagged: true, providerName: 'Dr. Patel' },
    { testName: 'eGFR', value: 62, unit: 'mL/min/1.73m²', referenceMin: 60, referenceMax: 120, recordedAt: daysAgo(540), isFlagged: false, providerName: 'Dr. Okafor' },
    // TSH
    { testName: 'TSH', value: 3.2, unit: 'mIU/L', referenceMin: 0.4, referenceMax: 4.0, recordedAt: daysAgo(45), isFlagged: false, providerName: 'Dr. Chen' },
    { testName: 'TSH', value: 4.8, unit: 'mIU/L', referenceMin: 0.4, referenceMax: 4.0, recordedAt: daysAgo(240), isFlagged: true, providerName: 'Dr. Okafor' },
    // LDL
    { testName: 'LDL Cholesterol', value: 98, unit: 'mg/dL', referenceMin: 0, referenceMax: 100, recordedAt: daysAgo(45), isFlagged: false, providerName: 'Dr. Williams' },
    { testName: 'LDL Cholesterol', value: 118, unit: 'mg/dL', referenceMin: 0, referenceMax: 100, recordedAt: daysAgo(300), isFlagged: true, providerName: 'Dr. Okafor' },
    // Creatinine
    { testName: 'Serum Creatinine', value: 1.42, unit: 'mg/dL', referenceMin: 0.5, referenceMax: 1.1, recordedAt: daysAgo(30), isFlagged: true, providerName: 'Dr. Patel' },
    { testName: 'Serum Creatinine', value: 1.31, unit: 'mg/dL', referenceMin: 0.5, referenceMax: 1.1, recordedAt: daysAgo(120), isFlagged: true, providerName: 'Dr. Patel' },
    // Potassium (lisinopril monitoring)
    { testName: 'Potassium', value: 5.1, unit: 'mEq/L', referenceMin: 3.5, referenceMax: 5.0, recordedAt: daysAgo(30), isFlagged: true, providerName: 'Dr. Patel', notes: 'Borderline elevation — monitor with Lisinopril + CKD' },
    // Urine albumin
    { testName: 'Urine Albumin-to-Creatinine Ratio', value: 68, unit: 'mg/g', referenceMin: 0, referenceMax: 30, recordedAt: daysAgo(30), isFlagged: true, providerName: 'Dr. Patel' },
    // Fasting glucose
    { testName: 'Fasting Glucose', value: 162, unit: 'mg/dL', referenceMin: 70, referenceMax: 100, recordedAt: daysAgo(30), isFlagged: true, providerName: 'Dr. Chen' },
  ];

  for (const lab of maggieLabs) {
    await prisma.labResult.create({ data: { userId: maggie.id, ...lab } });
  }

  const maggieVitals = [
    { type: 'BLOOD_PRESSURE' as VitalType, value: 148, value2: 88, unit: 'mmHg', recordedAt: daysAgo(3) },
    { type: 'BLOOD_PRESSURE' as VitalType, value: 152, value2: 92, unit: 'mmHg', recordedAt: daysAgo(30) },
    { type: 'BLOOD_PRESSURE' as VitalType, value: 146, value2: 90, unit: 'mmHg', recordedAt: daysAgo(62) },
    { type: 'BLOOD_PRESSURE' as VitalType, value: 158, value2: 96, unit: 'mmHg', recordedAt: daysAgo(120) },
    { type: 'WEIGHT' as VitalType, value: 182, unit: 'lbs', recordedAt: daysAgo(3) },
    { type: 'WEIGHT' as VitalType, value: 184, unit: 'lbs', recordedAt: daysAgo(45) },
    { type: 'WEIGHT' as VitalType, value: 186, unit: 'lbs', recordedAt: daysAgo(120) },
    { type: 'BLOOD_GLUCOSE' as VitalType, value: 168, unit: 'mg/dL', recordedAt: daysAgo(2), notes: 'Fasting' },
    { type: 'BLOOD_GLUCOSE' as VitalType, value: 155, unit: 'mg/dL', recordedAt: daysAgo(9), notes: 'Fasting' },
    { type: 'BLOOD_GLUCOSE' as VitalType, value: 188, unit: 'mg/dL', recordedAt: daysAgo(16), notes: '2 hours post-meal' },
    { type: 'HEART_RATE' as VitalType, value: 74, unit: 'bpm', recordedAt: daysAgo(3) },
  ];

  for (const vital of maggieVitals) {
    await prisma.vital.create({ data: { userId: maggie.id, ...vital } });
  }

  await prisma.healthInsightReport.create({
    data: {
      userId: maggie.id,
      summary: 'Your health records across five providers reveal several patterns that no single provider currently has visibility into. Most urgently, your Meloxicam prescription from orthopedics combined with your Lisinopril creates a documented drug interaction risk in patients with CKD Stage 3a — your nephrology team was not made aware of this prescription. Your kidney function (eGFR) has declined from 62 to 44 mL/min/1.73m² over 18 months, a trajectory that warrants close monitoring. Your HbA1c has risen from 7.2% to 7.8% over the same period despite medication adjustments.',
      insights: [
        {
          title: 'Drug Interaction Risk: Meloxicam + Lisinopril in CKD Stage 3a',
          confidence: 'high',
          supportingEvidence: [
            { text: 'Meloxicam 7.5mg QD prescribed by Dr. Russo (Orthopedics)', source: 'Orthopedics visit note', date: '14 days ago' },
            { text: 'Lisinopril 10mg QD (active)', source: 'PCP medication list', date: 'Current' },
            { text: 'eGFR 44 mL/min/1.73m² — CKD Stage 3a confirmed', source: 'Dr. Patel lab order', date: '1 month ago' },
            { text: 'Creatinine 1.42 mg/dL (above range)', source: 'Dr. Patel lab order', date: '1 month ago' },
          ],
          suggestedDiscussion: 'NSAIDs like Meloxicam reduce blood flow to the kidneys and can accelerate CKD progression. Combined with an ACE inhibitor (Lisinopril), this risk is compounded. Ask your PCP or nephrologist to review whether Meloxicam is still appropriate, and whether an alternative pain management approach is available.',
          relatedConditions: ['CKD Stage 3a', 'Osteoarthritis', 'Hypertension'],
        },
        {
          title: 'eGFR Declining — 18-Month Trend',
          confidence: 'high',
          supportingEvidence: [
            { text: 'eGFR 62 mL/min/1.73m² (Stage 2)', source: 'Dr. Okafor annual labs', date: '18 months ago' },
            { text: 'eGFR 55 mL/min/1.73m² (Stage 3a)', source: 'Dr. Patel', date: '12 months ago' },
            { text: 'eGFR 48 mL/min/1.73m² (Stage 3a)', source: 'Dr. Patel', date: '4 months ago' },
            { text: 'eGFR 44 mL/min/1.73m² (Stage 3a)', source: 'Dr. Patel', date: '1 month ago' },
          ],
          suggestedDiscussion: 'Your kidney function has declined 18 points over 18 months. Ask your nephrologist whether the rate of decline is expected, and whether any current medications — including Meloxicam — may be contributing.',
          relatedConditions: ['CKD Stage 3a', 'Type 2 Diabetes', 'Hypertension'],
        },
        {
          title: 'HbA1c Rising Despite Medication Adjustment',
          confidence: 'moderate',
          supportingEvidence: [
            { text: 'HbA1c 7.2% — on prior Metformin dose', source: 'Dr. Okafor', date: '8 months ago' },
            { text: 'Metformin dose reduced by nephrology', source: 'Dr. Patel visit note', date: '3 months ago' },
            { text: 'HbA1c 7.8%', source: 'Dr. Chen', date: '1 month ago' },
          ],
          suggestedDiscussion: 'Your blood sugar control has worsened since your Metformin dose was reduced. Ask your endocrinologist and PCP whether your current regimen — including Empagliflozin — needs adjustment to account for the dose change.',
          relatedConditions: ['Type 2 Diabetes', 'CKD Stage 3a'],
        },
      ],
      gaps: [
        'Meloxicam prescription not reflected in PCP or nephrology medication lists — siloed prescribing',
        'Empagliflozin initiated without documented cardiology review',
        'No urine microalbumin trend prior to 2024 — baseline unclear',
        'Preventive screenings (colonoscopy, diabetic eye exam) last recorded status unknown — possible overdue',
        'Metformin dose change by nephrology not communicated to PCP or endocrinology for 3 weeks',
      ],
    },
  });

  // ── Persona 2: Jordan Lee ────────────────────────────────────────────────────
  const jordan = await prisma.user.upsert({
    where: { email: 'jordan@demo.fila.health' },
    update: {},
    create: {
      email: 'jordan@demo.fila.health',
      passwordHash: await bcrypt.hash('demo1234', 12),
      name: 'Jordan Lee',
      dateOfBirth: new Date('1991-09-02'),
    },
  });

  const jordanHistory = [
    { category: 'CONDITION' as HistoryCategory, name: 'Fibromyalgia', details: 'ICD-10: M79.3. Working diagnosis. Diagnosed after rheumatology ruled out lupus and RA. Widespread musculoskeletal pain averaging 6/10 daily.', startDate: new Date('2023-04-01') },
    { category: 'CONDITION' as HistoryCategory, name: 'Mast Cell Activation Syndrome (suspected)', details: 'ICD-10: D89.40. Under evaluation by Dr. Torres (Allergy/Immunology). Suspected based on episodic symptom pattern and triggers.', startDate: new Date('2024-01-15') },
    { category: 'CONDITION' as HistoryCategory, name: 'Postural Orthostatic Tachycardia Syndrome (suspected)', details: 'ICD-10: G90.3. Under evaluation by Dr. Santos (Neurology). Tilt table test pending.', startDate: new Date('2023-11-01') },
    { category: 'CONDITION' as HistoryCategory, name: 'Major Depressive Disorder, Recurrent Moderate', details: 'ICD-10: F33.1. Under care of Dr. Mehta (Psychiatry). Psychiatric medications prescribed without full autoimmune workup context being shared with prescriber.', startDate: new Date('2022-06-01') },
    { category: 'CONDITION' as HistoryCategory, name: 'Generalized Anxiety Disorder', details: 'ICD-10: F41.1. Co-managed by PCP and psychiatry.', startDate: new Date('2022-06-01') },
    { category: 'CONDITION' as HistoryCategory, name: 'Irritable Bowel Syndrome', details: 'ICD-10: K58.9. Under care of Dr. Park (Gastroenterology). Rome IV criteria met.', startDate: new Date('2022-10-15') },
    // Ruled out
    { category: 'CONDITION' as HistoryCategory, name: 'Systemic Lupus Erythematosus (ruled out ×2)', details: 'Workup completed by Rheumatology at OHSU (2021) and Providence (2023). Both concluded insufficient criteria. ANA 1:80 speckled — weakly positive.', startDate: new Date('2021-03-01'), endDate: new Date('2023-07-01') },
    { category: 'CONDITION' as HistoryCategory, name: 'Multiple Sclerosis (ruled out)', details: 'MRI brain and spine without demyelinating lesions. Neurology cleared MS diagnosis.', startDate: new Date('2022-09-01'), endDate: new Date('2022-12-01') },
    // Discontinued meds
    { category: 'MEDICATION' as HistoryCategory, name: 'Pregabalin (Lyrica) 75mg', details: 'Prescribed for fibromyalgia. Discontinued due to cognitive fog worsening and weight gain.', startDate: new Date('2023-05-01'), endDate: new Date('2023-09-01') },
    { category: 'MEDICATION' as HistoryCategory, name: 'Duloxetine (Cymbalta) 60mg', details: 'Prescribed for MDD and fibromyalgia pain. Discontinued — inadequate response, increased anxiety.', startDate: new Date('2022-07-01'), endDate: new Date('2023-03-01') },
    { category: 'MEDICATION' as HistoryCategory, name: 'Amitriptyline 25mg', details: 'Prescribed by PCP for sleep and pain. Discontinued due to morning grogginess and dry mouth.', startDate: new Date('2022-11-01'), endDate: new Date('2023-01-15') },
    { category: 'MEDICATION' as HistoryCategory, name: 'Hydroxyzine 25mg', details: 'Prescribed for anxiety. Discontinued — sedation interfered with work.', startDate: new Date('2022-08-01'), endDate: new Date('2022-10-15') },
    { category: 'MEDICATION' as HistoryCategory, name: 'Cyclobenzaprine 5mg', details: 'Muscle relaxant. Discontinued — too sedating.', startDate: new Date('2023-02-01'), endDate: new Date('2023-04-01') },
    // Current meds
    { category: 'MEDICATION' as HistoryCategory, name: 'Low-Dose Naltrexone (LDN) 4.5mg', details: 'Ongoing trial for fibromyalgia and possible MCAS. Prescribed by functional medicine PCP (Dr. Hayes). Some improvement in pain scores reported.', startDate: daysAgo(180) },
    { category: 'ALLERGY' as HistoryCategory, name: 'Gluten (suspected trigger)', details: 'Self-reported symptom exacerbation 72 hours post-gluten exposure — not formally diagnosed as celiac. Possible MCAS trigger.' },
    { category: 'ALLERGY' as HistoryCategory, name: 'NSAIDs', details: 'Suspected MCAS-related reaction — flushing and GI symptoms. Avoid.' },
    { category: 'FAMILY_HISTORY' as HistoryCategory, name: 'Autoimmune Disease', details: 'Mother — Hashimoto\'s thyroiditis. Maternal aunt — rheumatoid arthritis.' },
    { category: 'FAMILY_HISTORY' as HistoryCategory, name: 'Depression', details: 'Father — treated with SSRIs.' },
  ];

  for (const entry of jordanHistory) {
    await prisma.medicalHistoryEntry.create({ data: { userId: jordan.id, ...entry, isManual: true } });
  }

  await prisma.provider.createMany({
    data: [
      { userId: jordan.id, name: 'Hayes, Monica, ND', providerType: 'Naturopathic Doctor', specialty: 'Functional Medicine', affiliation: 'Portland Integrative Health', phone: '(503) 555-0112', isManual: true },
      { userId: jordan.id, name: 'Santos, Elena, MD', providerType: 'Medical Doctor', specialty: 'Neurology', affiliation: 'OHSU Neurology', phone: '(503) 555-0203', isManual: true },
      { userId: jordan.id, name: 'Park, James, MD', providerType: 'Medical Doctor', specialty: 'Gastroenterology', affiliation: 'Providence GI Associates', phone: '(503) 555-0291', isManual: true },
      { userId: jordan.id, name: 'Mehta, Priya, MD', providerType: 'Medical Doctor', specialty: 'Psychiatry', affiliation: 'Oregon Health Sciences', phone: '(503) 555-0344', isManual: true },
      { userId: jordan.id, name: 'Torres, Ricardo, MD', providerType: 'Medical Doctor', specialty: 'Immunology & Allergy', affiliation: 'Northwest Allergy & Asthma', phone: '(503) 555-0488', isManual: true },
    ],
  });

  const jordanAppointments = [
    { providerName: 'Dr. Torres, Allergy/Immunology', specialty: 'Immunology & Allergy', scheduledAt: daysFromNow(18), reason: 'MCAS evaluation follow-up — serum tryptase and histamine results review', source: 'MANUAL' as AppointmentSource },
    { providerName: 'Dr. Santos, Neurology', specialty: 'Neurology', scheduledAt: daysFromNow(35), reason: 'POTS — tilt table test', source: 'MANUAL' as AppointmentSource },
    { providerName: 'Dr. Mehta, Psychiatry', specialty: 'Psychiatry', scheduledAt: daysAgo(10), reason: 'Medication management — MDD and anxiety', notes: 'Prescriber did not have autoimmune workup results available. Adjusted LDN dose without context from allergy/immunology.', source: 'MANUAL' as AppointmentSource },
    { providerName: 'Dr. Park, Gastroenterology', specialty: 'Gastroenterology', scheduledAt: daysAgo(42), reason: 'IBS follow-up — low-FODMAP diet adherence review', notes: 'GI symptoms improving on low-FODMAP. Did not have MCAS workup results to consider mast cell component.', source: 'MANUAL' as AppointmentSource },
    { providerName: 'Dr. Hayes, Functional Medicine', specialty: 'Functional Medicine', scheduledAt: daysAgo(60), reason: 'LDN dose titration — pain response assessment', notes: 'Mild improvement in pain scores (from 7/10 to 5.5/10). Will continue at 4.5mg.', source: 'MANUAL' as AppointmentSource },
    { providerName: 'Rheumatology, Providence', specialty: 'Rheumatology', scheduledAt: daysAgo(365), reason: 'Lupus second opinion — repeat ANA panel', notes: 'ANA 1:80 speckled. Insufficient criteria for SLE. Referred back to PCP. Repeat of ANA panel already completed at OHSU in 2021 — $340 duplicate cost.', source: 'MANUAL' as AppointmentSource },
    { providerName: 'Rheumatology, OHSU', specialty: 'Rheumatology', scheduledAt: daysAgo(730 + 60), reason: 'Lupus evaluation — initial workup', notes: 'Lupus ruled out. ANA 1:80 speckled. Recommended monitoring. Records not transferred to subsequent providers.', source: 'MANUAL' as AppointmentSource },
  ];

  for (const appt of jordanAppointments) {
    await prisma.appointment.create({ data: { userId: jordan.id, ...appt } });
  }

  const jordanLabs = [
    // ANA — duplicate tests across providers
    { testName: 'ANA (Antinuclear Antibody)', value: 80, unit: 'titer (1:80 speckled)', referenceMin: 0, referenceMax: 40, recordedAt: daysAgo(365), isFlagged: true, providerName: 'Providence Rheumatology', notes: 'Repeat of prior OHSU result — $340 duplicate cost' },
    { testName: 'ANA (Antinuclear Antibody)', value: 80, unit: 'titer (1:80 speckled)', referenceMin: 0, referenceMax: 40, recordedAt: daysAgo(730 + 30), isFlagged: true, providerName: 'OHSU Rheumatology', notes: 'Original result' },
    // CBC — ordered multiple times by different providers
    { testName: 'WBC', value: 6.2, unit: 'K/µL', referenceMin: 4.5, referenceMax: 11.0, recordedAt: daysAgo(42), isFlagged: false, providerName: 'Dr. Park' },
    { testName: 'WBC', value: 5.8, unit: 'K/µL', referenceMin: 4.5, referenceMax: 11.0, recordedAt: daysAgo(365), isFlagged: false, providerName: 'Providence Rheumatology' },
    { testName: 'Hemoglobin', value: 12.4, unit: 'g/dL', referenceMin: 12.0, referenceMax: 16.0, recordedAt: daysAgo(42), isFlagged: false, providerName: 'Dr. Park' },
    // Lyme (tested 3×, all negative)
    { testName: 'Lyme Disease Ab (ELISA)', value: 0, unit: 'Negative', referenceMin: 0, referenceMax: 0.9, recordedAt: daysAgo(500), isFlagged: false, providerName: 'PCP', notes: 'Third negative Lyme test — redundant testing across providers' },
    // Inflammatory markers
    { testName: 'hsCRP', value: 1.8, unit: 'mg/L', referenceMin: 0, referenceMax: 1.0, recordedAt: daysAgo(60), isFlagged: true, providerName: 'Dr. Hayes' },
    { testName: 'ESR', value: 28, unit: 'mm/hr', referenceMin: 0, referenceMax: 20, recordedAt: daysAgo(60), isFlagged: true, providerName: 'Dr. Hayes' },
    // Serum tryptase (MCAS workup)
    { testName: 'Serum Tryptase (Baseline)', value: 8.2, unit: 'ng/mL', referenceMin: 0, referenceMax: 11.4, recordedAt: daysAgo(30), isFlagged: false, providerName: 'Dr. Torres', notes: 'Baseline tryptase normal — does not rule out MCAS' },
    // Thyroid
    { testName: 'TSH', value: 2.1, unit: 'mIU/L', referenceMin: 0.4, referenceMax: 4.0, recordedAt: daysAgo(60), isFlagged: false, providerName: 'Dr. Hayes' },
    { testName: 'TPO Antibodies', value: 42, unit: 'IU/mL', referenceMin: 0, referenceMax: 34, recordedAt: daysAgo(60), isFlagged: true, providerName: 'Dr. Hayes', notes: 'Mildly elevated — given maternal Hashimoto\'s, warrants monitoring' },
    // Vitamin D
    { testName: 'Vitamin D (25-OH)', value: 22, unit: 'ng/mL', referenceMin: 30, referenceMax: 100, recordedAt: daysAgo(60), isFlagged: true, providerName: 'Dr. Hayes' },
  ];

  for (const lab of jordanLabs) {
    await prisma.labResult.create({ data: { userId: jordan.id, ...lab } });
  }

  const jordanVitals = [
    // Pain score tracked as a vital (using steps field as proxy — workaround for symptom tracking)
    { type: 'HEART_RATE' as VitalType, value: 88, unit: 'bpm', recordedAt: daysAgo(1), notes: 'Flare day — elevated HR on standing, dizziness reported (POTS symptom)' },
    { type: 'HEART_RATE' as VitalType, value: 72, unit: 'bpm', recordedAt: daysAgo(8), notes: 'Baseline' },
    { type: 'WEIGHT' as VitalType, value: 134, unit: 'lbs', recordedAt: daysAgo(30) },
    { type: 'WEIGHT' as VitalType, value: 131, unit: 'lbs', recordedAt: daysAgo(180) },
    { type: 'BLOOD_PRESSURE' as VitalType, value: 98, value2: 62, unit: 'mmHg', recordedAt: daysAgo(1), notes: 'Lying down' },
    { type: 'BLOOD_PRESSURE' as VitalType, value: 92, value2: 58, unit: 'mmHg', recordedAt: daysAgo(1), notes: 'Standing — orthostatic drop noted' },
    { type: 'SLEEP_HOURS' as VitalType, value: 4.5, unit: 'hours', recordedAt: daysAgo(2), notes: 'Flare — pain-disrupted sleep' },
    { type: 'SLEEP_HOURS' as VitalType, value: 7.2, unit: 'hours', recordedAt: daysAgo(10), notes: 'Better night' },
  ];

  for (const vital of jordanVitals) {
    await prisma.vital.create({ data: { userId: jordan.id, ...vital } });
  }

  await prisma.healthInsightReport.create({
    data: {
      userId: jordan.id,
      summary: 'Your records across 7 providers and 4 years reveal a coherent pattern that has not yet been presented to any single provider in full. Across your complete history, mildly elevated TPO antibodies (42 IU/mL), a weakly positive ANA (1:80 speckled), elevated hsCRP (1.8 mg/L) and ESR, and a maternal family history of Hashimoto\'s and rheumatoid arthritis suggest an underlying inflammatory or autoimmune predisposition that may be contributing to your fibromyalgia, MCAS, and POTS symptoms. Three providers have noted symptoms as psychosomatic without reviewing the full autoimmune workup. An estimated $2,800 has been spent on duplicate lab work.',
      insights: [
        {
          title: 'Possible Autoimmune Underpinning — Unreported Across Providers',
          confidence: 'moderate',
          supportingEvidence: [
            { text: 'ANA 1:80 speckled (both OHSU 2021 and Providence 2023)', source: 'Rheumatology × 2', date: '3 years and 1 year ago' },
            { text: 'TPO Antibodies 42 IU/mL (mildly elevated)', source: 'Dr. Hayes functional labs', date: '2 months ago' },
            { text: 'hsCRP 1.8 mg/L, ESR 28 mm/hr (above range)', source: 'Dr. Hayes', date: '2 months ago' },
            { text: 'Mother: Hashimoto\'s thyroiditis. Maternal aunt: RA.', source: 'Family history', date: 'Documented' },
          ],
          suggestedDiscussion: 'No single provider currently holds all of this data. Consider sharing this summary with a rheumatologist and your PCP together. The combination of weakly positive ANA, elevated TPO Ab, and family history warrants a unified review before additional diagnoses are pursued in isolation.',
          relatedConditions: ['Fibromyalgia', 'MCAS', 'POTS', 'MDD'],
        },
        {
          title: '$2,800 in Duplicate Lab Work Identified',
          confidence: 'high',
          supportingEvidence: [
            { text: 'ANA ordered and run at OHSU Rheumatology', source: 'OHSU 2021', date: '4 years ago' },
            { text: 'ANA re-ordered at Providence Rheumatology without OHSU records', source: 'Providence 2023', date: '1 year ago' },
            { text: 'CBC ordered by 3 separate providers in 24 months', source: 'PCP, Rheumatology × 2', date: 'Multiple dates' },
            { text: 'Lyme disease tested 3 times, all negative', source: 'Three different providers', date: 'Multiple dates' },
          ],
          suggestedDiscussion: 'A significant portion of your out-of-pocket lab costs appear to stem from duplicate testing across providers who lacked access to prior results. Carrying a Fila summary to each new provider intake can prevent this.',
          relatedConditions: [],
        },
        {
          title: 'Low Vitamin D May Be Worsening Fatigue and Pain',
          confidence: 'moderate',
          supportingEvidence: [
            { text: 'Vitamin D 22 ng/mL (below 30 ng/mL recommended)', source: 'Dr. Hayes', date: '2 months ago' },
            { text: 'Severe fatigue reported 5 of 7 days', source: 'Self-reported symptom log', date: 'Ongoing' },
          ],
          suggestedDiscussion: 'Vitamin D deficiency is associated with worsened fibromyalgia pain and fatigue. Ask your provider about supplementation — this is a low-risk, potentially high-benefit intervention.',
          relatedConditions: ['Fibromyalgia', 'Fatigue'],
        },
      ],
      gaps: [
        'TPO antibody elevation (42 IU/mL) has not been shared with rheumatology or psychiatry',
        'Autoimmune workup context not available to Dr. Mehta (psychiatry) when prescribing',
        'POTS tilt-table test still pending — orthostatic blood pressure data not yet formally evaluated',
        'No food-symptom diary data in medical record despite suspected dietary triggers for MCAS',
        'Psychiatric medication trials not fully documented across all provider records',
      ],
    },
  });

  // ── Persona 3: Derek Kim ─────────────────────────────────────────────────────
  const derek = await prisma.user.upsert({
    where: { email: 'derek@demo.fila.health' },
    update: {},
    create: {
      email: 'derek@demo.fila.health',
      passwordHash: await bcrypt.hash('demo1234', 12),
      name: 'Derek Kim',
      dateOfBirth: new Date('1983-07-18'),
    },
  });

  const derekHistory = [
    // No active diagnoses — supplements and family history only
    { category: 'SUPPLEMENT' as HistoryCategory, name: 'Magnesium Glycinate 400mg', details: 'Nightly. Sleep quality and muscle recovery.', startDate: daysAgo(730) },
    { category: 'SUPPLEMENT' as HistoryCategory, name: 'Omega-3 Fish Oil 2g', details: 'Daily. Cardiovascular health and inflammation.', startDate: daysAgo(1095) },
    { category: 'SUPPLEMENT' as HistoryCategory, name: 'Vitamin D3 5000 IU', details: 'Daily with Vitamin K2. Immune and bone health.', startDate: daysAgo(1095) },
    { category: 'SUPPLEMENT' as HistoryCategory, name: 'Creatine Monohydrate 5g', details: 'Daily post-workout. Muscle performance and cognitive function.', startDate: daysAgo(540) },
    { category: 'SUPPLEMENT' as HistoryCategory, name: 'NMN (Nicotinamide Mononucleotide) 500mg', details: 'Daily. NAD+ precursor for metabolic and longevity support.', startDate: daysAgo(365) },
    { category: 'SUPPLEMENT' as HistoryCategory, name: 'Berberine 500mg', details: 'Daily with largest meal. Metabolic optimization — insulin sensitization. NOT disclosed to One Medical PCP. Carries interaction risk if statin or metformin is ever prescribed.', startDate: daysAgo(270) },
    { category: 'FAMILY_HISTORY' as HistoryCategory, name: 'Cardiovascular Disease', details: 'Father — coronary artery disease, stent at age 54. Paternal grandfather — fatal MI at 61.' },
    { category: 'FAMILY_HISTORY' as HistoryCategory, name: 'Type 2 Diabetes', details: 'Father — diagnosed at age 56. Paternal uncle — diagnosed at 49.' },
    { category: 'VACCINATION' as HistoryCategory, name: 'COVID-19 Booster (Moderna)', startDate: daysAgo(300) },
    { category: 'VACCINATION' as HistoryCategory, name: 'Flu Vaccine', startDate: daysAgo(250) },
  ];

  for (const entry of derekHistory) {
    await prisma.medicalHistoryEntry.create({ data: { userId: derek.id, ...entry, isManual: true } });
  }

  await prisma.provider.createMany({
    data: [
      { userId: derek.id, name: 'Tanaka, Lisa, MD', providerType: 'Medical Doctor', specialty: 'Primary Care', affiliation: 'One Medical — San Francisco', phone: '(415) 555-0122', isManual: true, notes: 'Direct primary care model. Annual preventive visits only. Does not have access to Function Health lab panels or wearable data.' },
      { userId: derek.id, name: 'Function Health', providerType: 'Lab / Diagnostics', specialty: 'Radiology', affiliation: 'Function Health (online)', website: 'functionhealth.com', isManual: true, notes: '111-marker annual bloodwork panel. Results not automatically shared with One Medical PCP.' },
    ],
  });

  const derekAppointments = [
    { providerName: 'Dr. Tanaka, One Medical', specialty: 'Primary Care', scheduledAt: daysFromNow(42), reason: 'Annual preventive visit', source: 'MANUAL' as AppointmentSource, notes: 'PCP will not have access to Function Health panels or Oura biometric data unless Derek brings a Fila summary.' },
    { providerName: 'Dr. Tanaka, One Medical', specialty: 'Primary Care', scheduledAt: daysAgo(330), reason: 'Annual preventive visit', notes: 'Standard physical. Berberine supplement not disclosed. Function Health results not shared. Wearable data not discussed.', source: 'MANUAL' as AppointmentSource },
    { providerName: 'Dr. Tanaka, One Medical', specialty: 'Primary Care', scheduledAt: daysAgo(695), reason: 'Annual preventive visit', notes: 'No concerns raised. Family history of CVD and T2D noted but no ApoB or fasting insulin ordered.', source: 'MANUAL' as AppointmentSource },
  ];

  for (const appt of derekAppointments) {
    await prisma.appointment.create({ data: { userId: derek.id, ...appt } });
  }

  // Function Health annual panels — 3 years of data
  const derekLabs = [
    // Year 3 (most recent — 60 days ago)
    { testName: 'ApoB', value: 82, unit: 'mg/dL', referenceMin: 0, referenceMax: 90, recordedAt: daysAgo(60), isFlagged: false, providerName: 'Function Health', notes: 'Year 3 panel. Trending down from Year 1.' },
    { testName: 'Fasting Insulin', value: 4.2, unit: 'µIU/mL', referenceMin: 2.0, referenceMax: 6.0, recordedAt: daysAgo(60), isFlagged: false, providerName: 'Function Health' },
    { testName: 'Lp(a)', value: 34, unit: 'nmol/L', referenceMin: 0, referenceMax: 75, recordedAt: daysAgo(60), isFlagged: false, providerName: 'Function Health', notes: 'Genetic — independent of lifestyle. Warrants monitoring given paternal CVD history.' },
    { testName: 'hsCRP', value: 0.6, unit: 'mg/L', referenceMin: 0, referenceMax: 1.0, recordedAt: daysAgo(60), isFlagged: false, providerName: 'Function Health' },
    { testName: 'Total Testosterone', value: 612, unit: 'ng/dL', referenceMin: 300, referenceMax: 1000, recordedAt: daysAgo(60), isFlagged: false, providerName: 'Function Health' },
    { testName: 'DHEA-S', value: 280, unit: 'µg/dL', referenceMin: 100, referenceMax: 400, recordedAt: daysAgo(60), isFlagged: false, providerName: 'Function Health' },
    { testName: 'Homocysteine', value: 9.2, unit: 'µmol/L', referenceMin: 5.0, referenceMax: 10.0, recordedAt: daysAgo(60), isFlagged: false, providerName: 'Function Health', notes: 'Upper-normal range — worth monitoring given CVD family history. Responsive to B-vitamin optimization.' },
    { testName: 'Ferritin', value: 88, unit: 'ng/mL', referenceMin: 30, referenceMax: 300, recordedAt: daysAgo(60), isFlagged: false, providerName: 'Function Health' },
    { testName: 'Fasting Glucose', value: 88, unit: 'mg/dL', referenceMin: 70, referenceMax: 99, recordedAt: daysAgo(60), isFlagged: false, providerName: 'Function Health' },
    { testName: 'HbA1c', value: 5.1, unit: '%', referenceMin: 0, referenceMax: 5.7, recordedAt: daysAgo(60), isFlagged: false, providerName: 'Function Health' },
    // Year 2 (≈13 months ago)
    { testName: 'ApoB', value: 88, unit: 'mg/dL', referenceMin: 0, referenceMax: 90, recordedAt: daysAgo(395), isFlagged: true, providerName: 'Function Health', notes: 'Year 2 panel. Slightly above target — Berberine started 3 months later.' },
    { testName: 'Fasting Insulin', value: 5.8, unit: 'µIU/mL', referenceMin: 2.0, referenceMax: 6.0, recordedAt: daysAgo(395), isFlagged: false, providerName: 'Function Health' },
    { testName: 'hsCRP', value: 1.1, unit: 'mg/L', referenceMin: 0, referenceMax: 1.0, recordedAt: daysAgo(395), isFlagged: true, providerName: 'Function Health', notes: 'Mildly elevated — normalized by Year 3.' },
    { testName: 'Fasting Glucose', value: 94, unit: 'mg/dL', referenceMin: 70, referenceMax: 99, recordedAt: daysAgo(395), isFlagged: false, providerName: 'Function Health', notes: 'Upper-normal — trending toward insulin resistance given family history.' },
    // Year 1 (≈25 months ago)
    { testName: 'ApoB', value: 96, unit: 'mg/dL', referenceMin: 0, referenceMax: 90, recordedAt: daysAgo(760), isFlagged: true, providerName: 'Function Health', notes: 'Year 1 panel. Highest recorded — lifestyle modifications and Berberine have driven improvement.' },
    { testName: 'Fasting Insulin', value: 7.2, unit: 'µIU/mL', referenceMin: 2.0, referenceMax: 6.0, recordedAt: daysAgo(760), isFlagged: true, providerName: 'Function Health', notes: 'Mild insulin resistance pattern. Improved with dietary changes and Berberine.' },
    { testName: 'hsCRP', value: 1.4, unit: 'mg/L', referenceMin: 0, referenceMax: 1.0, recordedAt: daysAgo(760), isFlagged: true, providerName: 'Function Health' },
  ];

  for (const lab of derekLabs) {
    await prisma.labResult.create({ data: { userId: derek.id, ...lab } });
  }

  const derekVitals = [
    // RHR from Oura (30-day avg 52 bpm)
    { type: 'HEART_RATE' as VitalType, value: 52, unit: 'bpm', recordedAt: daysAgo(1), source: 'oura', notes: 'Oura Ring — resting heart rate, 30-day average' },
    { type: 'HEART_RATE' as VitalType, value: 54, unit: 'bpm', recordedAt: daysAgo(30), source: 'oura', notes: 'Oura Ring — resting heart rate' },
    { type: 'HEART_RATE' as VitalType, value: 56, unit: 'bpm', recordedAt: daysAgo(90), source: 'oura' },
    // HRV from Oura (68ms 30-day avg)
    { type: 'SLEEP_HOURS' as VitalType, value: 7.4, unit: 'hours', recordedAt: daysAgo(1), source: 'oura', notes: 'Oura Ring — total sleep. HRV 72ms (above 30-day avg of 68ms).' },
    { type: 'SLEEP_HOURS' as VitalType, value: 6.8, unit: 'hours', recordedAt: daysAgo(7), source: 'oura', notes: 'Oura Ring. HRV 61ms (below avg — high-stress week).' },
    { type: 'SLEEP_HOURS' as VitalType, value: 7.6, unit: 'hours', recordedAt: daysAgo(14), source: 'oura' },
    // Weight
    { type: 'WEIGHT' as VitalType, value: 168, unit: 'lbs', recordedAt: daysAgo(3) },
    { type: 'WEIGHT' as VitalType, value: 167, unit: 'lbs', recordedAt: daysAgo(60) },
    { type: 'WEIGHT' as VitalType, value: 171, unit: 'lbs', recordedAt: daysAgo(395) },
    // Blood pressure
    { type: 'BLOOD_PRESSURE' as VitalType, value: 118, value2: 74, unit: 'mmHg', recordedAt: daysAgo(60), notes: 'One Medical annual visit' },
    // Steps from Apple Watch
    { type: 'STEPS' as VitalType, value: 11200, unit: 'steps', recordedAt: daysAgo(1), source: 'apple_health' },
    { type: 'STEPS' as VitalType, value: 9800, unit: 'steps', recordedAt: daysAgo(2), source: 'apple_health' },
    // Glucose from Levels CGM (episodic)
    { type: 'BLOOD_GLUCOSE' as VitalType, value: 98, unit: 'mg/dL', recordedAt: daysAgo(180), source: 'levels', notes: 'Levels CGM — fasting morning reading' },
    { type: 'BLOOD_GLUCOSE' as VitalType, value: 124, unit: 'mg/dL', recordedAt: daysAgo(180), source: 'levels', notes: 'Levels CGM — 1 hour post oatmeal breakfast' },
    { type: 'BLOOD_GLUCOSE' as VitalType, value: 108, unit: 'mg/dL', recordedAt: daysAgo(179), source: 'levels', notes: 'Levels CGM — post high-intensity interval training' },
  ];

  for (const vital of derekVitals) {
    await prisma.vital.create({ data: { userId: derek.id, ...vital } });
  }

  await prisma.healthInsightReport.create({
    data: {
      userId: derek.id,
      summary: 'Your health data across Function Health, Oura Ring, Levels CGM, and One Medical is currently fragmented across four platforms with no unified view. The most significant finding across your 3-year dataset: your ApoB has declined from 96 to 82 mg/dL — a 15% improvement that correlates with dietary changes and Berberine introduction, but which no provider has visibility into. Your Lp(a) of 34 nmol/L, combined with paternal coronary artery disease at age 54, places cardiovascular risk monitoring in a higher-priority tier than your current annual panel schedule suggests.',
      insights: [
        {
          title: 'ApoB 3-Year Downward Trend — Meaningful Progress',
          confidence: 'high',
          supportingEvidence: [
            { text: 'ApoB 96 mg/dL (above target)', source: 'Function Health Year 1', date: '25 months ago' },
            { text: 'ApoB 88 mg/dL (borderline)', source: 'Function Health Year 2', date: '13 months ago' },
            { text: 'ApoB 82 mg/dL (within target)', source: 'Function Health Year 3', date: '2 months ago' },
          ],
          suggestedDiscussion: 'Your ApoB trajectory is moving in the right direction. Given your father\'s CAD at 54, maintaining ApoB below 80 mg/dL is a reasonable target. Discuss this trend with your PCP — they currently have none of this data.',
          relatedConditions: ['Cardiovascular Risk', 'Family History CVD'],
        },
        {
          title: 'Berberine Not Disclosed to PCP — Interaction Risk',
          confidence: 'high',
          supportingEvidence: [
            { text: 'Berberine 500mg daily — started 9 months ago', source: 'Self-reported supplement log', date: 'Ongoing' },
            { text: 'Family history of T2D (father, paternal uncle)', source: 'Family history', date: 'Documented' },
            { text: 'One Medical PCP unaware of supplement stack', source: 'Visit note', date: '11 months ago' },
          ],
          suggestedDiscussion: 'Berberine has meaningful pharmacological activity — it lowers blood glucose through AMPK activation, similar to Metformin. If your PCP ever prescribes Metformin or a statin, the interaction with Berberine could cause additive effects. Disclose your full supplement stack at your next visit.',
          relatedConditions: ['Metabolic Health', 'Cardiovascular Risk'],
        },
        {
          title: 'Lp(a) + Paternal CVD History — Underweighted Risk',
          confidence: 'moderate',
          supportingEvidence: [
            { text: 'Lp(a) 34 nmol/L (below threshold but not low-risk)', source: 'Function Health Year 3', date: '2 months ago' },
            { text: 'Father — CAD, stent at age 54. Paternal grandfather — fatal MI at 61.', source: 'Family history', date: 'Documented' },
            { text: 'Homocysteine 9.2 µmol/L (upper-normal)', source: 'Function Health Year 3', date: '2 months ago' },
          ],
          suggestedDiscussion: 'Lp(a) is genetically determined and not modifiable by statins. At 34 nmol/L with a strong paternal CVD history, monitoring frequency and aggressive ApoB management become more important. Ask your PCP whether a cardiology consult for risk stratification is appropriate.',
          relatedConditions: ['Cardiovascular Risk', 'Family History CVD'],
        },
      ],
      gaps: [
        'Oura HRV and RHR data never shared with PCP — relevant to cardiovascular monitoring',
        'Levels CGM glucose data not correlated with annual Function Health fasting insulin trend',
        'Full supplement stack (6 supplements) never formally documented with any provider',
        'No coronary calcium score (CAC) on record despite paternal CAD at 54',
        'VO₂ Max estimate (48 mL/kg/min from Apple Watch) not in medical record',
      ],
    },
  });

  console.log('✓ Seeded 3 demo accounts');
  console.log('  maggie@demo.fila.health / demo1234  (Chronic Care Patient)');
  console.log('  jordan@demo.fila.health / demo1234  (Diagnostic Odyssey)');
  console.log('  derek@demo.fila.health  / demo1234  (Health-Conscious)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
