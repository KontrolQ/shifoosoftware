-- Files were only ever listed by display name, which puts "9.0c (Apr 2007)" ahead of
-- "9.0c (Aug 2006)". A release holds its files in a deliberate order, the same way a
-- title holds its versions, so files get the same handle.

ALTER TABLE files ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 100;

-- The order they were recorded in is the order they were released in, so that is the
-- starting point rather than the alphabet.
UPDATE files SET sort_order = id;
