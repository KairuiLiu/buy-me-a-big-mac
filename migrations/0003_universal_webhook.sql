-- The shared webhook identifies a sponsorship by its short-lived intent.
-- Keep existing intents and replay protection, then remove integration setup.
CREATE TABLE payment_intents_universal (
  id TEXT PRIMARY KEY,
  afdian_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 10000000),
  read_token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  notified_at INTEGER,
  expires_at INTEGER NOT NULL,
  afdian_order_no TEXT CHECK (afdian_order_no IS NULL OR
    (length(afdian_order_no) BETWEEN 1 AND 64 AND afdian_order_no NOT GLOB '*[^0-9]*'))
);

INSERT INTO payment_intents_universal
  (id, afdian_id, amount_cents, read_token_hash, created_at, notified_at, expires_at, afdian_order_no)
SELECT intents.id, integrations.afdian_id,
  intents.amount_cents, intents.read_token_hash, intents.created_at,
  intents.notified_at, intents.expires_at, intents.afdian_order_no
FROM payment_intents AS intents
LEFT JOIN payment_integrations AS integrations ON integrations.id = intents.integration_id;

DROP TABLE payment_intents;
ALTER TABLE payment_intents_universal RENAME TO payment_intents;
CREATE INDEX payment_intents_expiry ON payment_intents(expires_at);
DROP TABLE payment_integrations;
