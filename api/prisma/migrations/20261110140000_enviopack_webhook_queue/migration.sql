CREATE TABLE "EnviopackWebhookEvent" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "EnviopackWebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EnviopackWebhookEvent_status_receivedAt_idx" ON "EnviopackWebhookEvent"("status", "receivedAt");
CREATE INDEX "EnviopackWebhookEvent_shipmentId_idx" ON "EnviopackWebhookEvent"("shipmentId");
