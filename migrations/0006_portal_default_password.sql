-- The portal now signs in with email + the default password (user@123) until the employee changes it.
-- Temporary passwords made by the old "Create portal passwords" button (never changed) are cleared,
-- so those employees use the default password too.
UPDATE employees SET portal_hash = '', portal_salt = '' WHERE portal_must_change = 1 AND portal_hash <> '';
UPDATE employees SET portal_must_change = 0;
