-- A release and the files inside it do not always run in the same places. DirectX 9.0c*
-- holds seventeen monthly packages that drop Windows 98 SE part way through and pick up
-- Vista later, and Windows Media Player 7.0 runs on Windows 95 where 7.1 does not.
-- Platforms therefore belong to the file, not only to the release that carries it.

DROP VIEW IF EXISTS catalogue_files;

CREATE TABLE file_platforms (
    file_id INTEGER NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    platform_slug TEXT NOT NULL REFERENCES platforms (slug) ON DELETE CASCADE,
    PRIMARY KEY (file_id, platform_slug)
);

CREATE INDEX file_platforms_by_platform ON file_platforms (platform_slug);

-- Every file starts out where its release ran, which is exactly what the catalogue
-- claimed before this table existed. Only the ones that differ need correcting after.
INSERT INTO file_platforms (file_id, platform_slug)
SELECT f.id, vp.platform_slug
FROM files f
JOIN version_platforms vp ON vp.version_id = f.version_id;

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
