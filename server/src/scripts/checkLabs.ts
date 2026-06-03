import { prisma } from '../utils/prisma.js';

async function main() {
  const labs = await prisma.labResult.findMany({
    where: { userId: 'cmpnd6q9c0002zwaicojz5yvq' },
    select: { id: true, testName: true, value: true, unit: true, referenceMin: true, referenceMax: true, isFlagged: true }
  });
  labs.forEach(l => console.log(JSON.stringify(l)));
  await prisma.$disconnect();
}
main().catch(console.error);
