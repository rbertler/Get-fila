import { prisma } from '../utils/prisma.js';

async function main() {
  const userId = 'cmpnd6q9c0002zwaicojz5yvq';

  // Fix the mangled "Free Testosterone (Bioavailable)7.4 pg/mL0.1 -" entry
  // Real data: name = "Free Testosterone (Bioavailable)", value = 7.4, ref = 0.1–6.4, HIGH
  await prisma.labResult.updateMany({
    where: { userId, testName: { contains: 'Free Testosterone (Bioavailable)7.4' } },
    data: {
      testName: 'Free Testosterone (Bioavailable)',
      value: 7.4,
      unit: 'pg/mL',
      referenceMin: 0.1,
      referenceMax: 6.4,
      isFlagged: true,
    }
  });
  console.log('Fixed Free Testosterone entry');

  // Show final state
  const labs = await prisma.labResult.findMany({ where: { userId } });
  labs.forEach(l => console.log(JSON.stringify(l)));
  await prisma.$disconnect();
}
main().catch(console.error);
