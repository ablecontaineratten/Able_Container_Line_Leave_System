-- Starting data. Everything here can be changed later in the app (Settings).

INSERT INTO settings (key, value) VALUES
  ('company_name', 'Able Container Line'),
  ('timezone', 'Asia/Colombo'),
  ('year_start', '01-01'),
  ('weekend', '0,6'),
  ('no_balance', 'reject'),
  ('short_per_month', '2'),
  ('brand_color', '#0B3B8C');

INSERT INTO leave_types (name, days_per_year, counts_in_pool, allow_half, is_short, sort_order) VALUES
  ('Annual Leave', 14, 1, 0, 0, 1),
  ('Casual Leave', 7, 1, 1, 0, 2),
  ('Medical Leave', 7, 1, 0, 0, 3),
  ('Short Leave', 2, 0, 0, 1, 4),
  ('No Pay Leave', NULL, 0, 0, 0, 5);
