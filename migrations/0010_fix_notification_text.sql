-- Notifications saved with a garbled "·" (shown as "Â·") get the right character
UPDATE notifications SET body = REPLACE(body, 'Â·', '·'), title = REPLACE(title, 'Â·', '·') WHERE body LIKE '%Â·%' OR title LIKE '%Â·%';
