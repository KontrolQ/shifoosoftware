DROP VIEW IF EXISTS catalogue_files;
DROP VIEW IF EXISTS catalogue_versions;
DROP VIEW IF EXISTS catalogue_software;
DROP VIEW IF EXISTS catalogue_hotlinks;

DROP TABLE IF EXISTS file_languages;
DROP TABLE IF EXISTS version_platforms;
DROP TABLE IF EXISTS file_platforms;
DROP TABLE IF EXISTS version_screenshots;
DROP TABLE IF EXISTS files;
DROP TABLE IF EXISTS versions;
DROP TABLE IF EXISTS software_interfaces;
DROP TABLE IF EXISTS software_platforms;
DROP TABLE IF EXISTS software_publishers;
DROP TABLE IF EXISTS software;
DROP TABLE IF EXISTS hotlinks;
DROP TABLE IF EXISTS visits;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS platforms;
DROP TABLE IF EXISTS languages;
DROP TABLE IF EXISTS interfaces;
DROP TABLE IF EXISTS architectures;
DROP TABLE IF EXISTS file_types;
DROP TABLE IF EXISTS processors;
DROP TABLE IF EXISTS publishers;
DROP TABLE IF EXISTS saved_views;
DROP TABLE IF EXISTS changes;
DROP TABLE IF EXISTS api_keys;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS managers;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS requests;

CREATE TABLE visits (
    happened_on TEXT PRIMARY KEY,
    total INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE categories (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    summary TEXT,
    sort_order INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE platforms (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE languages (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE interfaces (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE architectures (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE file_types (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    extension TEXT,
    sort_order INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE processors (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE publishers (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE hotlinks (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    target_url TEXT NOT NULL,
    size_bytes INTEGER,
    notes TEXT,
    added_at TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE software (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL REFERENCES categories (slug),
    description TEXT,
    homepage TEXT,
    icon_key TEXT,
    icon_hotlink_slug TEXT REFERENCES hotlinks (slug) ON DELETE SET NULL,
    released_on TEXT,
    end_of_life TEXT,
    minimum_cpu_slug TEXT REFERENCES processors (slug) ON DELETE SET NULL,
    minimum_cpu_speed INTEGER,
    minimum_cpu_speed_unit TEXT,
    minimum_ram_size INTEGER,
    minimum_ram_unit TEXT,
    minimum_disk_size INTEGER,
    minimum_disk_unit TEXT,
    published INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 100,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE software_publishers (
    software_slug TEXT NOT NULL REFERENCES software (slug) ON DELETE CASCADE,
    publisher_slug TEXT NOT NULL REFERENCES publishers (slug) ON DELETE CASCADE,
    PRIMARY KEY (software_slug, publisher_slug)
);

CREATE TABLE software_platforms (
    software_slug TEXT NOT NULL REFERENCES software (slug) ON DELETE CASCADE,
    platform_slug TEXT NOT NULL REFERENCES platforms (slug) ON DELETE CASCADE,
    PRIMARY KEY (software_slug, platform_slug)
);

CREATE TABLE software_interfaces (
    software_slug TEXT NOT NULL REFERENCES software (slug) ON DELETE CASCADE,
    interface_slug TEXT NOT NULL REFERENCES interfaces (slug) ON DELETE CASCADE,
    PRIMARY KEY (software_slug, interface_slug)
);

CREATE TABLE versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    software_slug TEXT NOT NULL REFERENCES software (slug) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    version TEXT NOT NULL,
    released_on TEXT,
    notes TEXT,
    minimum_cpu_slug TEXT REFERENCES processors (slug) ON DELETE SET NULL,
    minimum_cpu_speed INTEGER,
    minimum_cpu_speed_unit TEXT,
    minimum_ram_size INTEGER,
    minimum_ram_unit TEXT,
    minimum_disk_size INTEGER,
    minimum_disk_unit TEXT,
    sort_order INTEGER NOT NULL DEFAULT 100,
    UNIQUE (software_slug, slug)
);

CREATE TABLE version_platforms (
    version_id INTEGER NOT NULL REFERENCES versions (id) ON DELETE CASCADE,
    platform_slug TEXT NOT NULL REFERENCES platforms (slug) ON DELETE CASCADE,
    PRIMARY KEY (version_id, platform_slug)
);

CREATE TABLE version_screenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_id INTEGER NOT NULL REFERENCES versions (id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    caption TEXT,
    object_key TEXT,
    hotlink_slug TEXT REFERENCES hotlinks (slug) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 100,
    UNIQUE (version_id, slug)
);

CREATE TABLE files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_id INTEGER NOT NULL REFERENCES versions (id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    display_name TEXT NOT NULL,
    file_type_slug TEXT REFERENCES file_types (slug) ON DELETE SET NULL,
    object_key TEXT,
    hotlink_slug TEXT REFERENCES hotlinks (slug) ON DELETE SET NULL,
    size_bytes INTEGER,
    checksum TEXT,
    checksum_algorithm TEXT,
    notes TEXT,
    published INTEGER NOT NULL DEFAULT 1,
    downloads INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 100,
    UNIQUE (version_id, slug)
);

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

CREATE TABLE version_architectures (
    version_id INTEGER NOT NULL REFERENCES versions (id) ON DELETE CASCADE,
    architecture_slug TEXT NOT NULL REFERENCES architectures (slug) ON DELETE CASCADE,
    PRIMARY KEY (version_id, architecture_slug)
);

CREATE TABLE file_architectures (
    file_id INTEGER NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    architecture_slug TEXT NOT NULL REFERENCES architectures (slug) ON DELETE CASCADE,
    PRIMARY KEY (file_id, architecture_slug)
);

CREATE TABLE file_platforms (
    file_id INTEGER NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    platform_slug TEXT NOT NULL REFERENCES platforms (slug) ON DELETE CASCADE,
    PRIMARY KEY (file_id, platform_slug)
);

CREATE INDEX file_platforms_by_platform ON file_platforms (platform_slug);

CREATE TABLE file_languages (
    file_id INTEGER NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    language_slug TEXT NOT NULL REFERENCES languages (slug) ON DELETE CASCADE,
    PRIMARY KEY (file_id, language_slug)
);

CREATE TABLE roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    permissions TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE managers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT UNIQUE,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT,
    role_id INTEGER REFERENCES roles (id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT
);

CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    manager_id INTEGER NOT NULL REFERENCES managers (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE TABLE api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manager_id INTEGER NOT NULL REFERENCES managers (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    opening TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT
);

CREATE TABLE changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    happened_at TEXT NOT NULL,
    manager_id INTEGER REFERENCES managers (id) ON DELETE SET NULL,
    subject TEXT NOT NULL,
    deed TEXT NOT NULL,
    detail TEXT
);

CREATE TABLE saved_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manager_id INTEGER NOT NULL REFERENCES managers (id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    query TEXT NOT NULL,
    UNIQUE (manager_id, kind, name)
);

CREATE TABLE requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    publisher TEXT,
    wanted_version TEXT,
    notes TEXT,
    link TEXT,
    asked_by TEXT,
    happened_at TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open'
);

CREATE INDEX software_by_category ON software (category, name);
CREATE INDEX software_by_name ON software (name);
CREATE INDEX versions_by_software ON versions (software_slug, sort_order);
CREATE INDEX files_by_version ON files (version_id);
CREATE INDEX sessions_by_manager ON sessions (manager_id);
CREATE INDEX api_keys_by_manager ON api_keys (manager_id);
CREATE INDEX changes_by_time ON changes (happened_at DESC);
CREATE INDEX requests_by_state ON requests (state, happened_at DESC);
CREATE INDEX screenshots_by_version ON version_screenshots (version_id, sort_order);

CREATE VIEW catalogue_hotlinks AS
SELECT
    h.slug,
    h.name,
    h.target_url,
    h.size_bytes,
    h.notes,
    h.added_at,
    h.sort_order,
    (SELECT COUNT(*) FROM files f WHERE f.hotlink_slug = h.slug) AS file_count,
    (SELECT COUNT(*) FROM software s WHERE s.icon_hotlink_slug = h.slug) AS icon_count,
    (SELECT COUNT(*) FROM version_screenshots vs WHERE vs.hotlink_slug = h.slug) AS screenshot_count
FROM hotlinks h;

CREATE VIEW catalogue_software AS
SELECT
    s.slug,
    s.name,
    s.category AS category_slug,
    c.name AS category_name,
    s.description,
    s.homepage,
    s.icon_key,
    s.icon_hotlink_slug,
    s.released_on,
    s.end_of_life,
    s.minimum_cpu_slug,
    (SELECT p.name FROM processors p WHERE p.slug = s.minimum_cpu_slug) AS minimum_cpu_name,
    s.minimum_cpu_speed,
    s.minimum_cpu_speed_unit,
    s.minimum_ram_size,
    s.minimum_ram_unit,
    s.minimum_disk_size,
    s.minimum_disk_unit,
    -- ranges are compared in one unit, so a filter never has to know how it was typed
    s.minimum_ram_size * CASE s.minimum_ram_unit
      WHEN 'KB' THEN 1024 WHEN 'MB' THEN 1048576
      WHEN 'GB' THEN 1073741824 WHEN 'TB' THEN 1099511627776 ELSE 1 END AS minimum_ram_bytes,
    s.minimum_disk_size * CASE s.minimum_disk_unit
      WHEN 'KB' THEN 1024 WHEN 'MB' THEN 1048576
      WHEN 'GB' THEN 1073741824 WHEN 'TB' THEN 1099511627776 ELSE 1 END AS minimum_disk_bytes,
    s.minimum_cpu_speed * CASE s.minimum_cpu_speed_unit
      WHEN 'MHz' THEN 1000000 WHEN 'GHz' THEN 1000000000 ELSE 1 END AS minimum_cpu_hertz,
    s.published,
    s.sort_order,
    s.created_at,
    s.updated_at,
    (SELECT group_concat(p.name, ', ')
     FROM software_publishers sp JOIN publishers p ON p.slug = sp.publisher_slug
     WHERE sp.software_slug = s.slug) AS publisher_names,
    (SELECT group_concat(p.name, ', ')
     FROM software_platforms spl JOIN platforms p ON p.slug = spl.platform_slug
     WHERE spl.software_slug = s.slug) AS platform_names,
    (SELECT group_concat(i.name, ', ')
     FROM software_interfaces si JOIN interfaces i ON i.slug = si.interface_slug
     WHERE si.software_slug = s.slug) AS interface_names,
    (SELECT group_concat(d.name, ', ')
     FROM software_devices sd JOIN devices d ON d.slug = sd.device_slug
     WHERE sd.software_slug = s.slug) AS device_names,
    (SELECT COUNT(*) FROM versions v WHERE v.software_slug = s.slug) AS version_count,
    (SELECT COUNT(*) FROM files f JOIN versions v ON v.id = f.version_id
     WHERE v.software_slug = s.slug) AS file_count,
    (SELECT COALESCE(SUM(cf.size_bytes), 0) FROM catalogue_files cf
     WHERE cf.software_slug = s.slug) AS bytes_held,
    (SELECT COALESCE(SUM(f.downloads), 0) FROM files f JOIN versions v ON v.id = f.version_id
     WHERE v.software_slug = s.slug) AS downloads
FROM software s
LEFT JOIN categories c ON c.slug = s.category;

CREATE VIEW catalogue_versions AS
SELECT
    v.id,
    v.slug,
    v.version,
    (SELECT group_concat(a.name, ', ')
     FROM version_architectures va JOIN architectures a ON a.slug = va.architecture_slug
     WHERE va.version_id = v.id) AS architecture,
    (SELECT group_concat(p.name, ', ')
     FROM version_platforms vp JOIN platforms p ON p.slug = vp.platform_slug
     WHERE vp.version_id = v.id) AS platform_names,
    v.released_on,
    v.notes,
    v.sort_order,
    v.minimum_cpu_slug,
    (SELECT p.name FROM processors p WHERE p.slug = v.minimum_cpu_slug) AS minimum_cpu_name,
    v.minimum_cpu_speed,
    v.minimum_cpu_speed_unit,
    v.minimum_ram_size,
    v.minimum_ram_unit,
    v.minimum_disk_size,
    v.minimum_disk_unit,
    v.minimum_ram_size * CASE v.minimum_ram_unit
      WHEN 'KB' THEN 1024 WHEN 'MB' THEN 1048576
      WHEN 'GB' THEN 1073741824 WHEN 'TB' THEN 1099511627776 ELSE 1 END AS minimum_ram_bytes,
    v.minimum_disk_size * CASE v.minimum_disk_unit
      WHEN 'KB' THEN 1024 WHEN 'MB' THEN 1048576
      WHEN 'GB' THEN 1073741824 WHEN 'TB' THEN 1099511627776 ELSE 1 END AS minimum_disk_bytes,
    v.minimum_cpu_speed * CASE v.minimum_cpu_speed_unit
      WHEN 'MHz' THEN 1000000 WHEN 'GHz' THEN 1000000000 ELSE 1 END AS minimum_cpu_hertz,
    v.software_slug,
    s.name AS software_name,
    s.category AS category_slug,
    s.published AS software_published,
    (SELECT COUNT(*) FROM files f WHERE f.version_id = v.id) AS file_count,
    (SELECT COUNT(*) FROM version_screenshots vs WHERE vs.version_id = v.id) AS screenshot_count,
    (SELECT COALESCE(SUM(cf.size_bytes), 0) FROM catalogue_files cf WHERE cf.version_id = v.id) AS bytes_held
FROM versions v
JOIN software s ON s.slug = v.software_slug;

CREATE VIEW catalogue_files AS
SELECT
    f.id,
    f.slug,
    f.display_name,
    f.file_type_slug,
    (SELECT t.name FROM file_types t WHERE t.slug = f.file_type_slug) AS file_type,
    (SELECT t.extension FROM file_types t WHERE t.slug = f.file_type_slug) AS extension,
    f.object_key,
    f.hotlink_slug,
    h.target_url AS external_url,
    h.name AS hotlink_name,
    CASE WHEN f.hotlink_slug IS NOT NULL THEN 1 ELSE 0 END AS is_external,
    CASE WHEN f.hotlink_slug IS NOT NULL THEN h.size_bytes ELSE f.size_bytes END AS size_bytes,
    f.checksum,
    f.checksum_algorithm,
    f.notes,
    f.published,
    f.downloads,
    f.sort_order,
    f.version_id,
    v.slug AS version_slug,
    v.version,
    -- a file carries its own architecture where it differs from the release's
    (SELECT group_concat(a.name, ', ')
     FROM file_architectures fa JOIN architectures a ON a.slug = fa.architecture_slug
     WHERE fa.file_id = f.id) AS architecture,
    v.software_slug,
    s.name AS software_name,
    s.category AS category_slug,
    -- a file runs wherever its release runs, which is narrower than the title's platforms
    (SELECT group_concat(p.name, ', ')
     FROM file_platforms fp JOIN platforms p ON p.slug = fp.platform_slug
     WHERE fp.file_id = f.id) AS platform_names,
    (SELECT group_concat(d.name, ', ')
     FROM file_devices fd JOIN devices d ON d.slug = fd.device_slug
     WHERE fd.file_id = f.id) AS device_names,
    (SELECT group_concat(l.name, ', ') FROM file_languages fl JOIN languages l ON l.slug = fl.language_slug
     WHERE fl.file_id = f.id) AS language_names
FROM files f
JOIN versions v ON v.id = f.version_id
JOIN software s ON s.slug = v.software_slug
LEFT JOIN hotlinks h ON h.slug = f.hotlink_slug;
