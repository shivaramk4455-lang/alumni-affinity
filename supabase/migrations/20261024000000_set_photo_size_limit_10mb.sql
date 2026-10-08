-- ===========================================================================
-- 20261024: Set profile-photos bucket upload size limit to 10 MB (10485760 bytes).
-- Matches standard matrimonial platform specifications (e.g. Shaadi.com / BharatMatrimony)
-- and aligns with verification-docs storage limit while auto-optimizing to ~1–2 MB.
-- ===========================================================================

UPDATE storage.buckets
   SET file_size_limit = 10485760
 WHERE id = 'profile-photos';
