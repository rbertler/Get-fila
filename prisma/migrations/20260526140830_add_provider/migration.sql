-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerType" TEXT,
    "specialty" TEXT,
    "affiliation" TEXT,
    "phone" TEXT,
    "fax" TEXT,
    "address" TEXT,
    "email" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "sourceRecordIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
