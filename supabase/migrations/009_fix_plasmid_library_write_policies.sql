-- The plasmid_library INSERT and UPDATE policies used USING/WITH CHECK (true),
-- meaning any authenticated user could write to the public library.
-- The intent (comment in migration 006) was service-role-only writes.
-- Correct approach: no write policies at all. The service role bypasses RLS
-- entirely, so seeding scripts are unaffected. Anon/user sessions are blocked.

DROP POLICY IF EXISTS "plasmid_library_service_insert" ON public.plasmid_library;
DROP POLICY IF EXISTS "plasmid_library_service_update" ON public.plasmid_library;
