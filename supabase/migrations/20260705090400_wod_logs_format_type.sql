-- Formatul folosit la o logare libera (fara wod_id, deci fara un rand `wods`
-- de unde sa citim `type`) - inlocuieste convenția fragila de a reconstitui
-- tipul din prima linie a `notes` (text liber, parsat cu startsWith). Pentru
-- logurile legate de un WOD oficial (wod_id not null), formatul ramane cel
-- de pe `wods.type` (via join), aceasta coloana e null in acel caz.
alter table wod_logs add column if not exists format_type text;
