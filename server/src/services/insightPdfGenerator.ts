/**
 * Generates a PDF for a HealthInsightReport matching the Fila design spec.
 * Font: Inter · 1" margins · Brand colors
 */

import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { prisma } from '../utils/prisma.js';
import type { InsightItem } from './insightGenerator.js';

// ── Colors ────────────────────────────────────────────────────────────────────
const NAVY     = '#102a45';
const BODY     = '#1f2937';
const MID_GRAY = '#6b7280';
const CITE     = '#9ca3af';
const AMBER    = '#b45309';
const CONF     = '#244a73';
const DIVIDER  = '#e5e7eb';
const HDR_FOOT = '#9ca3af';

// ── Layout (1" = 72pt) ────────────────────────────────────────────────────────
const MARGIN   = 72;          // 1" all sides
const PW       = 612;
const PH       = 792;
const CW       = PW - MARGIN * 2;  // 468

// ── Font paths ────────────────────────────────────────────────────────────────
const FONTS       = path.resolve(process.cwd(), 'assets/fonts');
const FONT_REG    = path.join(FONTS, 'Inter-Regular.ttf');
const FONT_MED    = path.join(FONTS, 'Inter-Medium.ttf');
const FONT_SEMI   = path.join(FONTS, 'Inter-SemiBold.ttf');
const FONT_BOLD   = path.join(FONTS, 'Inter-Bold.ttf');
const FONT_ITALIC = path.join(FONTS, 'Inter-Italic.ttf');
const LOGO_PATH   = path.resolve(process.cwd(), '../client/public/Fila_Gradient_Transparent.png');

const hasFont = (p: string) => fs.existsSync(p);

type Doc = InstanceType<typeof PDFDocument>;

function registerFonts(doc: Doc) {
  if (hasFont(FONT_REG))    doc.registerFont('Inter',          FONT_REG);
  if (hasFont(FONT_MED))    doc.registerFont('Inter-Medium',   FONT_MED);
  if (hasFont(FONT_SEMI))   doc.registerFont('Inter-SemiBold', FONT_SEMI);
  if (hasFont(FONT_BOLD))   doc.registerFont('Inter-Bold',     FONT_BOLD);
  if (hasFont(FONT_ITALIC)) doc.registerFont('Inter-Italic',   FONT_ITALIC);
}

function reg(doc: Doc)    { doc.font(hasFont(FONT_REG)    ? 'Inter'          : 'Helvetica'); }
function med(doc: Doc)    { doc.font(hasFont(FONT_MED)    ? 'Inter-Medium'   : 'Helvetica'); }
function semi(doc: Doc)   { doc.font(hasFont(FONT_SEMI)   ? 'Inter-SemiBold' : 'Helvetica-Bold'); }
function bold(doc: Doc)   { doc.font(hasFont(FONT_BOLD)   ? 'Inter-Bold'     : 'Helvetica-Bold'); }
function italic(doc: Doc) { doc.font(hasFont(FONT_ITALIC) ? 'Inter-Italic'   : 'Helvetica-Oblique'); }

function sectionHeading(doc: Doc, title: string) {
  doc.moveDown(0.9);
  bold(doc);
  doc.fontSize(17).fillColor(NAVY).text(title, MARGIN, doc.y, { width: CW });
  doc.moveDown(0.55);
}

function subLabel(doc: Doc, label: string) {
  med(doc);
  doc.fontSize(8.5).fillColor(MID_GRAY).text(label, MARGIN, doc.y, { width: CW });
  doc.moveDown(0.35);
}

function bulletItem(doc: Doc, text: string) {
  reg(doc);
  doc.fontSize(9.5).fillColor(BODY)
    .text('•  ' + text, MARGIN, doc.y, { width: CW, lineGap: 3 });
}

function evidenceBullet(doc: Doc, text: string, source: string, date: string) {
  reg(doc);
  doc.fontSize(9.5).fillColor(BODY)
    .text('•  ' + text + ' ', MARGIN, doc.y, { width: CW, continued: true, lineGap: 3 });
  doc.fillColor(CITE).text('— ' + source + ', ' + date, { continued: false });
  doc.fillColor(BODY);
}

/** Write text outside the content margins (header/footer) without triggering overflow. */
function writeAbsolute(doc: Doc, text: string, x: number, y: number, opts: object) {
  const saved = { top: doc.page.margins.top, bottom: doc.page.margins.bottom };
  doc.page.margins.top    = 0;
  doc.page.margins.bottom = 0;
  doc.fontSize(8).fillColor(HDR_FOOT).text(text, x, y, opts);
  doc.page.margins.top    = saved.top;
  doc.page.margins.bottom = saved.bottom;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateInsightPdf(reportId: string): Promise<Buffer> {
  const report = await prisma.healthInsightReport.findUniqueOrThrow({
    where: { id: reportId },
    include: { user: { select: { name: true } } },
  });

  const insights   = report.insights as unknown as InsightItem[];
  const gaps       = report.gaps    as unknown as string[];
  const userName   = report.user.name ?? 'Patient';
  const reportDate = new Date(report.generatedAt).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true,
    autoFirstPage: false,
  });

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  let pageCount = 0;
  doc.on('pageAdded', () => { pageCount++; });

  await new Promise<void>((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);

    registerFonts(doc);

    // ── Page 1 ────────────────────────────────────────────────────────────────
    doc.addPage();

    // Logo — tight to top
    if (fs.existsSync(LOGO_PATH)) {
      const logoW = 90;
      doc.image(LOGO_PATH, (PW - logoW) / 2, 30, { width: logoW });
    }

    // Title — snug below logo (logo bottom ≈ 75)
    bold(doc);
    doc.fontSize(22).fillColor(NAVY)
      .text('Health Intelligence Report', MARGIN, 84, { width: CW, align: 'center' });

    // Set cursor just below title
    doc.y = 118;

    // NOTICE — close beneath title
    bold(doc);
    doc.fontSize(9).fillColor(AMBER)
      .text('NOTICE:  ', MARGIN, doc.y, { width: CW, continued: true });
    reg(doc);
    doc.fontSize(9).fillColor(AMBER)
      .text(
        'This report identifies patterns in health data to support informed conversations ' +
        'with a healthcare provider. It is not a medical diagnosis. ' +
        'Always discuss findings with a qualified healthcare professional.',
        { continued: false, lineGap: 2 }
      );
    doc.fillColor(BODY);
    doc.moveDown(0.7);

    // ── Summary ───────────────────────────────────────────────────────────────
    sectionHeading(doc, 'Summary');
    reg(doc);
    doc.fontSize(10.5).fillColor(BODY)
      .text(report.summary, MARGIN, doc.y, { width: CW, lineGap: 4 });

    // ── Patterns Identified ───────────────────────────────────────────────────
    if (insights.length > 0) {
      sectionHeading(doc, 'Patterns Identified');

      for (let i = 0; i < insights.length; i++) {
        const ins = insights[i];

        if (i > 0) {
          doc.moveDown(0.6);
          doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CW, doc.y)
            .strokeColor(DIVIDER).lineWidth(0.5).stroke();
          doc.lineWidth(1);
          doc.moveDown(0.6);
        }

        semi(doc);
        doc.fontSize(12.5).fillColor(NAVY)
          .text(ins.title, MARGIN, doc.y, { width: CW });
        doc.moveDown(0.3);

        const confColor = ins.confidence === 'high' ? '#9b2c2c' : ins.confidence === 'moderate' ? '#9c4221' : '#276749';
        italic(doc);
        doc.fontSize(9).fillColor(confColor)
          .text('Confidence: ' + (
            ins.confidence === 'high'     ? 'Strong pattern'   :
            ins.confidence === 'moderate' ? 'Possible pattern' : 'Weak signal'
          ), MARGIN, doc.y, { width: CW });
        doc.fillColor(BODY);
        doc.moveDown(0.6);

        const description = (ins as any).description as string | undefined;
        if (description) {
          reg(doc);
          doc.fontSize(10.5).fillColor(BODY)
            .text(description, MARGIN, doc.y, { width: CW, lineGap: 3 });
          doc.moveDown(0.55);
        }

        if (ins.relatedConditions?.length > 0) {
          subLabel(doc, 'Related Conditions');
          reg(doc);
          doc.fontSize(9.5).fillColor(BODY)
            .text(ins.relatedConditions.join('  ·  '), MARGIN, doc.y, { width: CW });
          doc.moveDown(0.55);
        }

        if (ins.supportingEvidence?.length > 0) {
          subLabel(doc, 'Supporting Evidence');
          for (let j = 0; j < ins.supportingEvidence.length; j++) {
            const ev = ins.supportingEvidence[j];
            evidenceBullet(doc, ev.text, ev.source, ev.date);
            doc.moveDown(0.3);
          }
          doc.moveDown(0.1);
        }
      }
    }

    // ── Information Gaps ──────────────────────────────────────────────────────
    if (gaps.length > 0) {
      sectionHeading(doc, 'Information Gaps');
      for (let i = 0; i < gaps.length; i++) {
        bulletItem(doc, gaps[i]);
        doc.moveDown(0.35);
      }
    }

    // ── Talking Points ────────────────────────────────────────────────────────
    if (insights.length > 0) {
      sectionHeading(doc, 'Talking Points For Your Provider');
      for (let i = 0; i < insights.length; i++) {
        bulletItem(doc, insights[i].suggestedDiscussion);
        doc.moveDown(0.35);
      }
    }

    // ── Headers + Footers ─────────────────────────────────────────────────────
    // writeAbsolute temporarily zeros margins so explicit y never triggers overflow
    const range = doc.bufferedPageRange();
    for (let p = 0; p < range.count; p++) {
      doc.switchToPage(p);
      reg(doc);

      if (p > 0) {
        writeAbsolute(doc,
          userName + '  ·  ' + reportDate,
          MARGIN, 24,
          { width: CW, align: 'right' }
        );
      }

      writeAbsolute(doc,
        'Generated by Fila Health  ·  Not a medical document  |  ' + (p + 1),
        MARGIN, PH - 46,
        { width: CW, align: 'right' }
      );
    }

    doc.flushPages();
    doc.end();
  });

  return Buffer.concat(chunks);
}
