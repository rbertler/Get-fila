import { PrismaClient, RecordType, HistoryCategory, AppointmentSource, VitalType, ImagingStudyType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // ---- Patient 1: Sarah Chen ----
  const sarah = await prisma.user.upsert({
    where: { email: 'sarah@demo.fila.health' },
    update: {},
    create: {
      email: 'sarah@demo.fila.health',
      passwordHash: await bcrypt.hash('demo1234', 12),
      name: 'Sarah Chen',
      dateOfBirth: new Date('1985-03-15'),
    },
  });

  // Sarah's medical history
  const sarahHistory = [
    { category: 'CONDITION' as HistoryCategory, name: 'Iron Deficiency Anemia', details: 'Diagnosed 2022, managed with supplementation', startDate: new Date('2022-01-15') },
    { category: 'CONDITION' as HistoryCategory, name: 'Hypothyroidism', details: 'On levothyroxine 50mcg daily', startDate: new Date('2021-06-01') },
    { category: 'MEDICATION' as HistoryCategory, name: 'Levothyroxine 50mcg', details: 'Take once daily on empty stomach', startDate: new Date('2021-06-15') },
    { category: 'MEDICATION' as HistoryCategory, name: 'Ferrous Sulfate 325mg', details: 'Take with vitamin C twice daily', startDate: new Date('2022-01-20') },
    { category: 'ALLERGY' as HistoryCategory, name: 'Penicillin', details: 'Rash and hives — do not administer' },
    { category: 'ALLERGY' as HistoryCategory, name: 'Shellfish', details: 'Mild gastrointestinal reaction' },
    { category: 'SURGERY' as HistoryCategory, name: 'Appendectomy', details: 'Laparoscopic, uncomplicated', startDate: new Date('2010-07-04') },
    { category: 'VACCINATION' as HistoryCategory, name: 'COVID-19 Booster (Moderna)', startDate: new Date('2023-10-01') },
    { category: 'VACCINATION' as HistoryCategory, name: 'Flu Vaccine', startDate: new Date('2023-10-15') },
    { category: 'FAMILY_HISTORY' as HistoryCategory, name: 'Type 2 Diabetes', details: 'Mother and maternal grandmother' },
    { category: 'FAMILY_HISTORY' as HistoryCategory, name: 'Thyroid Disease', details: 'Mother — Hashimoto\'s thyroiditis' },
  ];

  for (const entry of sarahHistory) {
    await prisma.medicalHistoryEntry.create({ data: { userId: sarah.id, ...entry, isManual: true } });
  }

  // Sarah's appointments
  const now = new Date();
  const sarahAppointments = [
    { providerName: 'Dr. Emily Roberts', specialty: 'Endocrinology', scheduledAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000), reason: 'Thyroid follow-up — TSH recheck', source: 'MANUAL' as AppointmentSource },
    { providerName: 'Dr. James Park', specialty: 'Primary Care', scheduledAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), reason: 'Annual physical', notes: 'Reviewed iron levels, ordered CBC panel', source: 'MANUAL' as AppointmentSource },
    { providerName: 'Dr. Lisa Nguyen', specialty: 'Hematology', scheduledAt: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000), reason: 'Anemia management', notes: 'Ferritin improving, continue supplementation', source: 'MANUAL' as AppointmentSource },
    { providerName: 'Riverside Imaging', specialty: 'Radiology', scheduledAt: new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000), reason: 'Thyroid ultrasound', notes: 'No nodules detected', source: 'MANUAL' as AppointmentSource },
  ];

  for (const appt of sarahAppointments) {
    await prisma.appointment.create({ data: { userId: sarah.id, ...appt } });
  }

  // Sarah's lab results
  const sarahLabs = [
    { testName: 'Ferritin', value: 12, unit: 'ng/mL', referenceMin: 12, referenceMax: 150, recordedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), isFlagged: false, providerName: 'Dr. James Park' },
    { testName: 'Ferritin', value: 8, unit: 'ng/mL', referenceMin: 12, referenceMax: 150, recordedAt: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000), isFlagged: true, providerName: 'Dr. Lisa Nguyen' },
    { testName: 'TSH', value: 3.2, unit: 'mIU/L', referenceMin: 0.4, referenceMax: 4.0, recordedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), isFlagged: false, providerName: 'Dr. James Park' },
    { testName: 'TSH', value: 5.8, unit: 'mIU/L', referenceMin: 0.4, referenceMax: 4.0, recordedAt: new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000), isFlagged: true, providerName: 'Dr. Emily Roberts' },
    { testName: 'Hemoglobin', value: 11.8, unit: 'g/dL', referenceMin: 12.0, referenceMax: 16.0, recordedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), isFlagged: true, providerName: 'Dr. James Park' },
    { testName: 'Hemoglobin', value: 10.2, unit: 'g/dL', referenceMin: 12.0, referenceMax: 16.0, recordedAt: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000), isFlagged: true, providerName: 'Dr. Lisa Nguyen' },
    { testName: 'Vitamin D', value: 18, unit: 'ng/mL', referenceMin: 30, referenceMax: 100, recordedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), isFlagged: true, providerName: 'Dr. James Park' },
    { testName: 'HbA1c', value: 5.4, unit: '%', referenceMin: 0, referenceMax: 5.7, recordedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), isFlagged: false, providerName: 'Dr. James Park' },
  ];

  for (const lab of sarahLabs) {
    await prisma.labResult.create({ data: { userId: sarah.id, ...lab } });
  }

  // Sarah's vitals
  const sarahVitals = [
    { type: 'WEIGHT' as VitalType, value: 132, unit: 'lbs', recordedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000) },
    { type: 'WEIGHT' as VitalType, value: 131, unit: 'lbs', recordedAt: new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000) },
    { type: 'WEIGHT' as VitalType, value: 134, unit: 'lbs', recordedAt: new Date(now.getTime() - 95 * 24 * 60 * 60 * 1000) },
    { type: 'BLOOD_PRESSURE' as VitalType, value: 118, value2: 76, unit: 'mmHg', recordedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
    { type: 'BLOOD_PRESSURE' as VitalType, value: 122, value2: 80, unit: 'mmHg', recordedAt: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) },
    { type: 'HEART_RATE' as VitalType, value: 72, unit: 'bpm', recordedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
    { type: 'HEART_RATE' as VitalType, value: 68, unit: 'bpm', recordedAt: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) },
    { type: 'OXYGEN_SATURATION' as VitalType, value: 98, unit: '%', recordedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
  ];

  for (const vital of sarahVitals) {
    await prisma.vital.create({ data: { userId: sarah.id, ...vital } });
  }

  // Sarah's pre-generated insight report
  await prisma.healthInsightReport.create({
    data: {
      userId: sarah.id,
      summary: 'Your health records show a pattern of improving iron stores and stable thyroid function over the past 6 months. Your ferritin has risen from 8 ng/mL to 12 ng/mL, suggesting your iron supplementation is working. Your TSH has normalized from 5.8 to 3.2 mIU/L with your current levothyroxine dose. One area to discuss with your doctor: your Vitamin D level of 18 ng/mL is below the recommended range.',
      insights: [
        {
          title: 'Iron Levels Improving But Still Worth Watching',
          confidence: 'moderate',
          supportingEvidence: [
            { text: 'Ferritin 8 ng/mL (below range)', source: 'Dr. Lisa Nguyen Lab Report', date: '3 months ago' },
            { text: 'Ferritin 12 ng/mL (low-normal)', source: 'Dr. James Park Annual Physical', date: '1 month ago' },
            { text: 'Hemoglobin 11.8 g/dL (slightly below range)', source: 'Dr. James Park Annual Physical', date: '1 month ago' },
          ],
          suggestedDiscussion: 'Your iron stores have improved with supplementation, but are still at the low end of normal. Consider asking your doctor how long to continue supplementation and when to retest.',
          relatedConditions: ['Iron Deficiency Anemia', 'Fatigue'],
        },
        {
          title: 'Thyroid Function Stabilizing',
          confidence: 'high',
          supportingEvidence: [
            { text: 'TSH 5.8 mIU/L (above range)', source: 'Dr. Emily Roberts', date: '6 months ago' },
            { text: 'TSH 3.2 mIU/L (within range)', source: 'Dr. James Park Annual Physical', date: '1 month ago' },
          ],
          suggestedDiscussion: 'Your thyroid levels have improved significantly on your current medication dose. Ask your endocrinologist whether your upcoming appointment will lead to any dose adjustments.',
          relatedConditions: ['Hypothyroidism', 'Hashimoto\'s Thyroiditis'],
        },
        {
          title: 'Low Vitamin D Detected',
          confidence: 'high',
          supportingEvidence: [
            { text: 'Vitamin D 18 ng/mL (below recommended 30 ng/mL)', source: 'Dr. James Park Annual Physical', date: '1 month ago' },
          ],
          suggestedDiscussion: 'Your Vitamin D is below the recommended range. This is common but worth addressing — ask your doctor about supplementation, as low Vitamin D can contribute to fatigue and affects many body systems.',
          relatedConditions: ['Vitamin D Deficiency', 'Bone Health', 'Fatigue'],
        },
      ],
      gaps: [
        'No recent complete metabolic panel found',
        'No B12 level on record — low B12 can cause similar symptoms to iron deficiency',
        'Thyroid antibody tests (TPO Ab) not found — relevant given family history of Hashimoto\'s',
      ],
    },
  });

  // ---- Patient 2: Marcus Johnson ----
  const marcus = await prisma.user.upsert({
    where: { email: 'marcus@demo.fila.health' },
    update: {},
    create: {
      email: 'marcus@demo.fila.health',
      passwordHash: await bcrypt.hash('demo1234', 12),
      name: 'Marcus Johnson',
      dateOfBirth: new Date('1972-08-22'),
    },
  });

  const marcusHistory = [
    { category: 'CONDITION' as HistoryCategory, name: 'Type 2 Diabetes', details: 'Diagnosed 2019, diet-controlled with metformin', startDate: new Date('2019-03-10') },
    { category: 'CONDITION' as HistoryCategory, name: 'Hypertension', details: 'Controlled with lisinopril', startDate: new Date('2018-11-01') },
    { category: 'CONDITION' as HistoryCategory, name: 'Sleep Apnea', details: 'Using CPAP machine nightly', startDate: new Date('2020-02-14') },
    { category: 'MEDICATION' as HistoryCategory, name: 'Metformin 1000mg', details: 'Twice daily with meals', startDate: new Date('2019-03-15') },
    { category: 'MEDICATION' as HistoryCategory, name: 'Lisinopril 10mg', details: 'Once daily', startDate: new Date('2018-11-15') },
    { category: 'MEDICATION' as HistoryCategory, name: 'Atorvastatin 20mg', details: 'Once daily at bedtime', startDate: new Date('2020-01-01') },
    { category: 'ALLERGY' as HistoryCategory, name: 'Sulfa antibiotics', details: 'Steven-Johnson syndrome — severe allergy' },
    { category: 'FAMILY_HISTORY' as HistoryCategory, name: 'Heart Disease', details: 'Father — myocardial infarction at age 58' },
    { category: 'FAMILY_HISTORY' as HistoryCategory, name: 'Type 2 Diabetes', details: 'Both parents and one sibling' },
  ];

  for (const entry of marcusHistory) {
    await prisma.medicalHistoryEntry.create({ data: { userId: marcus.id, ...entry, isManual: true } });
  }

  const marcusAppointments = [
    { providerName: 'Dr. Patricia Williams', specialty: 'Endocrinology', scheduledAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), reason: 'Diabetes quarterly check-in', source: 'MANUAL' as AppointmentSource },
    { providerName: 'Dr. Robert Chen', specialty: 'Cardiology', scheduledAt: new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000), reason: 'Cardiovascular risk assessment', source: 'MANUAL' as AppointmentSource },
    { providerName: 'Dr. Patricia Williams', specialty: 'Endocrinology', scheduledAt: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000), reason: 'Diabetes management', notes: 'HbA1c improving, continue current regimen', source: 'MANUAL' as AppointmentSource },
  ];

  for (const appt of marcusAppointments) {
    await prisma.appointment.create({ data: { userId: marcus.id, ...appt } });
  }

  const marcusLabs = [
    { testName: 'HbA1c', value: 7.1, unit: '%', referenceMin: 0, referenceMax: 7.0, recordedAt: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000), isFlagged: true, providerName: 'Dr. Patricia Williams' },
    { testName: 'HbA1c', value: 7.8, unit: '%', referenceMin: 0, referenceMax: 7.0, recordedAt: new Date(now.getTime() - 150 * 24 * 60 * 60 * 1000), isFlagged: true, providerName: 'Dr. Patricia Williams' },
    { testName: 'Fasting Blood Glucose', value: 126, unit: 'mg/dL', referenceMin: 70, referenceMax: 100, recordedAt: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000), isFlagged: true, providerName: 'Dr. Patricia Williams' },
    { testName: 'LDL Cholesterol', value: 98, unit: 'mg/dL', referenceMin: 0, referenceMax: 100, recordedAt: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000), isFlagged: false, providerName: 'Dr. Patricia Williams' },
    { testName: 'eGFR', value: 72, unit: 'mL/min/1.73m²', referenceMin: 60, referenceMax: 120, recordedAt: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000), isFlagged: false, providerName: 'Dr. Patricia Williams' },
  ];

  for (const lab of marcusLabs) {
    await prisma.labResult.create({ data: { userId: marcus.id, ...lab } });
  }

  const marcusVitals = [
    { type: 'BLOOD_PRESSURE' as VitalType, value: 138, value2: 88, unit: 'mmHg', recordedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000) },
    { type: 'BLOOD_PRESSURE' as VitalType, value: 142, value2: 92, unit: 'mmHg', recordedAt: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000) },
    { type: 'WEIGHT' as VitalType, value: 218, unit: 'lbs', recordedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000) },
    { type: 'WEIGHT' as VitalType, value: 224, unit: 'lbs', recordedAt: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000) },
    { type: 'BLOOD_GLUCOSE' as VitalType, value: 132, unit: 'mg/dL', recordedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), notes: 'Fasting' },
    { type: 'BLOOD_GLUCOSE' as VitalType, value: 118, unit: 'mg/dL', recordedAt: new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000), notes: 'Fasting' },
    { type: 'HEART_RATE' as VitalType, value: 78, unit: 'bpm', recordedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000) },
  ];

  for (const vital of marcusVitals) {
    await prisma.vital.create({ data: { userId: marcus.id, ...vital } });
  }

  const marcusImaging = [
    {
      studyType: 'ECHOCARDIOGRAM' as ImagingStudyType,
      bodyPart: 'Heart',
      studyDate: new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000),
      facility: 'Mercy Heart Center',
      radiologist: 'Dr. Angela Park',
      providerName: 'Dr. Robert Chen',
      summary: 'Left ventricular ejection fraction (LVEF) 58%, within normal limits. Mild concentric left ventricular hypertrophy consistent with history of hypertension. No wall motion abnormalities. Mild diastolic dysfunction Grade I. Aortic and mitral valves appear structurally normal with trace mitral regurgitation.',
    },
    {
      studyType: 'ULTRASOUND' as ImagingStudyType,
      bodyPart: 'Kidneys & Bladder',
      studyDate: new Date(now.getTime() - 62 * 24 * 60 * 60 * 1000),
      facility: 'City Diagnostic Imaging',
      radiologist: 'Dr. Samuel Torres',
      providerName: 'Dr. Patricia Williams',
      summary: 'Both kidneys are normal in size and echogenicity. No hydronephrosis, calculi, or discrete renal masses identified. Right kidney measures 10.8 cm, left kidney 11.1 cm. Bladder is well distended with smooth walls. Post-void residual volume within normal limits. Findings are reassuring in the context of monitoring for diabetic nephropathy.',
    },
    {
      studyType: 'XRAY' as ImagingStudyType,
      bodyPart: 'Chest',
      studyDate: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
      facility: 'City Diagnostic Imaging',
      radiologist: 'Dr. Samuel Torres',
      providerName: 'Dr. Robert Chen',
      summary: 'Heart size is at the upper limit of normal. Lungs are clear bilaterally with no focal consolidation, pleural effusion, or pneumothorax. Mediastinal contour is unremarkable. Osseous structures intact. Impression: Borderline cardiomegaly, correlate clinically. No acute cardiopulmonary process.',
    },
  ];

  for (const study of marcusImaging) {
    await prisma.imagingStudy.create({ data: { userId: marcus.id, ...study } });
  }

  console.log('✓ Seeded 2 demo patients with full medical data');
  console.log('  sarah@demo.fila.health / demo1234');
  console.log('  marcus@demo.fila.health / demo1234');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
