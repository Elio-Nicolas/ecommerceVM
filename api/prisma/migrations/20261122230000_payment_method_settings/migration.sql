CREATE TABLE "PaymentSettings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "mercadoPagoEnabled" BOOLEAN NOT NULL DEFAULT true,
  "goCuotasEnabled" BOOLEAN NOT NULL DEFAULT true,
  "naranjaXEnabled" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentSettings_pkey" PRIMARY KEY ("id")
);
INSERT INTO "PaymentSettings" ("id", "updatedAt") VALUES ('default', CURRENT_TIMESTAMP);
