-- ============================================================
-- 012 - SD & Rent Transaction Summary Report
--   one report over SD transactions and generated Rent Schedule lines
--   (read-only; users need the View right)
-- ============================================================

INSERT INTO screens (screen_code, screen_name, menu_group, sort_order) VALUES
  ('SD_RENT_REPORT', 'SD & Rent Transaction Summary Report', 'Reports', 75)
ON CONFLICT (screen_code) DO NOTHING;
