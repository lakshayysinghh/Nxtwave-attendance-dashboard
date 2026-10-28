-- Extensions used by later phases: pg_trgm for name search,
-- btree_gist for the term no-overlap exclusion constraint.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
