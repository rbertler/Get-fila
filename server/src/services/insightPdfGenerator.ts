/**
 * Generates a PDF document for a HealthInsightReport.
 * Used for download, share, and save-to-records flows.
 */

import PDFDocument from 'pdfkit';
import { prisma } from '../utils/prisma.js';
import type { InsightItem } from './insightGenerator.js';

const DARK  = '#2b4257';
const BLUE  = '#6da7cc';
const MID   = '#c8ddf0';
const GRAY  = '#666666';
const LIGHT = '#333333';

function sectionHeader(doc: InstanceType<typeof PDFDocument>, title: string) {
  doc.moveDown(0.8);
  doc.fontSize(12).font('Helvetica-Bold').fillColor(DARK).text(title.toUpperCase(), { characterSpacing: 0.8 });
  doc.moveDown(0.15);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(BLUE).lineWidth(1).stroke();
  doc.moveDown(0.5);
  doc.lineWidth(1); // reset
}

export async function generateInsightPdf(reportId: string): Promise<Buffer> {
  const report = await prisma.healthInsightReport.findUniqueOrThrow({
    where: { id: reportId },
    include: { user: { select: { name: true } } },
  });

  const insights = report.insights as unknown as InsightItem[];
  const gaps     = report.gaps as unknown as string[];

  const doc    = new PDFDocument({ margin: 50, size: 'LETTER' });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  await new Promise<void>((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);

    // ── Header ─────────────────────────────────────────────────────────────────
    doc.fontSize(22).font('Helvetica-Bold').fillColor(DARK).text('Health Intelligence Report', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica').fillColor(GRAY).text(`Patient: ${report.user.name}`, { align: 'center' });
    doc.fontSize(10).fillColor(GRAY).text(
      `Generated: ${new Date(report.generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
      { align: 'center' }
    );
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(DARK).lineWidth(1.5).stroke();
    doc.lineWidth(1);
    doc.moveDown(0.4);

    // Disclaimer
    doc.fontSize(9).font('Helvetica-Oblique').fillColor('#9b5500').text(
      'NOTICE: This report identifies patterns in health data to support informed conversations with a healthcare provider. ' +
      'It is not a medical diagnosis. Always consult a qualified clinician.',
      { align: 'center' }
    );
    doc.moveDown(0.4);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#dddddd').lineWidth(0.5).stroke();
    doc.lineWidth(1);

    // ── Summary ────────────────────────────────────────────────────────────────
    sectionHeader(doc, 'Summary');
    doc.fontSize(10).font('Helvetica').fillColor(LIGHT).text(report.summary, { lineGap: 3 });

    // ── Patterns ───────────────────────────────────────────────────────────────
    if (insights.length > 0) {
      sectionHeader(doc, 'Patterns Identified');

      for (let i = 0; i < insights.length; i++) {
        const ins = insights[i];

        if (i > 0) {
          doc.moveDown(0.4);
          doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
          doc.lineWidth(1);
          doc.moveDown(0.4);
        }

        // Title + confidence
        doc.fontSize(11).font('Helvetica-Bold').fillColor(DARK).text(ins.title);
        doc.moveDown(0.15);

        const confLabel =
          ins.confidence === 'high'     ? 'Strong pattern'   :
          ins.confidence === 'moderate' ? 'Possible pattern' : 'Weak signal';
        doc.fontSize(9).font('Helvetica-Oblique').fillColor(BLUE).text(`Confidence: ${confLabel}`);
        doc.moveDown(0.3);

        // Related conditions
        if (ins.relatedConditions?.length > 0) {
          doc.fontSize(8).font('Helvetica-Bold').fillColor(GRAY).text('RELATED CONDITIONS');
          doc.moveDown(0.1);
          doc.fontSize(9).font('Helvetica').fillColor(LIGHT)
            .text(ins.relatedConditions.join('  ·  '), { indent: 8 });
          doc.moveDown(0.3);
        }

        // Supporting evidence
        if (ins.supportingEvidence?.length > 0) {
          doc.fontSize(8).font('Helvetica-Bold').fillColor(GRAY).text('SUPPORTING EVIDENCE');
          doc.moveDown(0.1);
          for (const ev of ins.supportingEvidence) {
            doc.fontSize(9).font('Helvetica').fillColor(LIGHT)
              .text(`• ${ev.text}`, { indent: 8, continued: true })
              .fillColor(GRAY).text(`  — ${ev.source}, ${ev.date}`, { continued: false });
            doc.moveDown(0.15);
          }
          doc.moveDown(0.1);
        }
      }
    }

    // ── Information Gaps ───────────────────────────────────────────────────────
    if (gaps.length > 0) {
      sectionHeader(doc, 'Information Gaps');
      for (const gap of gaps) {
        doc.fontSize(9).font('Helvetica').fillColor(LIGHT).text(`• ${gap}`, { indent: 8, lineGap: 2 });
        doc.moveDown(0.15);
      }
    }

    // ── Talking Points ─────────────────────────────────────────────────────────
    if (insights.length > 0) {
      sectionHeader(doc, 'Talking Points for Your Provider');
      for (const ins of insights) {
        doc.fontSize(9).font('Helvetica').fillColor(LIGHT)
          .text(`• ${ins.suggestedDiscussion}`, { indent: 8, lineGap: 2 });
        doc.moveDown(0.2);
      }
    }

    // ── Footer ─────────────────────────────────────────────────────────────────
    const footerY = doc.page.height - 40;
    doc.fontSize(8).font('Helvetica').fillColor('#aaaaaa')
      .text('Generated by Fila Health · Not a medical document', 50, footerY, { align: 'center', width: 495 });

    doc.end();
  });

  return Buffer.concat(chunks);
}
