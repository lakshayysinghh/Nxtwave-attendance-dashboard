-- Reference data. Settings can be changed later from the Settings page.
INSERT INTO degrees (code, name) VALUES
    ('BITS', 'BITS'),
    ('CDU', 'CDU');

INSERT INTO settings (key, value) VALUES
    ('band_edges', '{"amber": 60, "green": 75}'),
    ('low_threshold', '75'),
    ('niat_id_pattern', '"^N\\d{2}H\\d{2}A\\d{4}$"');
