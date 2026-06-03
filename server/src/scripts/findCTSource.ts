import { prisma } from '../utils/prisma.js';
import { parseImagingFromText } from '../services/recordExtractor.js';

async function main() {
  const records = await prisma.medicalRecord.findMany({
    where: { userId: 'cmpnd6q9c0002zwaicojz5yvq' },
    select: { id: true, fileName: true, extractedText: true }
  });
  
  for (const rec of records) {
    if (!rec.extractedText) continue;
    const result = parseImagingFromText(rec.extractedText);
    if (result) {
      console.log(`\n${rec.fileName} → ${result.studyType} / ${result.bodyPart}`);
      console.log('Summary:', result.summary?.slice(0, 150));
    }
  }
  await prisma.$disconnect();
}
main().catch(console.error);
