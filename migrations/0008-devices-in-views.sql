-- The pages read the views, so the hardware a file drives has to reach them there.

DROP VIEW IF EXISTS catalogue_software;
DROP VIEW IF EXISTS catalogue_files;

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
    (SELECT group_concat(a.name, ', ')
     FROM file_architectures fa JOIN architectures a ON a.slug = fa.architecture_slug
     WHERE fa.file_id = f.id) AS architecture,
    v.software_slug,
    s.name AS software_name,
    s.category AS category_slug,
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
