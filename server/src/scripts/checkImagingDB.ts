import { prisma } from '../utils/prisma.js';

async function main() {
  const studies = await prisma.imagingStudy.findMany({
    where: { userId: 'cmpnd6q9c0002zwaicojz5yvq' },
    select: { id: true, studyType: true, bodyPart: true, summary: true, facility: true, notes: true }
  });
  studies.forEach(s => {
    console.log(`\n--- ${s.studyType} / ${s.bodyPart} ---`);
    console.log('Summary:', s.summary);
  });
  await prisma.$disconnect();
}
main().catch(console.error);
