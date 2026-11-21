ALTER TABLE "CancellationRequest" ADD COLUMN "returnStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED';

UPDATE "CancellationRequest" AS request
SET "returnStatus" = 'RETURN_PENDING'
FROM "Order" AS orders
WHERE request."orderId" = orders."id"
  AND orders."status" IN ('SHIPPED', 'DELIVERED');
