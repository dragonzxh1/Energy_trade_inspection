-- ── Migration 013: Port draft limits & STS anchorage data ────────────────────
--
-- Adds fields needed for cargo fraud detection:
--   1. max_draft_m      — physical limit; vessels deeper than this CANNOT berth
--   2. channel_depth_m  — fairway/approach depth (may be shallower than berth)
--   3. has_sts_zone     — port has a designated STS (ship-to-ship) anchorage area
--   4. sts_zone_name    — name / LOCODE of the STS anchorage (may differ from port)
--   5. sts_authority    — authority / regulation governing STS ops at this port
--
-- Risk logic (implemented at application layer):
--   • vessel.draft > port.max_draft_m  → flag: "Vessel physically cannot berth here"
--   • contract says port berth, AIS shows STS zone → flag: "STS substitution suspected"

ALTER TABLE ports
  ADD COLUMN IF NOT EXISTS max_draft_m     NUMERIC(5, 2),   -- metres, max allowable vessel draft
  ADD COLUMN IF NOT EXISTS channel_depth_m NUMERIC(5, 2),   -- approach channel depth (MLLW)
  ADD COLUMN IF NOT EXISTS has_sts_zone    BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sts_zone_name   TEXT,            -- e.g. "Fujairah Anchorage"
  ADD COLUMN IF NOT EXISTS sts_authority   TEXT;            -- e.g. "UAE Federal Transport Authority"

-- Update seed data with known draft limits for major energy ports
-- Sources: Port Authority publications, WPI, Lloyd's List Intelligence

UPDATE ports SET max_draft_m = 23.5, channel_depth_m = 24.0, has_sts_zone = FALSE WHERE locode = 'NLRTM';  -- Rotterdam (Maasvlakte II)
UPDATE ports SET max_draft_m = 16.0, channel_depth_m = 16.5, has_sts_zone = FALSE WHERE locode = 'BEANR';  -- Antwerp
UPDATE ports SET max_draft_m = 15.6, channel_depth_m = 16.0, has_sts_zone = FALSE WHERE locode = 'DEHAM';  -- Hamburg
UPDATE ports SET max_draft_m = 16.0, channel_depth_m = 17.0, has_sts_zone = FALSE WHERE locode = 'GBSOU';  -- Southampton
UPDATE ports SET max_draft_m = 21.3, channel_depth_m = 22.0, has_sts_zone = TRUE,  sts_zone_name = 'Spithead Anchorage'           WHERE locode = 'GBLON';
UPDATE ports SET max_draft_m = 17.0, channel_depth_m = 18.0, has_sts_zone = FALSE WHERE locode = 'FRMRS';  -- Marseille
UPDATE ports SET max_draft_m = 12.5, channel_depth_m = 13.0, has_sts_zone = FALSE WHERE locode = 'ITGOA';  -- Genoa
UPDATE ports SET max_draft_m = 14.5, channel_depth_m = 15.0, has_sts_zone = FALSE WHERE locode = 'GRATH';  -- Piraeus
UPDATE ports SET max_draft_m = 18.0, channel_depth_m = 19.5, has_sts_zone = TRUE,  sts_zone_name = 'Strait of Gibraltar Anchorage' WHERE locode = 'ESALG';
UPDATE ports SET max_draft_m = 14.0, channel_depth_m = 14.5, has_sts_zone = FALSE WHERE locode = 'NOSVG';  -- Stavanger

-- Middle East (oil terminals)
UPDATE ports SET max_draft_m = 21.5, channel_depth_m = 22.0, has_sts_zone = TRUE,  sts_zone_name = 'Jebel Ali Outer Anchorage',  sts_authority = 'DP World / UAE FTA' WHERE locode = 'AEJEA';
UPDATE ports SET max_draft_m = 22.5, channel_depth_m = 23.0, has_sts_zone = TRUE,  sts_zone_name = 'Fujairah Anchorage Area',     sts_authority = 'Fujairah Port Authority' WHERE locode = 'AEFUJ';
UPDATE ports SET max_draft_m = 20.0, channel_depth_m = 21.0, has_sts_zone = TRUE,  sts_zone_name = 'Khor al-Amaya Terminal'       WHERE locode = 'IQBSR';
UPDATE ports SET max_draft_m = 18.5, channel_depth_m = 19.0, has_sts_zone = TRUE,  sts_zone_name = 'Kharg Island STS Zone'        WHERE locode = 'IRBND';
UPDATE ports SET max_draft_m = 15.0, channel_depth_m = 15.5, has_sts_zone = FALSE WHERE locode = 'KWKWI';
UPDATE ports SET max_draft_m = 21.0, channel_depth_m = 22.0, has_sts_zone = TRUE,  sts_zone_name = 'Ras Tanura STS Anchorage'     WHERE locode = 'SARAS';
UPDATE ports SET max_draft_m = 14.5, channel_depth_m = 15.0, has_sts_zone = FALSE WHERE locode = 'OMMSN';

-- Asia Pacific
UPDATE ports SET max_draft_m = 20.0, channel_depth_m = 22.0, has_sts_zone = TRUE,  sts_zone_name = 'Eastern Anchorage / Horsburgh', sts_authority = 'MPA Singapore' WHERE locode = 'SGSIN';
UPDATE ports SET max_draft_m = 20.5, channel_depth_m = 21.0, has_sts_zone = FALSE WHERE locode = 'CNSHA';
UPDATE ports SET max_draft_m = 21.0, channel_depth_m = 22.0, has_sts_zone = FALSE WHERE locode = 'CNNJG';  -- Ningbo (deepwater terminal)
UPDATE ports SET max_draft_m = 20.0, channel_depth_m = 21.0, has_sts_zone = FALSE WHERE locode = 'CNQIN';
UPDATE ports SET max_draft_m = 19.0, channel_depth_m = 20.0, has_sts_zone = FALSE WHERE locode = 'CNTXG';
UPDATE ports SET max_draft_m = 15.0, channel_depth_m = 16.0, has_sts_zone = FALSE WHERE locode = 'JPYOK';
UPDATE ports SET max_draft_m = 14.5, channel_depth_m = 15.0, has_sts_zone = FALSE WHERE locode = 'KRINC';
UPDATE ports SET max_draft_m = 16.0, channel_depth_m = 17.0, has_sts_zone = FALSE WHERE locode = 'KRPUS';
UPDATE ports SET max_draft_m = 13.0, channel_depth_m = 13.5, has_sts_zone = FALSE WHERE locode = 'MYPEN';
UPDATE ports SET max_draft_m = 14.0, channel_depth_m = 14.5, has_sts_zone = TRUE,  sts_zone_name = 'Kandla Outer Anchorage'       WHERE locode = 'INKLV';
UPDATE ports SET max_draft_m = 13.5, channel_depth_m = 14.0, has_sts_zone = FALSE WHERE locode = 'INMUN';
UPDATE ports SET max_draft_m = 20.0, channel_depth_m = 21.0, has_sts_zone = FALSE WHERE locode = 'AUPOR';  -- Port Hedland (iron ore)

-- Africa
UPDATE ports SET max_draft_m = 14.0, channel_depth_m = 14.5, has_sts_zone = FALSE WHERE locode = 'ZADBN';
UPDATE ports SET max_draft_m = 12.5, channel_depth_m = 13.0, has_sts_zone = FALSE WHERE locode = 'NGAPP';
UPDATE ports SET max_draft_m = 18.0, channel_depth_m = 19.0, has_sts_zone = TRUE,  sts_zone_name = 'Port Said Outer Anchorage'    WHERE locode = 'EGPSD';
UPDATE ports SET max_draft_m = 12.0, channel_depth_m = 12.5, has_sts_zone = FALSE WHERE locode = 'DZALG';

-- Americas
UPDATE ports SET max_draft_m = 14.6, channel_depth_m = 15.0, has_sts_zone = TRUE,  sts_zone_name = 'Galveston Offshore STS Area',  sts_authority = 'USCG District 8' WHERE locode = 'USHSV';
UPDATE ports SET max_draft_m = 14.0, channel_depth_m = 14.5, has_sts_zone = TRUE,  sts_zone_name = 'Southwest Pass Anchorage'      WHERE locode = 'USNWO';
UPDATE ports SET max_draft_m = 15.0, channel_depth_m = 15.5, has_sts_zone = FALSE WHERE locode = 'USNYC';
UPDATE ports SET max_draft_m = 15.0, channel_depth_m = 15.5, has_sts_zone = FALSE WHERE locode = 'BRSSZ';
UPDATE ports SET max_draft_m = 13.5, channel_depth_m = 14.0, has_sts_zone = FALSE WHERE locode = 'COBUN';
UPDATE ports SET max_draft_m = 12.0, channel_depth_m = 12.5, has_sts_zone = TRUE,  sts_zone_name = 'Lake Maracaibo Bar Anchorage'  WHERE locode = 'VENMO';
UPDATE ports SET max_draft_m = 22.0, channel_depth_m = 23.0, has_sts_zone = FALSE WHERE locode = 'CADBY';  -- Come By Chance (VLCC terminal)

-- ── STS-only anchorage zones (not full ports, but common transfer locations) ──
-- These are coordinates where STS operations frequently occur.
-- They are NOT full ports — no berth, no terminal services.
INSERT INTO ports (locode, name, country, lat, lng, port_type, size, is_energy_hub, has_sts_zone, sts_zone_name, sts_authority, max_draft_m) VALUES
  ('MTSTS', 'Malta STS Anchorage',          'MT',  35.88000,  14.52000, 'anchorage', 'large', TRUE, TRUE, 'Malta Freeport STS Zone',        'Transport Malta', 30.0),
  ('EEPTS', 'Ceuta STS Anchorage',           'ES',  35.89000,  -5.32000, 'anchorage', 'large', TRUE, TRUE, 'Strait of Gibraltar STS',        'Ceuta Port Authority', 28.0),
  ('SGPJB', 'Johor Strait Anchorage',        'SG',   1.28000, 103.64000, 'anchorage', 'large', TRUE, TRUE, 'Western Johor Strait',           'MPA Singapore', 20.0),
  ('MYSTS', 'Labuan STS Anchorage',          'MY',   5.31000, 115.24000, 'anchorage', 'medium', TRUE, TRUE, 'Labuan STS Zone',                NULL, 22.0),
  ('GRSTS', 'Kalamata STS Anchorage',        'GR',  36.96000,  22.12000, 'anchorage', 'large', TRUE, TRUE, 'Laconian Gulf STS',              NULL, 30.0),
  ('SGCYL', 'Colombo Outer Anchorage',       'LK',   6.93000,  79.84000, 'anchorage', 'large', FALSE, TRUE, 'Colombo Offshore STS',          'SLPA', 22.0),
  ('SOSTS', 'Sokhna STS Anchorage',          'EG',  29.59000,  32.35000, 'anchorage', 'large', TRUE, TRUE, 'Red Sea Gulf of Suez STS',       'SCA Egypt', 25.0)
ON CONFLICT (locode) DO NOTHING;
