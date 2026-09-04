-- 0004 gave files a sort_order, but the view the pages read did not carry it,
-- so ordering by it failed every version page.

DROP VIEW IF EXISTS catalogue_files;

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
    COALESCE(f.architecture_slug, v.architecture_slug) AS architecture_slug,
    f.architecture_slug AS own_architecture_slug,
    (SELECT a.name FROM architectures a
     WHERE a.slug = COALESCE(f.architecture_slug, v.architecture_slug)) AS architecture,
    v.software_slug,
    s.name AS software_name,
    s.category AS category_slug,
    -- a file runs where the file runs, which can be narrower than its release
    (SELECT group_concat(p.name, ', ')
     FROM file_platforms fp JOIN platforms p ON p.slug = fp.platform_slug
     WHERE fp.file_id = f.id) AS platform_names,
    (SELECT group_concat(l.name, ', ') FROM file_languages fl JOIN languages l ON l.slug = fl.language_slug
     WHERE fl.file_id = f.id) AS language_names
FROM files f
JOIN versions v ON v.id = f.version_id
JOIN software s ON s.slug = v.software_slug
LEFT JOIN hotlinks h ON h.slug = f.hotlink_slug;
