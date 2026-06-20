-- OpenRef — données initiales
-- Sources de scraping Land Rover

INSERT INTO source (id, name, url, origine, devise, inc_vat, method, marques, actif) VALUES
  ('jc',  'JohnCraddock',  'https://www.johncraddock.co.uk',         'UK', 'GBP', false, 'api',     ARRAY['landrover'], true),
  ('lp',  'LRParts',       'https://www.lrparts.net',                'UK', 'GBP', false, 'api',     ARRAY['landrover'], true),
  ('ls',  'LandService',   'https://www.land-service.fr',            'FR', 'EUR', true,  'api',     ARRAY['landrover'], true),
  ('bol', 'BestOfLand',    'https://www.bestofland.com',             'FR', 'EUR', true,  'api',     ARRAY['landrover'], true),
  ('rp',  'RoverParts',    'https://www.roverparts.co.uk',           'UK', 'GBP', false, 'api',     ARRAY['landrover'], true),
  ('sf',  'SeriesForever', 'https://www.seriesforever.com',          'BE', 'EUR', true,  'html',    ARRAY['landrover'], true),
  ('pad', 'PaddockSpares', 'https://www.paddockspares.com',          'UK', 'GBP', false, 'html',    ARRAY['landrover'], true),
  ('bp',  'BritishParts',  'https://www.britishparts.co.uk',         'UK', 'GBP', false, 'html',    ARRAY['landrover'], true)
ON CONFLICT (id) DO NOTHING;
