import { prisma } from '../utils/prisma.js';

async function main() {
  const userId = 'cmpnd6q9c0002zwaicojz5yvq';
  
  // Show all conditions
  const conditions = await prisma.medicalHistoryEntry.findMany({
    where: { userId, category: 'CONDITION' },
    select: { id: true, name: true }
  });
  console.log('Current conditions:');
  conditions.forEach(c => console.log(`  ${c.id}: ${c.name}`));
  
  // Delete garbage condition
  const garbage = conditions.find(c => c.name.includes('intelligence and systematically'));
  if (garbage) {
    await prisma.medicalHistoryEntry.delete({ where: { id: garbage.id } });
    console.log(`\nDeleted: "${garbage.name}"`);
  }

  // Delete duplicate ADHD (keep the more complete one from ADHD doc)
  const adhd1 = conditions.find(c => c.name === 'Attention-Deficit Hyperactivity Disorder');
  if (adhd1) {
    await prisma.medicalHistoryEntry.delete({ where: { id: adhd1.id } });
    console.log(`Deleted duplicate: "${adhd1.name}"`);
  }
  
  const remaining = await prisma.medicalHistoryEntry.findMany({
    where: { userId, category: 'CONDITION' },
    select: { id: true, name: true }
  });
  console.log('\nFinal conditions:');
  remaining.forEach(c => console.log(`  - ${c.name}`));
  
  await prisma.$disconnect();
}
main().catch(console.error);
