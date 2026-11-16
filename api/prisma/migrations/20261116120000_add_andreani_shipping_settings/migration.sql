ALTER TABLE "ShippingSettings"
  ADD COLUMN "andreaniEnvironment" TEXT NOT NULL DEFAULT 'QA',
  ADD COLUMN "andreaniUsernameEncrypted" TEXT,
  ADD COLUMN "andreaniPasswordEncrypted" TEXT,
  ADD COLUMN "andreaniClientCodeEncrypted" TEXT,
  ADD COLUMN "andreaniContractEncrypted" TEXT;
