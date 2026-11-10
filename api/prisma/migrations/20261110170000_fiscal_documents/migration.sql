CREATE TYPE "FiscalDocumentType" AS ENUM ('INVOICE_C', 'CREDIT_NOTE_C', 'DEBIT_NOTE_C');
CREATE TYPE "FiscalDocumentStatus" AS ENUM ('PENDING', 'ISSUING', 'AUTHORIZED', 'REJECTED', 'UNKNOWN');
CREATE TYPE "ArcaEnvironment" AS ENUM ('HOMOLOGATION', 'PRODUCTION');

CREATE TABLE "ArcaSettings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "environment" "ArcaEnvironment" NOT NULL DEFAULT 'HOMOLOGATION',
  "pointOfSale" INTEGER,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ArcaSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FiscalDocument" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "type" "FiscalDocumentType" NOT NULL,
  "status" "FiscalDocumentStatus" NOT NULL DEFAULT 'PENDING',
  "requestKey" TEXT NOT NULL,
  "pointOfSale" INTEGER,
  "voucherType" INTEGER NOT NULL,
  "voucherNumber" INTEGER,
  "issueDate" TIMESTAMP(3),
  "receiverDocumentType" INTEGER,
  "receiverDocumentNumber" TEXT,
  "receiverVatConditionId" INTEGER,
  "receiverName" TEXT,
  "receiverAddress" TEXT,
  "currencyCode" TEXT NOT NULL DEFAULT 'PES',
  "currencyRate" DECIMAL(18,6),
  "concept" INTEGER NOT NULL DEFAULT 1,
  "netAmountArs" INTEGER NOT NULL DEFAULT 0,
  "exemptAmountArs" INTEGER NOT NULL DEFAULT 0,
  "nonTaxedAmountArs" INTEGER NOT NULL DEFAULT 0,
  "vatAmountArs" INTEGER NOT NULL DEFAULT 0,
  "tributeAmountArs" INTEGER NOT NULL DEFAULT 0,
  "totalAmountArs" INTEGER NOT NULL,
  "cae" TEXT,
  "caeExpiresAt" TIMESTAMP(3),
  "authorizedAt" TIMESTAMP(3),
  "relatedDocumentId" TEXT,
  "items" JSONB NOT NULL,
  "requestPayload" JSONB,
  "responsePayload" JSONB,
  "pdf" BYTEA,
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FiscalDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FiscalDocument_requestKey_key" ON "FiscalDocument"("requestKey");
CREATE UNIQUE INDEX "FiscalDocument_pointOfSale_voucherType_voucherNumber_key" ON "FiscalDocument"("pointOfSale", "voucherType", "voucherNumber");
CREATE INDEX "FiscalDocument_orderId_createdAt_idx" ON "FiscalDocument"("orderId", "createdAt");
CREATE INDEX "FiscalDocument_status_createdAt_idx" ON "FiscalDocument"("status", "createdAt");
CREATE INDEX "FiscalDocument_cae_idx" ON "FiscalDocument"("cae");
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_relatedDocumentId_fkey" FOREIGN KEY ("relatedDocumentId") REFERENCES "FiscalDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
