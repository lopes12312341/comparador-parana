-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Property" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "address" TEXT,
    "neighborhood" TEXT,
    "operation" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" DATETIME,
    "raw" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Property_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Property" ("address", "createdAt", "currency", "externalId", "id", "neighborhood", "price", "sourceId", "title", "type", "updatedAt", "url") SELECT "address", "createdAt", "currency", "externalId", "id", "neighborhood", "price", "sourceId", "title", "type", "updatedAt", "url" FROM "Property";
DROP TABLE "Property";
ALTER TABLE "new_Property" RENAME TO "Property";
CREATE INDEX "Property_price_type_idx" ON "Property"("price", "type");
CREATE INDEX "Property_isActive_lastSeenAt_idx" ON "Property"("isActive", "lastSeenAt");
CREATE UNIQUE INDEX "Property_sourceId_externalId_key" ON "Property"("sourceId", "externalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
