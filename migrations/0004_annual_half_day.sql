-- Half days are allowed for Annual Leave too (0.5 of the chosen type)
UPDATE leave_types SET allow_half = 1 WHERE name = 'Annual Leave' COLLATE NOCASE;
