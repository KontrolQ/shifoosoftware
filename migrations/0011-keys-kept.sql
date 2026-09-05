-- A key is worth nothing to its holder if it can only be read once. This archive keeps
-- the whole key so it can be read back; the hash stays the thing requests are matched on.

ALTER TABLE api_keys ADD COLUMN secret TEXT;
