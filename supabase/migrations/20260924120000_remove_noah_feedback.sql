-- Remove Noah answer feedback (thumbs up/down). The PWA no longer calls it.
-- This deletes the stored rating metadata. Notice acknowledgment and the usage quota
-- from 20260924081941 are intentionally untouched.
begin;
set local lock_timeout = '5s';
drop function if exists public.quickflex_noah_submit_feedback(integer,text[],boolean,integer,text);
drop table if exists quickflex_noah_private.feedback;
commit;
