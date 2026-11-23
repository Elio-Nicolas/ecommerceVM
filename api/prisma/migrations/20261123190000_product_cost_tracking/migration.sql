ALTER TABLE "Product" ADD COLUMN "costPriceArs" INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN "unitCostArs" INTEGER;

ALTER TABLE "Product" ADD CONSTRAINT "Product_costPriceArs_nonnegative" CHECK ("costPriceArs" IS NULL OR "costPriceArs" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_unitCostArs_nonnegative" CHECK ("unitCostArs" IS NULL OR "unitCostArs" >= 0);
