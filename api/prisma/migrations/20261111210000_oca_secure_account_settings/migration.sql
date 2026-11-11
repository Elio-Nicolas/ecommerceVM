ALTER TABLE "ShippingSettings"
  ADD COLUMN "ocaEnvironment" TEXT NOT NULL DEFAULT 'QA',
  ADD COLUMN "ocaUsernameEncrypted" TEXT,
  ADD COLUMN "ocaPasswordEncrypted" TEXT,
  ADD COLUMN "ocaCuitEncrypted" TEXT,
  ADD COLUMN "ocaOperativeEncrypted" TEXT;
