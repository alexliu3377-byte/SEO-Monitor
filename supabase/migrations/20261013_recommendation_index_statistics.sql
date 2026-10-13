-- Newly created expression indexes have no expression selectivity statistics
-- until ANALYZE. Without them, sparse per-key lookups can choose the broad
-- last_seen index and scan unrelated signals once for every submitted term.
-- Apply after the recommendation candidate/index migrations.
analyze public.keyword_signal_rollup;
