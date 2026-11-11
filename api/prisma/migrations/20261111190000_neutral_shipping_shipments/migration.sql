CREATE TABLE "ShippingShipment" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CREATED',
  "externalAdmissionId" TEXT,
  "trackingNumber" TEXT,
  "serviceCode" TEXT,
  "serviceLabel" TEXT,
  "parcels" JSONB NOT NULL,
  "labelPdf" BYTEA,
  "labelMimeType" TEXT,
  "admittedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShippingShipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShippingShipmentEvent" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "externalEventId" TEXT,
  "eventType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "payload" JSONB,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  CONSTRAINT "ShippingShipmentEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShippingShipment_orderId_provider_key" ON "ShippingShipment"("orderId", "provider");
CREATE INDEX "ShippingShipment_provider_status_updatedAt_idx" ON "ShippingShipment"("provider", "status", "updatedAt");
CREATE INDEX "ShippingShipment_trackingNumber_idx" ON "ShippingShipment"("trackingNumber");
CREATE UNIQUE INDEX "ShippingShipmentEvent_shipmentId_externalEventId_key" ON "ShippingShipmentEvent"("shipmentId", "externalEventId");
CREATE INDEX "ShippingShipmentEvent_status_receivedAt_idx" ON "ShippingShipmentEvent"("status", "receivedAt");
CREATE INDEX "ShippingShipmentEvent_shipmentId_receivedAt_idx" ON "ShippingShipmentEvent"("shipmentId", "receivedAt");

ALTER TABLE "ShippingShipment" ADD CONSTRAINT "ShippingShipment_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShippingShipmentEvent" ADD CONSTRAINT "ShippingShipmentEvent_shipmentId_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "ShippingShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
