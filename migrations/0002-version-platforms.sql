DROP VIEW IF EXISTS catalogue_software;
DROP VIEW IF EXISTS catalogue_versions;
DROP VIEW IF EXISTS catalogue_files;

CREATE TABLE version_platforms (
    version_id INTEGER NOT NULL REFERENCES versions (id) ON DELETE CASCADE,
    platform_slug TEXT NOT NULL REFERENCES platforms (slug) ON DELETE CASCADE,
    PRIMARY KEY (version_id, platform_slug)
);

INSERT INTO version_platforms (version_id, platform_slug)
SELECT id, platform_slug FROM versions WHERE platform_slug IS NOT NULL AND platform_slug <> '';

ALTER TABLE versions DROP COLUMN platform_slug;

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
    v.architecture_slug,
    (SELECT a.name FROM architectures a WHERE a.slug = v.architecture_slug) AS architecture,
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
    f.version_id,
    v.slug AS version_slug,
    v.version,
    -- a file carries its own architecture where it differs from the release's
    COALESCE(f.architecture_slug, v.architecture_slug) AS architecture_slug,
    f.architecture_slug AS own_architecture_slug,
    (SELECT a.name FROM architectures a
     WHERE a.slug = COALESCE(f.architecture_slug, v.architecture_slug)) AS architecture,
    v.software_slug,
    s.name AS software_name,
    s.category AS category_slug,
    -- a file runs wherever its release runs, which is narrower than the title's platforms
    (SELECT group_concat(p.name, ', ')
     FROM version_platforms vp JOIN platforms p ON p.slug = vp.platform_slug
     WHERE vp.version_id = v.id) AS platform_names,
    (SELECT group_concat(l.name, ', ') FROM file_languages fl JOIN languages l ON l.slug = fl.language_slug
     WHERE fl.file_id = f.id) AS language_names
FROM files f
JOIN versions v ON v.id = f.version_id
JOIN software s ON s.slug = v.software_slug
LEFT JOIN hotlinks h ON h.slug = f.hotlink_slug;
