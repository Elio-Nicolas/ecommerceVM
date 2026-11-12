UPDATE "ShippingShipment" SET "provider" = 'LEGACY_CARRIER'
WHERE "provider" = 'ENVIOPACK' AND NOT EXISTS (
  SELECT 1 FROM "ShippingShipment" legacy WHERE legacy."orderId" = "ShippingShipment"."orderId" AND legacy."provider" = 'LEGACY_CARRIER'
);
DELETE FROM "ShippingShipment" old WHERE old."provider" = 'ENVIOPACK' AND EXISTS (
  SELECT 1 FROM "ShippingShipment" legacy WHERE legacy."orderId" = old."orderId" AND legacy."provider" = 'LEGACY_CARRIER'
);
INSERT INTO "ShippingShipment" (
  "id","orderId","provider","status","externalAdmissionId","trackingNumber","serviceCode","serviceLabel",
  "parcels","labelPdf","labelMimeType","admittedAt","processedAt","lastError","createdAt","updatedAt"
)
SELECT 'legacy-' || o."id",o."id",'LEGACY_CARRIER',COALESCE(o."enviopackShipmentStatus",'HISTORICAL'),
  o."enviopackShipmentId",COALESCE(o."enviopackTrackingNumber",o."trackingCode"),o."shippingService",o."shippingCarrier",
  COALESCE(o."enviopackPackages",'[]'::jsonb),o."enviopackLabelPdf",
  CASE WHEN o."enviopackLabelPdf" IS NULL THEN NULL ELSE 'application/pdf' END,
  o."enviopackProcessedAt",o."enviopackProcessedAt",NULL,o."createdAt",CURRENT_TIMESTAMP
FROM "Order" o
WHERE (o."enviopackOrderId" IS NOT NULL OR o."enviopackShipmentId" IS NOT NULL OR o."enviopackTrackingNumber" IS NOT NULL OR o."enviopackPackages" IS NOT NULL OR o."enviopackLabelPdf" IS NOT NULL)
AND NOT EXISTS (SELECT 1 FROM "ShippingShipment" s WHERE s."orderId"=o."id" AND s."provider"='LEGACY_CARRIER');
UPDATE "Order" SET "deliveryMethod"='LEGACY_CARRIER' WHERE "deliveryMethod"='ENVIOPACK';
ALTER TABLE "Order" ALTER COLUMN "deliveryMethod" SET DEFAULT 'OCA';
DROP INDEX IF EXISTS "Order_enviopackShipmentId_key";
DROP INDEX IF EXISTS "Order_enviopackOrderId_idx";
ALTER TABLE "Order" DROP COLUMN "enviopackOrderId",DROP COLUMN "enviopackShipmentId",DROP COLUMN "enviopackShipmentStatus",
  DROP COLUMN "enviopackTrackingNumber",DROP COLUMN "enviopackProcessedAt",DROP COLUMN "enviopackPackages",
  DROP COLUMN "enviopackLabelPdf",DROP COLUMN "enviopackLabelSavedAt";
ALTER TABLE "ShippingOrigin" DROP COLUMN "enviopackAddressId";
ALTER TABLE "ShippingSettings" DROP COLUMN "enviopackEnabled",DROP COLUMN "enviopackApiKeyEncrypted",DROP COLUMN "enviopackSecretKeyEncrypted";
DROP TABLE IF EXISTS "EnviopackWebhookEvent";
