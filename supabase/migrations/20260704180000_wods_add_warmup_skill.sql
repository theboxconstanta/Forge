-- Sectiuni de Warm-up si Skill pentru WOD-ul zilei, separate de miscarile
-- pe variante (movements_onramp/beginner/intermediate/rx). Un singur set
-- pentru toata ziua, indiferent de variantă aleasă de membru.
alter table wods add column if not exists warmup text[];
alter table wods add column if not exists skill text[];
