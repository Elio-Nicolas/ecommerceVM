-- Keep the active default deterministic even if legacy rows contain duplicates.
UPDATE "ShippingOrigin"
SET "isDefault" = false
WHERE "isActive" = false AND "isDefault" = true;

WITH ranked_defaults AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC) AS position
  FROM "ShippingOrigin"
  WHERE "isActive" = true AND "isDefault" = true
)
UPDATE "ShippingOrigin" AS origin
SET "isDefault" = false
FROM ranked_defaults
WHERE origin."id" = ranked_defaults."id"
  AND ranked_defaults.position > 1;

UPDATE "ShippingOrigin"
SET "isDefault" = true
WHERE "id" = (
  SELECT "id"
  FROM "ShippingOrigin"
  WHERE "isActive" = true
  ORDER BY "createdAt" ASC, "id" ASC
  LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM "ShippingOrigin"
  WHERE "isActive" = true AND "isDefault" = true
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShippingOrigin_single_active_default_key"
ON "ShippingOrigin" ("isDefault")
WHERE "isActive" = true AND "isDefault" = true;
