-- The main system is only for Super admin, Admins and Department heads (employees use the leave request app).
-- Login accounts that still had the old "employee" role become Admins (decided by the owner).
UPDATE users SET role = 'admin' WHERE role = 'employee';
DELETE FROM permissions WHERE role = 'employee';
