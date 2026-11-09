ALTER TABLE "Order"
  ADD COLUMN "provinceCode" TEXT,
  ADD COLUMN "enviopackOrderId" TEXT,
  ADD COLUMN "enviopackShipmentId" TEXT,
  ADD COLUMN "enviopackShipmentStatus" TEXT,
  ADD COLUMN "enviopackTrackingNumber" TEXT,
  ADD COLUMN "enviopackProcessedAt" TIMESTAMP(3);

ALTER TABLE "OrderItem"
  ADD COLUMN "weightGrams" INTEGER,
  ADD COLUMN "packageLengthCm" INTEGER,
  ADD COLUMN "packageWidthCm" INTEGER,
  ADD COLUMN "packageHeightCm" INTEGER;

CREATE UNIQUE INDEX "Order_enviopackShipmentId_key" ON "Order"("enviopackShipmentId");
CREATE INDEX "Order_enviopackOrderId_idx" ON "Order"("enviopackOrderId");
