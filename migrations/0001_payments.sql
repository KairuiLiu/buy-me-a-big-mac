-- Public integration IDs are not proof of ownership of an Afdian account.
CREATE TABLE payment_integrations (
  id TEXT PRIMARY KEY,
  afdian_id TEXT NOT NULL,
  webhook_secret_hash TEXT NOT NULL,
  management_token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_webhook_at INTEGER
);

CREATE TABLE payment_intents (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL REFERENCES payment_integrations(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 10000000),
  read_token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  notified_at INTEGER,
  expires_at INTEGER NOT NULL
);
CREATE INDEX payment_intents_expiry ON payment_intents(expires_at);

-- Permanent minimal replay tombstones. No foreign key: an intent is deliberately
-- deleted after expiry, while its order hash must never be reused for a new one.
-- NULL intent_id also consumes authentic callbacks unrelated to a live intent.
-- The signed-message hash blocks replay by re-segmenting Afdian's concatenated,
-- delimiter-free signed fields into a different apparent order number.
CREATE TABLE payment_order_receipts (
  order_hash TEXT PRIMARY KEY,
  signed_message_hash TEXT NOT NULL UNIQUE,
  intent_id TEXT UNIQUE,
  received_at INTEGER NOT NULL
);
