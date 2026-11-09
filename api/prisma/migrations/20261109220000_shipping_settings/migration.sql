CREATE TABLE "ShippingSettings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "enviopackEnabled" BOOLEAN NOT NULL DEFAULT false,
  "enviopackApiKeyEncrypted" TEXT,
  "enviopackSecretKeyEncrypted" TEXT,
  "pickupEnabled" BOOLEAN NOT NULL DEFAULT true,
  "pickupAddress" TEXT NOT NULL DEFAULT 'Domicilio del vendedor',
  "pickupInstructions" TEXT NOT NULL DEFAULT 'La dirección exacta y el horario se coordinarán luego de confirmar el pedido.',
  "localDeliveryEnabled" BOOLEAN NOT NULL DEFAULT false,
  "localDeliveryPostalCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "localDeliveryFeeArs" INTEGER NOT NULL DEFAULT 0,
  "localDeliveryInternalCostArs" INTEGER,
  "localDeliveryCoordinate" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShippingSettings_pkey" PRIMARY KEY ("id")
);