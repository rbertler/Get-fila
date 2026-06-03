import { prisma } from '../utils/prisma.js';
import { normalizeLabTestName } from '../services/recordExtractor.js';

async function main() {
  const userId = 'cmpnd6q9c0002zwaicojz5yvq';

  // Delete the mangled duplicate
  const deleted = await prisma.labResult.deleteMany({
    where: { userId, testName: { contains: 'Free Testosterone (Bioavailable)7.4' } }
  });
  console.log(`Deleted ${deleted.count} duplicate lab(s)`);

  // Add mangled key to ignore list so it won't sync again
  const mangledKey = normalizeLabTestName('Free Testosterone (Bioavailable)7.4 pg/mL0.1 -');
  await prisma.syncIgnoreItem.upsert({
    where: { userId_itemType_itemKey: { userId, itemType: 'LAB', itemKey: mangledKey } },
    update: {},
    create: { userId, itemType: 'LAB', itemKey: mangledKey }
  });
  console.log(`Ignored mangled key: "${mangledKey}"`);

  const remaining = await prisma.labResult.findMany({ where: { userId }, select: { testName: true, value: true, unit: true, referenceMin: true, referenceMax: true } });
  console.log('\nRemaining labs:', remaining);
  await prisma.$disconnect();
}
main().catch(console.error);
