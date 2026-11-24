-- An earlier hub copied every grant a person held, admin included, onto the agents they deployed,
-- as system rows with these ids. Those copies made an agent a tenant admin.
DELETE FROM "grant" WHERE "origin" = 'system' AND "id" ~ '^mirror-[0-9a-f]{48}$';
