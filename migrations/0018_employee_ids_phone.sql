-- Employee ETF number, NIC number and phone number (all optional)
ALTER TABLE employees ADD COLUMN etf_no TEXT NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN nic_no TEXT NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN phone TEXT NOT NULL DEFAULT '';
