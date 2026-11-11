ALTER TABLE "ShippingShipmentEvent" ADD COLUMN "lockedAt" TIMESTAMP(3);

CREATE INDEX "ShippingShipmentEvent_status_lockedAt_idx" ON "ShippingShipmentEvent"("status", "lockedAt");
