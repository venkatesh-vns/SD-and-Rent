-- ============================================================
-- 011 - Rule Master and Waiver Master apply to one or more components
--   component_code (single, NULL = all) becomes component_codes (list,
--   NULL = all components). Existing values are kept.
-- ============================================================

ALTER TABLE rent_rules ADD COLUMN IF NOT EXISTS component_codes VARCHAR(30)[] NULL;
UPDATE rent_rules SET component_codes = ARRAY[component_code] WHERE component_code IS NOT NULL AND component_codes IS NULL;
ALTER TABLE rent_rules DROP COLUMN IF EXISTS component_code;

ALTER TABLE rent_waivers ADD COLUMN IF NOT EXISTS component_codes VARCHAR(30)[] NULL;
UPDATE rent_waivers SET component_codes = ARRAY[component_code] WHERE component_code IS NOT NULL AND component_codes IS NULL;
ALTER TABLE rent_waivers DROP COLUMN IF EXISTS component_code;
