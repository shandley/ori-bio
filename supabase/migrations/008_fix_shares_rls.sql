-- Replace the overly-permissive share SELECT policy.
-- The previous policy (USING true) allowed any unauthenticated request with
-- the public anon key to enumerate all share tokens and sequence_ids.
-- The public share API route (/api/share/[token]) uses the service role key
-- and bypasses RLS, so share links continue to work without this policy.

DROP POLICY IF EXISTS "Anyone can view shares" ON public.sequence_shares;

CREATE POLICY "Owner can view own shares"
    ON public.sequence_shares FOR SELECT
    USING (auth.uid() = created_by);
