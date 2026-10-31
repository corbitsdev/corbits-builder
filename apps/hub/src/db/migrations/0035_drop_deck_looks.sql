-- Immutable receipts keep their old shape; replays return them unvalidated.
UPDATE "sb_settings" SET "fields" = "fields" - 'deckLooks';
