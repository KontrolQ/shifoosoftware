-- A driver is the one kind of software whose subject is not the machine it runs on but
-- the part it drives. Nothing in the catalogue could say "this package is for a Voodoo 3",
-- so a driver could only ever be filed by the operating system it happened to support.
--
-- Hardware therefore becomes its own vocabulary. A device belongs to a vendor, which is a
-- publisher under another name, and has a kind so cards can be told from chipsets. Files
-- carry the devices they drive, because within one driver release the packages often
-- differ; the title carries the union so a driver can be found without opening it.

CREATE TABLE device_kinds (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE devices (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    vendor_slug TEXT REFERENCES publishers (slug) ON DELETE SET NULL,
    kind_slug TEXT REFERENCES device_kinds (slug) ON DELETE SET NULL,
    released_on TEXT,
    notes TEXT,
    sort_order INTEGER NOT NULL DEFAULT 100
);

CREATE INDEX devices_by_vendor ON devices (vendor_slug);
CREATE INDEX devices_by_kind ON devices (kind_slug);

CREATE TABLE file_devices (
    file_id INTEGER NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    device_slug TEXT NOT NULL REFERENCES devices (slug) ON DELETE CASCADE,
    PRIMARY KEY (file_id, device_slug)
);

CREATE TABLE software_devices (
    software_slug TEXT NOT NULL REFERENCES software (slug) ON DELETE CASCADE,
    device_slug TEXT NOT NULL REFERENCES devices (slug) ON DELETE CASCADE,
    PRIMARY KEY (software_slug, device_slug)
);

CREATE INDEX file_devices_by_device ON file_devices (device_slug);
CREATE INDEX software_devices_by_device ON software_devices (device_slug);

INSERT INTO device_kinds (slug, name, sort_order) VALUES
    ('graphics', 'Graphics card', 10),
    ('sound', 'Sound card', 20),
    ('chipset', 'Chipset', 30),
    ('storage', 'Storage controller', 40),
    ('network', 'Network adapter', 50),
    ('input', 'Input device', 60),
    ('other', 'Other hardware', 90);
