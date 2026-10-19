-- ============================================================
-- 014 - SD Paid negative (reversal / credit note) entries
--   * SD Paid Amount may be negative: a reversal of an earlier, wrong payment.
--     Transfer, Adjustment and Refund stay 0 or more.
--   * reverses_txn_id optionally links a reversal to the payment it corrects.
--   * New right "SD Negative Entry": only users with its Add right (and admins)
--     may save negative SD Paid amounts.
-- Balances stay as before (SD Balance = Agreement - Paid; Repayable =
-- Paid - Transfer - Adjustment - Refund), now netting the reversals.
-- ============================================================

ALTER TABLE sd_transactions DROP CONSTRAINT IF EXISTS sd_transactions_paid_amount_check;
ALTER TABLE sd_transactions DROP CONSTRAINT IF EXISTS ck_sd_transactions_amount;
ALTER TABLE sd_transactions ADD CONSTRAINT ck_sd_transactions_amount CHECK (
    paid_amount <> 0 OR transfer_amount > 0 OR adjustment_amount > 0 OR refund_amount > 0);
-- A reversal is an entry of its own: negative SD Paid only
ALTER TABLE sd_transactions ADD CONSTRAINT ck_sd_transactions_reversal CHECK (
    paid_amount >= 0 OR (transfer_amount = 0 AND adjustment_amount = 0 AND refund_amount = 0));

ALTER TABLE sd_transactions ADD COLUMN IF NOT EXISTS reverses_txn_id INT NULL
    REFERENCES sd_transactions(txn_id) ON DELETE RESTRICT;
ALTER TABLE sd_transactions ADD CONSTRAINT ck_sd_transactions_reverses CHECK (
    reverses_txn_id IS NULL OR paid_amount < 0);
CREATE INDEX IF NOT EXISTS ix_sd_transactions_reverses ON sd_transactions (reverses_txn_id);

-- The ledger view lists t.*; re-create it so it includes the new column
DROP VIEW IF EXISTS v_sd_ledger;
CREATE VIEW v_sd_ledger AS
SELECT t.*,
       s.sd_code,
       s.agreement_value,
       SUM(t.paid_amount) OVER w                                        AS running_paid,
       s.agreement_value - SUM(t.paid_amount) OVER w                    AS running_sd_balance,
       SUM(t.paid_amount - t.transfer_amount - t.refund_amount - t.adjustment_amount) OVER w
                                                                         AS running_repayable
FROM sd_transactions t
JOIN sd_master s ON s.sd_id = t.sd_id
WINDOW w AS (PARTITION BY t.sd_id ORDER BY t.txn_date, t.txn_id ROWS UNBOUNDED PRECEDING);

INSERT INTO screens (screen_code, screen_name, menu_group, sort_order) VALUES
  ('SD_NEGATIVE_ENTRY', 'SD Negative Entry (SD Paid reversal)', 'SD Transaction', 62)
ON CONFLICT (screen_code) DO NOTHING;
