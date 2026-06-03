import { prisma } from '../utils/prisma.js';

async function main() {
  const rec = await prisma.medicalRecord.findFirst({
    where: { userId: 'cmpnd6q9c0002zwaicojz5yvq', fileName: { contains: 'Williams' } },
    select: { extractedText: true }
  });
  if (!rec?.extractedText) return;
  const lines = rec.extractedText.split('\n').map((l: string) => l.trim()).filter((l: string) => l);
  // Find lines with provider/doctor/physician/attending/signed
  lines.forEach((l: string, i: number) => {
    if (/dr\.|physician|provider|attending|signed|author|clinician|practitioner|M\.?D\.|D\.?O\./i.test(l)) {
      console.log(`Line ${i}: ${l}`);
    }
  });
  await prisma.$disconnect();
}
main().catch(console.error);
