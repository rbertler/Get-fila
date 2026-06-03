import { prisma } from '../utils/prisma.js';
import { parseProviderFromText } from '../services/recordExtractor.js';

async function main() {
  const rec = await prisma.medicalRecord.findFirst({
    where: { userId: 'cmpnd6q9c0002zwaicojz5yvq', fileName: { contains: 'Williams' } },
    select: { id: true, fileName: true, extractedText: true }
  });
  if (!rec?.extractedText) { console.log('No text'); return; }
  
  const provider = parseProviderFromText(rec.extractedText);
  console.log('Extracted provider:', provider);
  
  // Show lines that mention a provider/doctor/physician
  const lines = rec.extractedText.split('\n').map((l: string) => l.trim()).filter((l: string) => l);
  lines.slice(0, 30).forEach((l: string) => console.log(l));
  await prisma.$disconnect();
}
main().catch(console.error);
