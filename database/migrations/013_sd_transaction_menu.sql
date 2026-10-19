-- ============================================================
-- 013 - Menu: "Transactions" renamed "SD Transaction"; SD Master moves under it
--   SD Transaction > SD Master, SD Transactions
--   (screen codes and user rights are unchanged)
-- ============================================================

UPDATE screens SET menu_group = 'SD Transaction', sort_order = 55 WHERE screen_code = 'SD_MASTER';
UPDATE screens SET menu_group = 'SD Transaction', screen_name = 'SD Transactions', sort_order = 60 WHERE screen_code = 'SD_TRANSACTION';
