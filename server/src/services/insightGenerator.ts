/**
 * AI-powered health insight generation using Claude.
 * Aggregates all user health data and surfaces cross-domain patterns,
 * trends, and information gaps worth discussing with a provider.
 */

import Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import { format } from 'date-fns';
import { prisma } from '../utils/prisma.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SupportingEvidence {
  text: string;
  source: string;
  date: string;
}

export interface InsightItem {
  title: string;
  confidence: 'low' | 'moderate' | 'high';
  supportingEvidence: SupportingEvidence[];
  suggestedDiscussion: string;
  relatedConditions: string[];
}

interface GeneratedReport {
  summary: string;
  insights: InsightItem[];
  gaps: string[];
}

export interface FocusedScope {
  entryIds: string[];      // MedicalHistoryEntry IDs
  labTestNames: string[];  // Lab test names (all readings for each test are included)
  imagingIds: string[];    // ImagingStudy IDs
}

// ── Client ────────────────────────────────────────────────────────────────────

function getClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not configured');
  return new Anthropic({ apiKey: key });
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a friendly health guide helping a patient understand patterns in their own health records. Your job is to find meaningful connections across their health history, test results, medications, vitals, and imaging — and point out things worth talking about with their doctor.

You MUST respond with ONLY a valid JSON object — no markdown, no explanation, no code fences. Just raw JSON.

The JSON must match this exact schema:
{
  "summary": string,
  "insights": [
    {
      "title": string,
      "confidence": "low" | "moderate" | "high",
      "supportingEvidence": [
        {
          "text": string,
          "source": string,
          "date": string
        }
      ],
      "suggestedDiscussion": string,
      "relatedConditions": string[]
    }
  ],
  "gaps": string[]
}

FIELD DEFINITIONS:
- summary: 2–3 sentences giving a simple overview of the overall health picture and the most important patterns found.
- insights[].title: Short, clear title written in plain language (e.g. "Blood Sugar Has Been Trending Up" or "Cholesterol and Heart Disease Risk").
- insights[].confidence: "high" = supported by multiple data points from different sources; "moderate" = suggested by available data but limited; "low" = possible but thin evidence.
- insights[].supportingEvidence: Specific data points. text = the finding explained simply, source = where it came from (e.g. "Lab Results", "Health History", "Vitals"), date = human-readable date string (e.g. "May 2023").
- insights[].suggestedDiscussion: One clear, specific question to ask a doctor — written the way a patient would actually say it, not in medical language.
- insights[].relatedConditions: Condition names from the patient's record that are relevant to this insight.
- gaps: Specific missing information that would help give a more complete picture, explained in plain terms.

WRITING RULES (most important):
- Write at a 6th grade reading level. Use short sentences and everyday words.
- Avoid medical jargon. When a medical term is necessary, explain it simply in plain language right after (e.g. "HbA1c — a measure of average blood sugar over 3 months").
- Use plain language: say "blood sugar" not "glycemia", "heart" not "cardiac", "kidneys" not "renal", "swelling" not "edema", "stomach" not "gastrointestinal tract", etc.
- Write as if explaining to a friend, not writing a clinical report.
- Titles should be short and clear — something a patient could read and immediately understand.
- suggestedDiscussion should sound like something a real patient would say to their doctor. Start with phrases like "Ask your doctor...", "It might be worth asking...", or "Talk to your doctor about...".

ANALYSIS RULES:
- Prioritise CROSS-DOMAIN patterns — insights connecting labs + conditions + medications + vitals are more valuable than observations about a single data type.
- Trends matter: if a value has changed over time, note the direction in plain terms (e.g. "gone up over the past year").
- Flagged labs should be explained in context of conditions and medications.
- Do NOT simply restate individual data points — find patterns, connections, and themes.
- Frame everything as "worth discussing" or "worth keeping an eye on" — never as a diagnosis.
- Keep insights to the 3–6 most meaningful findings. Quality over quantity.
- If data is sparse, return fewer insights with lower confidence rather than padding with weak observations.
- If a medication has well-known side effects that match reported symptoms or abnormal labs, flag it in plain terms.
- Family history risk factors should be compared against current labs/vitals when relevant.
- PREVIOUS REPORTS: If the user message includes a "Previously identified patterns" section, do NOT repeat those insights unless new data meaningfully changes the picture. Focus on what is NEW or UPDATED since the last analysis.`;

// ── Data aggregation ──────────────────────────────────────────────────────────

async function buildHealthSummary(userId: string): Promise<string> {
  const [entries, labs, vitals, imaging, appointments] = await Promise.all([
    prisma.medicalHistoryEntry.findMany({
      where: { userId },
      orderBy: { startDate: 'desc' },
    }),
    prisma.labResult.findMany({
      where: { userId },
      orderBy: { recordedAt: 'desc' },
    }),
    prisma.vital.findMany({
      where: { userId },
      orderBy: { recordedAt: 'desc' },
    }),
    prisma.imagingStudy.findMany({
      where: { userId },
      orderBy: { studyDate: 'desc' },
    }),
    prisma.appointment.findMany({
      where: { userId },
      orderBy: { scheduledAt: 'desc' },
      take: 20,
    }),
  ]);

  if (
    entries.length === 0 &&
    labs.length === 0 &&
    vitals.length === 0 &&
    imaging.length === 0
  ) {
    throw new Error('Insufficient health data to generate insights. Please add records, lab results, or health history first.');
  }

  const sections: string[] = [];

  // ── Health History ──────────────────────────────────────────────────────────
  if (entries.length > 0) {
    const byCategory: Record<string, typeof entries> = {};
    for (const e of entries) {
      (byCategory[e.category] ??= []).push(e);
    }

    const lines: string[] = ['## Health History'];
    for (const [category, items] of Object.entries(byCategory)) {
      lines.push(`\n### ${category}`);
      for (const e of items) {
        const start = e.startDate ? ` (from ${format(new Date(e.startDate), 'MMM yyyy')})` : '';
        const end = e.endDate ? ` to ${format(new Date(e.endDate), 'MMM yyyy')}` : '';
        const details = e.details ? `: ${e.details}` : '';
        lines.push(`- ${e.name}${details}${start}${end}`);
      }
    }
    sections.push(lines.join('\n'));
  }

  // ── Lab Results (grouped by test, showing trends) ──────────────────────────
  if (labs.length > 0) {
    const byTest: Record<string, typeof labs> = {};
    for (const l of labs) {
      (byTest[l.testName] ??= []).push(l);
    }

    const lines: string[] = ['## Lab Results'];
    for (const [testName, results] of Object.entries(byTest)) {
      const sorted = [...results].sort(
        (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
      );
      const latest = sorted[0];
      const ref =
        latest.referenceMin != null && latest.referenceMax != null
          ? ` (ref: ${latest.referenceMin}–${latest.referenceMax} ${latest.unit})`
          : '';
      const flag = latest.isFlagged ? ' ⚑ FLAGGED' : '';

      if (sorted.length === 1) {
        lines.push(
          `- ${testName}: ${latest.value} ${latest.unit}${ref}${flag} — ${format(new Date(latest.recordedAt), 'MMM yyyy')}`,
        );
      } else {
        const trend = sorted
          .map((r) => `${r.value} ${r.unit} (${format(new Date(r.recordedAt), 'MMM yyyy')})`)
          .reverse()
          .join(' → ');
        lines.push(`- ${testName}${ref}${flag} | Trend: ${trend}`);
      }
    }
    sections.push(lines.join('\n'));
  }

  // ── Vitals (with trends) ───────────────────────────────────────────────────
  if (vitals.length > 0) {
    const byType: Record<string, typeof vitals> = {};
    for (const v of vitals) {
      (byType[v.type] ??= []).push(v);
    }

    const lines: string[] = ['## Vitals'];
    for (const [type, readings] of Object.entries(byType)) {
      const sorted = [...readings].sort(
        (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
      );

      if (sorted.length === 1) {
        const v = sorted[0];
        const val = v.value2 != null ? `${v.value}/${v.value2}` : String(v.value);
        lines.push(`- ${type}: ${val} ${v.unit} — ${format(new Date(v.recordedAt), 'MMM yyyy')}`);
      } else {
        const trend = sorted
          .map((v) => {
            const val = v.value2 != null ? `${v.value}/${v.value2}` : String(v.value);
            return `${val} ${v.unit} (${format(new Date(v.recordedAt), 'MMM yyyy')})`;
          })
          .reverse()
          .join(' → ');
        lines.push(`- ${type} trend: ${trend}`);
      }
    }
    sections.push(lines.join('\n'));
  }

  // ── Imaging ────────────────────────────────────────────────────────────────
  if (imaging.length > 0) {
    const lines: string[] = ['## Imaging Studies'];
    for (const study of imaging) {
      const date = format(new Date(study.studyDate), 'MMM yyyy');
      const title = study.description ?? `${study.studyType} – ${study.bodyPart}`;
      const summary = study.summary ? `: ${study.summary}` : '';
      lines.push(`- ${title} (${date})${summary}`);
    }
    sections.push(lines.join('\n'));
  }

  // ── Appointments ───────────────────────────────────────────────────────────
  if (appointments.length > 0) {
    const lines: string[] = ['## Recent Appointments'];
    for (const appt of appointments) {
      const date = format(new Date(appt.scheduledAt), 'MMM d, yyyy');
      const specialty = appt.specialty ? ` (${appt.specialty})` : '';
      const reason = appt.reason ? ` — Reason: ${appt.reason}` : '';
      lines.push(`- ${appt.providerName}${specialty} on ${date}${reason}`);
    }
    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}

// ── Focused summary builder ───────────────────────────────────────────────────

async function buildFocusedSummary(userId: string, scope: FocusedScope): Promise<{ summary: string; scopeLabel: string }> {
  const [entries, imaging] = await Promise.all([
    scope.entryIds.length > 0
      ? prisma.medicalHistoryEntry.findMany({ where: { userId, id: { in: scope.entryIds } } })
      : Promise.resolve([] as Awaited<ReturnType<typeof prisma.medicalHistoryEntry.findMany>>),
    scope.imagingIds.length > 0
      ? prisma.imagingStudy.findMany({ where: { userId, id: { in: scope.imagingIds } } })
      : Promise.resolve([] as Awaited<ReturnType<typeof prisma.imagingStudy.findMany>>),
  ]);

  const labs = scope.labTestNames.length > 0
    ? await prisma.labResult.findMany({
        where: { userId, testName: { in: scope.labTestNames } },
        orderBy: { recordedAt: 'desc' },
      })
    : [];

  const totalSelected = entries.length + scope.labTestNames.length + imaging.length;
  if (totalSelected === 0) {
    throw new Error('No items selected for focused analysis.');
  }

  const sections: string[] = [];

  if (entries.length > 0) {
    const byCategory: Record<string, typeof entries> = {};
    for (const e of entries) (byCategory[e.category] ??= []).push(e);
    const lines: string[] = ['## Selected Health History'];
    for (const [category, items] of Object.entries(byCategory)) {
      lines.push(`\n### ${category}`);
      for (const e of items) {
        const start = e.startDate ? ` (from ${format(new Date(e.startDate), 'MMM yyyy')})` : '';
        const end = e.endDate ? ` to ${format(new Date(e.endDate), 'MMM yyyy')}` : '';
        const details = e.details ? `: ${e.details}` : '';
        lines.push(`- ${e.name}${details}${start}${end}`);
      }
    }
    sections.push(lines.join('\n'));
  }

  if (labs.length > 0) {
    const byTest: Record<string, typeof labs> = {};
    for (const l of labs) (byTest[l.testName] ??= []).push(l);
    const lines: string[] = ['## Selected Lab Results'];
    for (const [testName, results] of Object.entries(byTest)) {
      const sorted = [...results].sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());
      const latest = sorted[0];
      const ref = latest.referenceMin != null && latest.referenceMax != null
        ? ` (ref: ${latest.referenceMin}–${latest.referenceMax} ${latest.unit})` : '';
      const flag = latest.isFlagged ? ' ⚑ FLAGGED' : '';
      if (sorted.length === 1) {
        lines.push(`- ${testName}: ${latest.value} ${latest.unit}${ref}${flag} — ${format(new Date(latest.recordedAt), 'MMM yyyy')}`);
      } else {
        const trend = sorted.map((r) => `${r.value} ${r.unit} (${format(new Date(r.recordedAt), 'MMM yyyy')})`).reverse().join(' → ');
        lines.push(`- ${testName}${ref}${flag} | Trend: ${trend}`);
      }
    }
    sections.push(lines.join('\n'));
  }

  if (imaging.length > 0) {
    const lines: string[] = ['## Selected Imaging Studies'];
    for (const study of imaging) {
      const date = format(new Date(study.studyDate), 'MMM yyyy');
      const title = study.description ?? `${study.studyType} – ${study.bodyPart}`;
      const summary = study.summary ? `: ${study.summary}` : '';
      lines.push(`- ${title} (${date})${summary}`);
    }
    sections.push(lines.join('\n'));
  }

  // Build a human-readable scope label
  const parts: string[] = [];
  if (entries.length > 0) parts.push(`${entries.length} history entr${entries.length === 1 ? 'y' : 'ies'}`);
  if (scope.labTestNames.length > 0) parts.push(`${scope.labTestNames.length} lab test${scope.labTestNames.length === 1 ? '' : 's'}`);
  if (imaging.length > 0) parts.push(`${imaging.length} imaging stud${imaging.length === 1 ? 'y' : 'ies'}`);

  return {
    summary: sections.join('\n\n'),
    scopeLabel: parts.join(', '),
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generates a HealthInsightReport for the given user.
 * Pass a FocusedScope to limit analysis to specific items (skips new-data check).
 * Returns the ID of the newly created report.
 */
export async function generateInsights(userId: string, scope?: FocusedScope): Promise<string> {
  const client = getClient();
  const isFocused = !!scope;

  // ── For general analysis: check for new data since the last report ──────────
  if (!isFocused) {
    const lastReport = await prisma.healthInsightReport.findFirst({
      where: { userId, reportType: 'general' },
      orderBy: { generatedAt: 'desc' },
    });

    if (lastReport) {
      const since = lastReport.generatedAt;
      const [newEntries, newLabs, newVitals, newImaging, newRecords] = await Promise.all([
        prisma.medicalHistoryEntry.count({ where: { userId, createdAt: { gt: since } } }),
        prisma.labResult.count({ where: { userId, createdAt: { gt: since } } }),
        prisma.vital.count({ where: { userId, createdAt: { gt: since } } }),
        prisma.imagingStudy.count({ where: { userId, createdAt: { gt: since } } }),
        prisma.medicalRecord.count({ where: { userId, createdAt: { gt: since } } }),
      ]);

      const totalNew = newEntries + newLabs + newVitals + newImaging + newRecords;
      if (totalNew === 0) {
        throw new Error('No new health data since your last report. Add records or health data before generating a new analysis.');
      }
    }
  }

  // ── Build health summary ────────────────────────────────────────────────────
  let healthSummary: string;
  let scopeLabel: string | undefined;

  if (isFocused) {
    const focused = await buildFocusedSummary(userId, scope!);
    healthSummary = focused.summary;
    scopeLabel = focused.scopeLabel;
  } else {
    healthSummary = await buildHealthSummary(userId);
  }

  // ── For general reports: include previous insights to avoid repetition ───────
  let previousContext = '';
  if (!isFocused) {
    const lastGeneralReport = await prisma.healthInsightReport.findFirst({
      where: { userId, reportType: 'general' },
      orderBy: { generatedAt: 'desc' },
    });
    if (lastGeneralReport) {
      const prevInsights = lastGeneralReport.insights as unknown as InsightItem[];
      if (prevInsights.length > 0) {
        const titles = prevInsights.map((ins, i) => `${i + 1}. ${ins.title}`).join('\n');
        previousContext = `\n\n---\nPreviously identified patterns (do not repeat unless new data adds a meaningful update):\n${titles}`;
      }
    }
  }

  const userMessage = isFocused
    ? `Please analyse the following selected health data and generate focused insights:\n\n${healthSummary}`
    : `Please analyse this patient's health record and generate insights:\n\n${healthSummary}${previousContext}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Claude');
  }

  const raw = content.text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');

  let parsed: GeneratedReport;
  try {
    parsed = JSON.parse(raw) as GeneratedReport;
  } catch {
    throw new Error('Claude returned invalid JSON — could not parse insight report');
  }

  // Validate required fields
  if (!parsed.summary || !Array.isArray(parsed.insights) || !Array.isArray(parsed.gaps)) {
    throw new Error('Claude response missing required fields (summary, insights, gaps)');
  }

  // Sanitise confidence values
  const validConfidence = new Set(['low', 'moderate', 'high']);
  const sanitisedInsights: InsightItem[] = parsed.insights.map((ins) => ({
    title: String(ins.title ?? '').trim(),
    confidence: validConfidence.has(ins.confidence) ? ins.confidence : 'low',
    supportingEvidence: (ins.supportingEvidence ?? []).map((ev) => ({
      text: String(ev.text ?? '').trim(),
      source: String(ev.source ?? '').trim(),
      date: String(ev.date ?? '').trim(),
    })),
    suggestedDiscussion: String(ins.suggestedDiscussion ?? '').trim(),
    relatedConditions: (ins.relatedConditions ?? []).map((c) => String(c).trim()),
  }));

  const report = await prisma.healthInsightReport.create({
    data: {
      userId,
      summary: String(parsed.summary).trim(),
      insights: sanitisedInsights as unknown as Prisma.InputJsonValue,
      gaps: parsed.gaps.map((g) => String(g).trim()) as unknown as Prisma.InputJsonValue,
      reportType: isFocused ? 'focused' : 'general',
      scopeLabel: scopeLabel ?? null,
    },
  });

  console.log(`[insightGenerator] Report created id=${report.id} insights=${sanitisedInsights.length} gaps=${parsed.gaps.length}`);
  return report.id;
}
