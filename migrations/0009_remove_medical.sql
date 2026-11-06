-- The company has no Medical Leave: delete it (or switch it off if old requests still use it)
DELETE FROM leave_types WHERE name LIKE 'Medical%'
  AND NOT EXISTS (SELECT 1 FROM leave_requests r WHERE r.leave_type = leave_types.name COLLATE NOCASE);
UPDATE leave_types SET active = 0 WHERE name LIKE 'Medical%';
