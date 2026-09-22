-- MOVEMENT LIBRARY COMPLETION V1 - BATCH 3: search aliases only. Zero new
-- rows, zero renamed/merged movements, zero id changes. Each alias maps
-- 1:1 and unambiguously onto exactly one existing row (re-verified live,
-- immediately before this migration, that no "Prowler"/"Push Sled"/
-- "Pull Sled"/"Tire Drag"/"GHR"/"Med Ball ..." row or alias already
-- exists anywhere in the catalog - zero collision risk).
--
-- Sled Push/Pull word-order gap: movementNameKeys() (prescriptionContract.js)
-- doesn't reorder words, so "Push Sled"/"Pull Sled" don't exact-match
-- "Sled Push"/"Sled Pull" today even though they're the same movement -
-- an alias closes that gap without a duplicate row. "Prowler" is a brand-
-- name synonym for a push sled, added to the same row. "GHR" is a common
-- abbreviation. Medicine Ball aliases use the NARROWEST safe form: one
-- literal "med ball X" alias per existing "Medicine Ball X" row (not a
-- general "med -> medicine" substitution rule, which would risk creating
-- ambiguous keys across unrelated movements outside this ticket's scope).

update movements
set aliases = array(select distinct unnest(aliases || v.new_aliases))
from (values
  ('Sled Push',                    ARRAY['push sled','prowler']::text[]),
  ('Sled Pull',                    ARRAY['pull sled']::text[]),
  ('Glute Ham Raise',              ARRAY['ghr']::text[]),
  ('Medicine Ball Clean',          ARRAY['med ball clean']::text[]),
  ('Medicine Ball Throw',          ARRAY['med ball throw']::text[]),
  ('Medicine Ball Sit Up',         ARRAY['med ball sit up']::text[]),
  ('Medicine Ball Box Step Over',  ARRAY['med ball box step over']::text[])
) as v(name, new_aliases)
where lower(movements.name) = lower(v.name)
  and not (movements.aliases @> v.new_aliases);
