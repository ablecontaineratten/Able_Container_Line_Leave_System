-- Able Container Line logo colours: main colour = logo blue (#28398A); red (#CF2830) is the accent in the CSS.
-- Only changes the main colour if it is still the old default.
UPDATE settings SET value = '#28398A' WHERE key = 'brand_color' AND upper(value) = '#0B3B8C';
