ALTER TABLE "Product"
  ADD COLUMN "weightGrams" INTEGER,
  ADD COLUMN "packageLengthCm" INTEGER,
  ADD COLUMN "packageWidthCm" INTEGER,
  ADD COLUMN "packageHeightCm" INTEGER;

CREATE TABLE "ShippingOrigin" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provinceCode" TEXT NOT NULL,
  "postalCode" TEXT NOT NULL,
  "enviopackAddressId" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShippingOrigin_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShippingOrigin_isActive_isDefault_idx"
  ON "ShippingOrigin"("isActive", "isDefault");
