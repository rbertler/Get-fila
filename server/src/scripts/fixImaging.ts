import { prisma } from '../utils/prisma.js';
import { parseImagingFromText } from '../services/recordExtractor.js';

async function main() {
  const userId = 'cmpnd6q9c0002zwaicojz5yvq';
  
  // Delete false-positive CT scan (extracted from visit summary, not an actual imaging report)
  const deleted = await prisma.imagingStudy.deleteMany({
    where: { userId, studyType: 'CT_SCAN', bodyPart: 'thyroid' }
  });
  console.log(`Deleted ${deleted.count} false-positive CT scan(s)`);

  // Re-extract and update the ultrasound summary
  const ultrasoundRecord = await prisma.medicalRecord.findFirst({
    where: { userId, fileName: { contains: 'Ultrasound' } },
    select: { id: true, fileName: true, extractedText: true, createdAt: true }
  });
  
  if (ultrasoundRecord?.extractedText) {
    const extracted = parseImagingFromText(ultrasoundRecord.extractedText, ultrasoundRecord.createdAt);
    console.log('\nRe-extracted ultrasound:');
    console.log('Summary:', extracted?.summary?.slice(0, 300));
    
    if (extracted?.summary) {
      const updated = await prisma.imagingStudy.updateMany({
        where: { userId, studyType: 'ULTRASOUND' },
        data: { summary: extracted.summary }
      });
      console.log(`Updated ${updated.count} ultrasound record(s)`);
    }
  }

  // Show final state
  const studies = await prisma.imagingStudy.findMany({
    where: { userId },
    select: { studyType: true, bodyPart: true, summary: true }
  });
  console.log('\nFinal imaging studies:');
  studies.forEach(s => console.log(`  ${s.studyType} / ${s.bodyPart}: ${s.summary?.slice(0, 120)}...`));
  
  await prisma.$disconnect();
}
main().catch(console.error);
