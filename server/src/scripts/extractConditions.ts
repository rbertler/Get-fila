import { PrismaClient } from '@prisma/client';
import { parseConditionsFromText } from '../services/recordExtractor.js';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  const userId = 'cmpnd6q9c0002zwaicojz5yvq';
  
  // Get all records for this user
  const records = await prisma.medicalRecord.findMany({
    where: { userId },
    select: { id: true, fileName: true, extractedText: true, recordType: true }
  });
  
  console.log(`Found ${records.length} records`);
  
  // Get existing conditions to avoid duplicates
  const existing = await prisma.medicalHistoryEntry.findMany({
    where: { userId, category: 'CONDITION' },
    select: { name: true }
  });
  const existingKeys = new Set(existing.map(e => e.name.toLowerCase().trim()));
  console.log(`Existing conditions: ${existing.length}`);

  // Get ignore list
  const ignoreList = await prisma.syncIgnoreItem.findMany({
    where: { userId, itemType: 'CONDITION' },
    select: { itemKey: true }
  });
  const ignoredKeys = new Set(ignoreList.map(i => i.itemKey));
  console.log(`Ignored conditions: ${ignoredKeys.size}`);
  
  let totalAdded = 0;
  
  for (const record of records) {
    if (!record.extractedText) {
      console.log(`Skipping ${record.fileName} - no extracted text`);
      continue;
    }
    
    const conditions = parseConditionsFromText(record.extractedText);
    console.log(`\n${record.fileName}: found ${conditions.length} conditions`);
    conditions.forEach(c => console.log(`  - ${c.name}`));
    
    for (const condition of conditions) {
      const key = condition.name.toLowerCase().trim();
      if (existingKeys.has(key) || ignoredKeys.has(key)) {
        console.log(`  [SKIP] ${condition.name}`);
        continue;
      }
      
      await prisma.medicalHistoryEntry.create({
        data: {
          userId,
          category: 'CONDITION',
          name: condition.name,
          details: condition.details || null,
          isManual: false,
        }
      });
      existingKeys.add(key);
      totalAdded++;
      console.log(`  [ADDED] ${condition.name}`);
    }
  }
  
  console.log(`\nDone! Added ${totalAdded} conditions.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
