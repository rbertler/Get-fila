import { prisma } from '../utils/prisma.js';

async function main() {
  const records = await prisma.medicalRecord.findMany({
    where: { userId: 'cmpnd6q9c0002zwaicojz5yvq' },
    select: { id: true, fileName: true, recordType: true, extractedText: true }
  });
  
  for (const rec of records) {
    if (!rec.extractedText) continue;
    const lines = rec.extractedText.split('\n').map((l: string) => l.trim()).filter((l: string) => l);
    const impIdx = lines.findIndex((l: string) => /impression|findings|conclusion|result/i.test(l));
    if (impIdx >= 0) {
      console.log(`\n====== ${rec.fileName} ======`);
      console.log('FINDINGS/IMPRESSION section:');
      console.log(lines.slice(impIdx, impIdx + 20).join('\n'));
    }
  }
  
  await prisma.$disconnect();
}
main().catch(console.error);
