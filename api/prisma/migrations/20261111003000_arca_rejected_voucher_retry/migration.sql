DROP INDEX IF EXISTS "FiscalDocument_pointOfSale_voucherType_voucherNumber_key";

-- ARCA does not consume a voucher number when it rejects a request or confirms
-- that the requested voucher does not exist (WSFE error 602). Keep those
-- attempts for audit, while reserving each voucher number to at most one
-- non-rejected fiscal document.
CREATE UNIQUE INDEX "FiscalDocument_active_voucher_number_key"
ON "FiscalDocument" ("pointOfSale", "voucherType", "voucherNumber")
WHERE "pointOfSale" IS NOT NULL
  AND "voucherNumber" IS NOT NULL
  AND "status" <> 'REJECTED'::"FiscalDocumentStatus";
