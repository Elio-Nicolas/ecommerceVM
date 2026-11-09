ALTER TABLE "Order"
  ADD COLUMN "shippingService" TEXT,
  ADD COLUMN "shippingEstimatedHours" INTEGER,
  ADD COLUMN "shippingQuoteId" TEXT,
  ADD COLUMN "shippingOptionKey" TEXT;

CREATE TABLE "ShippingQuote" (
  "id" TEXT NOT NULL,
  "provinceCode" TEXT NOT NULL,
  "postalCode" TEXT NOT NULL,
  "cartFingerprint" TEXT NOT NULL,
  "subtotalArs" INTEGER NOT NULL,
  "options" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShippingQuote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShippingQuote_expiresAt_usedAt_idx"
  ON "ShippingQuote"("expiresAt", "usedAt");
