-- A title's architectures are its releases' architectures, and the pages ask the view
-- rather than counting them again on every request.

DROP VIEW IF EXISTS catalogue_software;

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
    (SELECT group_concat(held, ', ') FROM
       (SELECT DISTINCT a.name AS held
        FROM versions v
        JOIN version_architectures va ON va.version_id = v.id
        JOIN architectures a ON a.slug = va.architecture_slug
        WHERE v.software_slug = s.slug
        ORDER BY a.sort_order, a.name)) AS architecture_names,
    (SELECT COUNT(*) FROM versions v WHERE v.software_slug = s.slug) AS version_count,
    (SELECT COUNT(*) FROM files f JOIN versions v ON v.id = f.version_id
     WHERE v.software_slug = s.slug) AS file_count,
    (SELECT COALESCE(SUM(cf.size_bytes), 0) FROM catalogue_files cf
     WHERE cf.software_slug = s.slug) AS bytes_held,
    (SELECT COALESCE(SUM(f.downloads), 0) FROM files f JOIN versions v ON v.id = f.version_id
     WHERE v.software_slug = s.slug) AS downloads
FROM software s
LEFT JOIN categories c ON c.slug = s.category;
