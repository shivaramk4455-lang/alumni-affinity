-- ===========================================================================
-- 20261021: Extend profile-photos bucket upload size limit from 10 MB to 20 MB.
--
-- Modern smartphone cameras (e.g. 48MP/50MP RAW/high-res portraits) produce
-- image files that easily exceed 10 MB. Increasing bucket file_size_limit to
-- 20 MB (20971520 bytes) allows members to upload high-fidelity original
-- photographs without manual compression, while keeping storage bounded.
-- ===========================================================================

UPDATE storage.buckets
   SET file_size_limit = 20971520
 WHERE id = 'profile-photos';
