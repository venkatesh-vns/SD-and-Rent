-- ============================================================
-- 015 - Reversal (negative SD Paid) entries shown in balances
--   v_sd_balance keeps its columns (total_paid stays NET of reversals, so
--   SD Balance and Repayable already include them) and adds:
--     total_payments  - sum of the positive SD Paid entries
--     total_reversal  - sum of the negative SD Paid entries (0 or less)
--     reversal_count  - number of reversal entries
-- ============================================================

CREATE OR REPLACE VIEW v_sd_balance AS
SELECT s.sd_id,
       s.sd_code,
       s.agreement_value,
       COALESCE(SUM(t.paid_amount), 0)        AS total_paid,
       COALESCE(SUM(t.transfer_amount), 0)    AS total_transfer,
       COALESCE(SUM(t.adjustment_amount), 0)  AS total_adjustment,
       COALESCE(SUM(t.refund_amount), 0)      AS total_refund,
       s.agreement_value - COALESCE(SUM(t.paid_amount), 0) AS sd_balance,
       COALESCE(SUM(t.paid_amount - t.transfer_amount - t.refund_amount - t.adjustment_amount), 0)
                                               AS sd_balance_repayable,
       COUNT(t.txn_id)::int                    AS txn_count,
       MAX(t.txn_date)                         AS last_txn_date,
       COALESCE(SUM(t.paid_amount) FILTER (WHERE t.paid_amount > 0), 0) AS total_payments,
       COALESCE(SUM(t.paid_amount) FILTER (WHERE t.paid_amount < 0), 0) AS total_reversal,
       COUNT(t.txn_id) FILTER (WHERE t.paid_amount < 0)::int            AS reversal_count
FROM sd_master s
LEFT JOIN sd_transactions t ON t.sd_id = s.sd_id
GROUP BY s.sd_id, s.sd_code, s.agreement_value;
