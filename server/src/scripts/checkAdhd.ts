import { prisma } from '../utils/prisma.js';

async function main() {
  const record = await prisma.medicalRecord.findFirst({ 
    where: { userId: 'cmpnd6q9c0002zwaicojz5yvq', fileName: { contains: 'ADHD' } }, 
    select: { extractedText: true } 
  });
  if (record?.extractedText) {
    const lines = record.extractedText.split('\n').map((l: string) => l.trim()).filter((l: string) => l);
    const start = lines.findIndex((l: string) => /diagnos|assessment|condition/i.test(l));
    console.log("Lines around diagnosis section:");
    console.log(lines.slice(Math.max(0, start-2), start+30).join('\n'));
  }
  await prisma.$disconnect();
}
main().catch(console.error);
