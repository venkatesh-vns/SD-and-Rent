-- ============================================================
-- 009 - SD Dashboard
--   * management overview: KPIs, upcoming lease dates, SD type,
--     location / cost center / landlord summaries, recoveries,
--     status and financial year analysis (read-only screen)
--   * users need the View right; Export uses View as well
-- ============================================================

INSERT INTO screens (screen_code, screen_name, menu_group, sort_order) VALUES
  ('SD_DASHBOARD', 'SD Dashboard', 'Reports', 65)
ON CONFLICT (screen_code) DO NOTHING;
