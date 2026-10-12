-- Keep the signed platform order number only with the short-lived intent.
-- Existing intents remain valid with NULL, including notifications received
-- before this migration. Apply before the new Worker; old Workers may continue
-- writing their existing column set during the deployment.
ALTER TABLE payment_intents ADD COLUMN afdian_order_no TEXT
  CHECK (afdian_order_no IS NULL OR
    (length(afdian_order_no) BETWEEN 1 AND 64 AND afdian_order_no NOT GLOB '*[^0-9]*'));
