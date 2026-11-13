CREATE TYPE "CancellationRequestStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'REFUNDED', 'FAILED');

CREATE TABLE "CancellationRequest" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "customerEmail" TEXT NOT NULL,
  "status" "CancellationRequestStatus" NOT NULL DEFAULT 'REQUESTED',
  "requestKey" TEXT NOT NULL,
  "providerRefundId" TEXT,
  "providerStatus" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CancellationRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CancellationRequest_orderId_key" ON "CancellationRequest"("orderId");
CREATE UNIQUE INDEX "CancellationRequest_requestKey_key" ON "CancellationRequest"("requestKey");
CREATE INDEX "CancellationRequest_status_createdAt_idx" ON "CancellationRequest"("status", "createdAt");
ALTER TABLE "CancellationRequest" ADD CONSTRAINT "CancellationRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
