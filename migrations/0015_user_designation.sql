-- Designation (job title) for login accounts. Only used for Department heads, e.g. "Operations Manager".
ALTER TABLE users ADD COLUMN designation TEXT NOT NULL DEFAULT '';
