CREATE TYPE "PaymentAttemptStatus" AS ENUM (
  'CREATING',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'UNKNOWN'
);

CREATE TABLE "PaymentAttempt" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'MERCADO_PAGO',
  "requestKey" TEXT NOT NULL,
  "providerOrderId" TEXT,
  "checkoutUrl" TEXT,
  "amountArs" INTEGER NOT NULL,
  "currencyCode" TEXT NOT NULL DEFAULT 'ARS',
  "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATING',
  "statusDetail" TEXT,
  "approvedAt" TIMESTAMP(3),
  "responsePayload" JSONB,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentAttempt_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PaymentAttempt_requestKey_key"
ON "PaymentAttempt"("requestKey");

CREATE UNIQUE INDEX "PaymentAttempt_providerOrderId_key"
ON "PaymentAttempt"("providerOrderId");

CREATE INDEX "PaymentAttempt_orderId_createdAt_idx"
ON "PaymentAttempt"("orderId", "createdAt");

CREATE INDEX "PaymentAttempt_status_createdAt_idx"
ON "PaymentAttempt"("status", "createdAt");
