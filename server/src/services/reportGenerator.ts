import PDFDocument from 'pdfkit';
import { prisma } from '../utils/prisma.js';

interface ShareConfig {
  includeRecords?: string[];
  includeLabResults?: string[];
  includeVitals?: string[];
  includeHistoryEntries?: string[];
  includeInsightReportId?: string;
}

export async function generateShareReport(
  userId: string,
  config: ShareConfig
): Promise<Buffer> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const doc = new PDFDocument({ margin: 50 });
  const chunks: Buffer[] = [];

  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  await new Promise<void>((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);

    // Header
    doc
      .fontSize(24)
      .font('Helvetica-Bold')
      .text('Fila Health Summary', { align: 'center' });
    doc.moveDown(0.5);
    doc
      .fontSize(12)
      .font('Helvetica')
      .text(`Patient: ${user.name}`, { align: 'center' });
    doc
      .fontSize(10)
      .fillColor('#666666')
      .text(`Generated: ${new Date().toLocaleDateString()}`, { align: 'center' });
    doc.moveDown();
    doc
      .fontSize(9)
      .fillColor('#cc0000')
      .text(
        'IMPORTANT: This summary was generated from patient-uploaded records. It is not a medical diagnosis. Please review with your healthcare provider.',
        { align: 'center' }
      );
    doc.moveDown();
    doc.fillColor('#000000');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown();

    doc.end();
  });

  return Buffer.concat(chunks);
}
