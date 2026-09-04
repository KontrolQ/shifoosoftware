const SOFTWARE_COLUMNS = `
  s.slug, s.name, s.category_slug AS category, s.publisher_names AS publisher, s.description,
  s.homepage, s.icon_key, s.icon_hotlink_slug, s.platform_names, s.interface_names,
  s.released_on, s.end_of_life, s.minimum_cpu_slug, s.minimum_cpu_name, s.minimum_cpu_speed, s.minimum_cpu_speed_unit,
  s.minimum_ram_size, s.minimum_ram_unit, s.minimum_disk_size, s.minimum_disk_unit, s.created_at,
  s.file_count, s.bytes_held`;

const COUNTED_SOFTWARE = `
  SELECT ${SOFTWARE_COLUMNS},
         (SELECT COUNT(*) FROM versions v WHERE v.software_slug = s.slug) AS versions,
         (SELECT v.version FROM versions v WHERE v.software_slug = s.slug
          ORDER BY v.sort_order DESC, v.version DESC LIMIT 1) AS latest
  FROM catalogue_software s`;

export async function rowsOf(statement) {
  const held = await statement.all();

  return held.results ?? [];
}

export function categories(database) {
  return rowsOf(
    database.prepare(`
      SELECT c.slug, c.name, c.summary,
             (SELECT COUNT(*) FROM catalogue_software s WHERE s.category_slug = c.slug AND s.published = 1) AS held,
             (SELECT s.category_slug || '/' || s.slug FROM catalogue_software s
              WHERE s.category_slug = c.slug AND s.published = 1
                AND (s.icon_key IS NOT NULL OR s.icon_hotlink_slug IS NOT NULL)
              ORDER BY s.sort_order, s.name LIMIT 1) AS icon_from
      FROM categories c ORDER BY c.sort_order, c.name`)
  );
}

export function stockedCategories(database) {
  return rowsOf(
    database.prepare(`
      SELECT c.slug, c.name, c.summary,
             (SELECT COUNT(*) FROM catalogue_software s WHERE s.category_slug = c.slug AND s.published = 1) AS held,
             (SELECT s.category_slug || '/' || s.slug FROM catalogue_software s
              WHERE s.category_slug = c.slug AND s.published = 1
                AND (s.icon_key IS NOT NULL OR s.icon_hotlink_slug IS NOT NULL)
              ORDER BY s.sort_order, s.name LIMIT 1) AS icon_from
      FROM categories c
      WHERE (SELECT COUNT(*) FROM catalogue_software s WHERE s.category_slug = c.slug AND s.published = 1) > 0
      ORDER BY c.sort_order, c.name`)
  );
}

export function categoryBySlug(database, slug) {
  return database
    .prepare(`
      SELECT c.slug, c.name, c.summary,
             (SELECT s.category_slug || '/' || s.slug FROM catalogue_software s
              WHERE s.category_slug = c.slug AND s.published = 1
                AND (s.icon_key IS NOT NULL OR s.icon_hotlink_slug IS NOT NULL)
              ORDER BY s.sort_order, s.name LIMIT 1) AS icon_from
      FROM categories c WHERE c.slug = ?`)
    .bind(slug)
    .first();
}

export function platforms(database) {
  return rowsOf(
    database.prepare(`
      SELECT p.slug AS value, p.name FROM platforms p
      WHERE EXISTS (SELECT 1 FROM software_platforms sp WHERE sp.platform_slug = p.slug)
      ORDER BY p.sort_order, p.name`)
  );
}

export function languages(database) {
  return rowsOf(
    database.prepare(`
      SELECT l.slug AS value, l.name FROM languages l
      WHERE EXISTS (SELECT 1 FROM file_languages fl WHERE fl.language_slug = l.slug)
      ORDER BY l.sort_order, l.name`)
  );
}

export function distinctPublishers(database) {
  return rowsOf(
    database.prepare(`
      SELECT p.slug, p.name FROM publishers p
      WHERE EXISTS (SELECT 1 FROM software_publishers sp WHERE sp.publisher_slug = p.slug)
      ORDER BY p.sort_order, p.name`)
  );
}

export function distinctExtensions(database) {
  return rowsOf(
    database.prepare(
      `SELECT t.slug AS value, t.name FROM file_types t
       WHERE EXISTS (SELECT 1 FROM files f WHERE f.file_type_slug = t.slug AND f.published = 1)
       ORDER BY t.sort_order, t.name`
    )
  );
}

export function releaseYears(database) {
  return rowsOf(
    database.prepare(`
      SELECT DISTINCT substr(released_on, 1, 4) AS year FROM versions
      WHERE released_on IS NOT NULL AND released_on <> '' ORDER BY year DESC`)
  );
}

export function softwareInCategory(database, category) {
  return rowsOf(
    database
      .prepare(`${COUNTED_SOFTWARE} WHERE s.published = 1 AND s.category_slug = ? ORDER BY s.name`)
      .bind(category)
  );
}

export function softwareBySlug(database, category, slug) {
  return database
    .prepare(`${COUNTED_SOFTWARE} WHERE s.published = 1 AND s.category_slug = ? AND s.slug = ?`)
    .bind(category, slug)
    .first();
}

export function recentSoftware(database, limit) {
  return rowsOf(
    database
      .prepare(`${COUNTED_SOFTWARE} WHERE s.published = 1 ORDER BY s.created_at DESC LIMIT ?`)
      .bind(limit)
  );
}

export function versionsOf(database, slug) {
  return rowsOf(
    database
      .prepare(`
        SELECT v.id, v.slug, v.version, v.architecture, v.platform_names, v.released_on, v.notes,
               v.file_count AS files, v.bytes_held AS total_bytes
        FROM catalogue_versions v WHERE v.software_slug = ?
        ORDER BY v.sort_order DESC, v.version DESC`)
      .bind(slug)
  );
}

// The view is what carries the named architecture and platforms; the bare table holds
// only the slugs, so reading it left those fields blank on the page.
export function versionBySlug(database, slug, versionSlug) {
  return database
    .prepare("SELECT * FROM catalogue_versions WHERE software_slug = ? AND slug = ?")
    .bind(slug, versionSlug)
    .first();
}

// A download is addressed by slug and extension together, so either form finds it.
export function fileBySlug(database, versionId, addressed) {
  return database
    .prepare(`
      SELECT * FROM catalogue_files
      WHERE version_id = ?1 AND published = 1
        AND (slug = ?2 OR slug || COALESCE(extension, '') = ?2)`)
    .bind(versionId, addressed)
    .first();
}

export function screenshotsOfVersion(database, versionId) {
  return rowsOf(
    database
      .prepare(`
        SELECT vs.id, vs.slug, vs.caption, vs.object_key, vs.hotlink_slug, h.target_url
        FROM version_screenshots vs
        LEFT JOIN hotlinks h ON h.slug = vs.hotlink_slug
        WHERE vs.version_id = ? ORDER BY vs.sort_order, vs.slug`)
      .bind(versionId)
  );
}

export function interfacesInUse(database) {
  return rowsOf(
    database.prepare(`
      SELECT i.slug AS value, i.name FROM interfaces i
      WHERE EXISTS (SELECT 1 FROM software_interfaces si WHERE si.interface_slug = i.slug)
      ORDER BY i.sort_order, i.name`)
  );
}

export function versionByName(database, slug, version) {
  return database
    .prepare("SELECT id, version, released_on, notes FROM versions WHERE software_slug = ? AND version = ?")
    .bind(slug, version)
    .first();
}

export function filesOfVersion(database, versionId) {
  return rowsOf(
    database
      .prepare(`
        SELECT id, slug, display_name, file_type, extension, size_bytes, checksum,
               checksum_algorithm, downloads,
               object_key, hotlink_slug, external_url, is_external,
               platform_names AS platform, language_names AS language
        FROM catalogue_files
        WHERE version_id = ? AND published = 1 ORDER BY sort_order, display_name`)
      .bind(versionId)
  );
}

export function incrementDownload(database, fileId) {
  return database.prepare("UPDATE files SET downloads = downloads + 1 WHERE id = ?").bind(fileId).run();
}

export function heldCount(database) {
  return database.prepare("SELECT COUNT(*) AS held FROM software WHERE published = 1").first();
}

export function downloadTotal(database) {
  return database.prepare("SELECT COALESCE(SUM(downloads), 0) AS total FROM files").first();
}

export function lastUpdated(database) {
  return database.prepare("SELECT MAX(updated_at) AS updated FROM software").first();
}

export function fileTotal(database) {
  return database.prepare("SELECT COUNT(*) AS total FROM files WHERE published = 1").first();
}

export function visitorTotal(database) {
  return database.prepare("SELECT COALESCE(SUM(total), 0) AS total FROM visits").first();
}

export function noteVisit(database, day) {
  return database
    .prepare(
      "INSERT INTO visits (happened_on, total) VALUES (?, 1) ON CONFLICT(happened_on) DO UPDATE SET total = total + 1"
    )
    .bind(day)
    .run();
}
