import { prisma } from '../utils/prisma.js';

async function main() {
  const userId = 'cmpnd6q9c0002zwaicojz5yvq';

  const toRemove = [
    'Attention-Deficit Hyperactivity Disorder',
    'intelligence and systematically overshadowed by complex somatic diseases.',
  ];

  for (const name of toRemove) {
    const key = name.toLowerCase().trim();

    // Delete from history
    const deleted = await prisma.medicalHistoryEntry.deleteMany({
      where: { userId, name }
    });

    // Add to ignore list so sync won't re-create it
    await prisma.syncIgnoreItem.upsert({
      where: { userId_itemType_itemKey: { userId, itemType: 'CONDITION', itemKey: key } },
      update: {},
      create: { userId, itemType: 'CONDITION', itemKey: key }
    });

    console.log(`Removed ${deleted.count} entry & ignored: "${name}"`);
  }

  const remaining = await prisma.medicalHistoryEntry.findMany({
    where: { userId, category: 'CONDITION' },
    select: { name: true }
  });
  console.log('\nRemaining conditions:', remaining.map(c => c.name));

  await prisma.$disconnect();
}
main().catch(console.error);
