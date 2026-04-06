-- ── Migration 012: Seed 40 major energy trading ports ────────────────────────
-- Source: WPI / UN LOCODE / IMO GISIS — curated energy hub list

INSERT INTO ports (locode, name, country, region, lat, lng, port_type, size, max_vessel, fuel_oil, diesel, fresh_water, provisions, crane, drydock, is_energy_hub) VALUES

-- ── Europe ────────────────────────────────────────────────────────────────────
('NLRTM', 'Rotterdam',             'NL', 'South Holland',  51.93333,  4.46667, 'seaport', 'very large', 'ULCC',        TRUE, TRUE, TRUE, TRUE, TRUE, 'large',  TRUE),
('BEANR', 'Antwerp',               'BE', 'Antwerp',        51.26667,  4.40000, 'seaport', 'very large', 'Panamax',     TRUE, TRUE, TRUE, TRUE, TRUE, 'large',  TRUE),
('DEHAM', 'Hamburg',               'DE', 'Hamburg',        53.54697,  9.95966, 'seaport', 'large',      'Panamax',     TRUE, TRUE, TRUE, TRUE, TRUE, 'large',  TRUE),
('GBLON', 'London',                'GB', 'England',        51.50000,   0.05000, 'seaport', 'large',     'Suezmax',     TRUE, TRUE, TRUE, TRUE, TRUE, 'medium', TRUE),
('GBSOU', 'Southampton',           'GB', 'England',        50.90000,  -1.40000, 'seaport', 'large',     'VLCC',        TRUE, TRUE, TRUE, TRUE, TRUE, 'medium', TRUE),
('FRMRS', 'Marseille',             'FR', 'PACA',           43.29695,   5.38107, 'seaport', 'large',     'VLCC',        TRUE, TRUE, TRUE, TRUE, TRUE, 'medium', TRUE),
('ITGOA', 'Genoa',                 'IT', 'Liguria',        44.40479,   8.94439, 'seaport', 'large',     'Panamax',     TRUE, TRUE, TRUE, TRUE, TRUE, 'medium', TRUE),
('GRATH', 'Piraeus',               'GR', 'Attica',         37.94000,  23.64000, 'seaport', 'large',     'VLCC',        TRUE, TRUE, TRUE, TRUE, TRUE, 'large',  TRUE),
('ESALG', 'Algeciras',             'ES', 'Andalusia',      36.12800,  -5.45300, 'seaport', 'large',     'ULCC',        TRUE, TRUE, TRUE, TRUE, TRUE, 'medium', TRUE),
('NOSVG', 'Stavanger',             'NO', 'Rogaland',       58.97005,   5.73333, 'seaport', 'medium',    'Suezmax',     TRUE, TRUE, TRUE, TRUE, TRUE, 'medium', TRUE),

-- ── Middle East ───────────────────────────────────────────────────────────────
('AEJEA', 'Jebel Ali',             'AE', 'Dubai',          25.00500,  55.09400, 'seaport', 'very large', 'ULCC',       TRUE, TRUE, TRUE, TRUE, TRUE, 'large',  TRUE),
('AEFUJ', 'Fujairah',              'AE', 'Fujairah',       25.12700,  56.34600, 'seaport', 'large',      'VLCC',       TRUE, TRUE, TRUE, TRUE, TRUE, 'medium', TRUE),
('IQBSR', 'Basra',                 'IQ', 'Basra',          30.54000,  47.82700, 'seaport', 'large',      'VLCC',       TRUE, TRUE, TRUE, TRUE, FALSE,'none',   TRUE),
('IRBND', 'Bandar Imam Khomeini',  'IR', 'Khuzestan',      30.44800,  49.08800, 'seaport', 'large',      'VLCC',       TRUE, TRUE, TRUE, FALSE,FALSE,'none',   TRUE),
('KWKWI', 'Kuwait',                'KW', 'Al Asimah',      29.37000,  47.97000, 'seaport', 'medium',     'Suezmax',    TRUE, TRUE, TRUE, TRUE, FALSE,'small',  TRUE),
('SARAS', 'Ras Tanura',            'SA', 'Eastern Province',26.64000, 50.16000, 'seaport', 'large',      'VLCC',       TRUE, TRUE, TRUE, TRUE, FALSE,'none',   TRUE),
('OMMSN', 'Muscat',                'OM', 'Muscat',         23.62300,  58.58700, 'seaport', 'medium',     'Panamax',    TRUE, TRUE, TRUE, TRUE, TRUE, 'small',  TRUE),

-- ── Asia Pacific ──────────────────────────────────────────────────────────────
('SGSIN', 'Singapore',             'SG', 'Singapore',       1.26000, 103.83000, 'seaport', 'very large', 'ULCC',       TRUE, TRUE, TRUE, TRUE, TRUE, 'large',  TRUE),
('CNSHA', 'Shanghai',              'CN', 'Shanghai',       31.23000, 121.47000, 'seaport', 'very large', 'VLCC',       TRUE, TRUE, TRUE, TRUE, TRUE, 'large',  TRUE),
('CNNJG', 'Ningbo-Zhoushan',       'CN', 'Zhejiang',       29.86700, 121.55000, 'seaport', 'very large', 'VLCC',       TRUE, TRUE, TRUE, TRUE, TRUE, 'large',  TRUE),
('CNQIN', 'Qingdao',               'CN', 'Shandong',       36.09000, 120.38000, 'seaport', 'large',      'VLCC',       TRUE, TRUE, TRUE, TRUE, TRUE, 'large',  TRUE),
('CNTXG', 'Tianjin',               'CN', 'Tianjin',        39.02000, 117.72000, 'seaport', 'large',      'VLCC',       TRUE, TRUE, TRUE, TRUE, TRUE, 'large',  TRUE),
('JPYOK', 'Yokohama',              'JP', 'Kanagawa',       35.44000, 139.64000, 'seaport', 'large',      'VLCC',       TRUE, TRUE, TRUE, TRUE, TRUE, 'large',  TRUE),
('KRINC', 'Incheon',               'KR', 'Gyeonggi',       37.46000, 126.62000, 'seaport', 'large',      'VLCC',       TRUE, TRUE, TRUE, TRUE, TRUE, 'large',  TRUE),
('KRPUS', 'Busan',                 'KR', 'Busan',          35.10000, 129.03000, 'seaport', 'very large', 'ULCC',       TRUE, TRUE, TRUE, TRUE, TRUE, 'large',  TRUE),
('MYPEN', 'Penang',                'MY', 'Penang',          5.41000, 100.34000, 'seaport', 'medium',     'Panamax',    TRUE, TRUE, TRUE, TRUE, TRUE, 'medium', TRUE),
('INKLV', 'Kandla',                'IN', 'Gujarat',        23.03000,  70.22000, 'seaport', 'large',      'VLCC',       TRUE, TRUE, TRUE, FALSE,FALSE,'none',   TRUE),
('INMUN', 'Mumbai',                'IN', 'Maharashtra',    18.94000,  72.84000, 'seaport', 'large',      'VLCC',       TRUE, TRUE, TRUE, TRUE, TRUE, 'medium', TRUE),
('AUPOR', 'Port Hedland',          'AU', 'W Australia',   -20.32000, 118.60000, 'seaport', 'large',      'Capesize',   TRUE, TRUE, TRUE, FALSE,FALSE,'none',   TRUE),

-- ── Africa ────────────────────────────────────────────────────────────────────
('ZADBN', 'Durban',                'ZA', 'KwaZulu-Natal', -29.86000,  31.03000, 'seaport', 'large',      'Panamax',    TRUE, TRUE, TRUE, TRUE, TRUE, 'large',  TRUE),
('NGAPP', 'Apapa (Lagos)',         'NG', 'Lagos',           6.45000,   3.38000, 'seaport', 'large',      'Suezmax',    TRUE, TRUE, TRUE, TRUE, FALSE,'small',  TRUE),
('EGPSD', 'Port Said',             'EG', 'Port Said',      31.27000,  32.30000, 'seaport', 'large',      'ULCC',       TRUE, TRUE, TRUE, TRUE, FALSE,'small',  TRUE),
('DZALG', 'Algiers',               'DZ', 'Algiers',        36.76000,   3.05000, 'seaport', 'medium',     'Suezmax',    TRUE, TRUE, TRUE, TRUE, FALSE,'medium', TRUE),

-- ── Americas ──────────────────────────────────────────────────name────────────
('USHSV', 'Houston',               'US', 'Texas',          29.74900,  -95.28700,'seaport', 'very large', 'VLCC',       TRUE, TRUE, TRUE, TRUE, TRUE, 'large',  TRUE),
('USNWO', 'New Orleans',           'US', 'Louisiana',      29.95000,  -90.07000,'seaport', 'large',      'Suezmax',    TRUE, TRUE, TRUE, TRUE, TRUE, 'medium', TRUE),
('USNYC', 'New York',              'US', 'New York',       40.67000,  -74.00500,'seaport', 'large',      'Panamax',    TRUE, TRUE, TRUE, TRUE, TRUE, 'large',  TRUE),
('BRSSZ', 'Santos',                'BR', 'São Paulo',     -23.95000,  -46.33000,'seaport', 'large',      'Panamax',    TRUE, TRUE, TRUE, TRUE, TRUE, 'medium', TRUE),
('COBUN', 'Buenaventura',          'CO', 'Valle del Cauca',3.88000,  -77.05000, 'seaport', 'medium',     'Panamax',    TRUE, TRUE, TRUE, TRUE, FALSE,'small',  TRUE),
('VENMO', 'Maracaibo',             'VE', 'Zulia',          10.63000,  -71.63000,'seaport', 'medium',     'Suezmax',    TRUE, TRUE, TRUE, FALSE,FALSE,'none',   TRUE),
('CADBY', 'Come By Chance',        'CA', 'Newfoundland',   47.83000,  -53.85000,'seaport', 'small',      'VLCC',       TRUE, FALSE,TRUE, FALSE,FALSE,'none',   TRUE)

ON CONFLICT (locode) DO NOTHING;
