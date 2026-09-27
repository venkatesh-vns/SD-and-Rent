-- ============================================================
-- Seed data - sample reference data only.
--
-- NOTE: The default admin user is intentionally NOT created here,
-- because its password must be bcrypt-hashed and a hash pasted
-- directly into SQL cannot be verified as correct ahead of time.
-- Instead, after running schema.sql, create the admin user with:
--
--   cd server
--   npm install
--   npm run seed
--
-- This generates a correct bcrypt hash and inserts an Active admin
-- user (default UserName: admin / Password: Admin@123 unless you
-- pass --username=, --email=, --password= flags). See README.md.
-- Run this file AFTER schema.sql, in pgAdmin's Query Tool.
-- ============================================================

INSERT INTO cost_centers (cost_center_code, cost_center_name, status, created_by)
VALUES
('CC001', 'Administration', 'Active', 'System'),
('CC002', 'Production', 'Active', 'System'),
('CC003', 'Maintenance', 'Active', 'System');
