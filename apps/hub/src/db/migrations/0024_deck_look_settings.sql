-- Existing immutable receipts remain unchanged; current settings gain an
-- explicitly unconfigured project-role deck field.
UPDATE "sb_settings"
SET "fields" = jsonb_set("fields", '{deckLooks}', '{"value":null,"version":0}'::jsonb)
WHERE NOT ("fields" ? 'deckLooks');
