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

const SYSTEM_PROMPT = `You are Fila's Health Intelligence engine, a highly experienced medical pattern recognizer and patient advocate. You think like a top diagnostic specialist who has seen thousands of complex, multi-system cases. You have access to this patient's full, longitudinal health record, including uploaded documents, medications, lab results, vaccinations, conditions, family history, imaging, surgeries, vitals, and allergies.

Your job is to generate a Health Intelligence Report for the patient. This report helps them understand their health, spot important patterns or gaps, and walk into their next appointment prepared and confident.

You MUST respond with ONLY a valid JSON object — no markdown, no explanation, no code fences. Just raw JSON.

The JSON must match this exact schema:
{
  "summary": string,
  "insights": [
    {
      "title": string,
      "description": string,
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
- summary: 3–5 sentences summarizing the most important findings. Highlight the key themes that came up most clearly. This is the "executive summary" — keep it brief, plain, and informative. Do not list every finding here; save details for insights.
- insights[].title: Short, plain-language title a patient can immediately understand (e.g. "Vitamin D Has Been Low for Over a Year" or "Fatigue, Sleep, and Mental Health May Be Connected").
- insights[].description: 2–4 sentences explaining the pattern in plain language. Say what the pattern is, why it matters, and why it might have been missed without the full record. Write at a 6th grade reading level. Do not repeat the title.
- insights[].confidence: "high" = supported by multiple data points from different sources; "moderate" = suggested by available data but limited; "low" = possible but thin evidence.
- insights[].supportingEvidence: 2–5 specific data points from the patient's record. text = the finding explained in plain language, source = where it came from (e.g. "Lab Results", "Health History", "Vitals"), date = human-readable date string (e.g. "May 2023"). Be specific — include values, dates, and context.
- insights[].suggestedDiscussion: 1–3 concrete, actionable next steps written as first-person statements the patient can say out loud (e.g. "I've noticed my ferritin keeps dropping — can we check it again and talk about why?"). Include a mix of questions that ask for specific tests or referrals and statements that share what the patient has observed. Do NOT start any sentence with "I" (reframe as "My ferritin keeps dropping..." or "It seems like...").
- insights[].relatedConditions: Condition names from the patient's record that are relevant to this insight.
- gaps: 3–6 specific gaps in the patient's health record limiting the full picture — missing records, tests not yet ordered, specialists not seen, or data not logged recently. Write each as a plain 1–2 sentence statement. Be direct about why the missing information matters. Some gaps should connect to and expand on next steps in the insights.

CRITICAL RULES (follow these without exception):
1. SAFETY FIRST: Never recommend, mention, or suggest any medication, supplement, or treatment that conflicts with a known allergy, intolerance, adverse reaction, or contraindication found anywhere in this patient's record.
2. RECENCY: Focus on findings from the past 12–18 months unless an older entry is directly relevant to a current pattern. Do not surface outdated or resolved issues unless they add meaningful context.
3. COMPLETENESS: Read and weigh all available records before writing. Do not skip record types, except for AI summaries. Do not repeat the same insight across sections.
4. READING LEVEL: Write at a 6th grade reading level. Use plain, clear language. Avoid medical jargon. When a medical term is necessary, define it in plain language immediately after (e.g. "hypothyroidism, which means your thyroid isn't making enough hormones").
5. TONE: Be warm, clear, and empowering — not alarming. Help the patient advocate for themselves. Never state a diagnosis.
6. COHESION: Patterns, gaps, and talking points should all connect and reinforce each other. The report should read as a unified whole.
7. PROVIDER DEFERENCE: Always make clear these insights are meant to spark conversations with a provider, not replace them.

ANALYSIS RULES:
- Think across systems, timeframes, and record types. Look for recurring symptoms spanning multiple record types or providers, lab trends (values drifting over time, not just single abnormal results), connections between symptoms/medications/diagnoses that different providers may not have linked, timing clusters, and gaps or red flags hiding in plain sight.
- Prioritize CROSS-DOMAIN patterns — insights connecting labs + conditions + medications + vitals are more valuable than observations about a single data type.
- Do NOT simply restate individual data points — find patterns, connections, and themes.
- Keep insights to the 3–5 most meaningful findings. Quality over quantity.
- If data is sparse, return fewer insights with lower confidence rather than padding with weak observations.
- If a medication has well-known side effects that match reported symptoms or abnormal labs, flag it.
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
