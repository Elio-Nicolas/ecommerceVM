ALTER TABLE "Order"
  ADD COLUMN "deliveryMethod" TEXT NOT NULL DEFAULT 'ENVIOPACK',
  ADD COLUMN "shippingInternalCostArs" INTEGER,
  ADD COLUMN "deliveryInstructions" TEXT;
