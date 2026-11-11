ALTER TABLE "Order"
ADD COLUMN "checkoutRequestKey" TEXT,
ADD COLUMN "checkoutFingerprint" TEXT;

CREATE UNIQUE INDEX "Order_checkoutRequestKey_key"
ON "Order"("checkoutRequestKey");
