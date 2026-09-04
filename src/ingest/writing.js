import { algorithmFor, noteChange, slugOf } from "../admin/shared.js";
import { relinked, slugFor, slugsFor } from "./vocabulary.js";
import { linkedTo } from "../admin/making.js";

function text(offered) {
  const held = offered == null ? "" : String(offered).trim();

  return held || null;
}

function measured(offered) {
  const size = Number(offered?.size);

  return Number.isFinite(size) && size > 0
    ? { size, unit: text(offered.unit) }
    : { size: null, unit: null };
}

function flagged(offered, byDefault) {
  return offered == null ? byDefault : (offered ? 1 : 0);
}

export async function upsertSoftware(database, manager, offered, report) {
  const name = text(offered.name);
  const slug = text(offered.slug) ?? (name ? slugOf(name) : null);

  if (!slug || !name) {
    throw new Error("Every title needs a name.");
  }

  const category = await slugFor(database, manager, "category", offered.category, report);

  if (!category) {
    throw new Error(`No category given for ${slug}.`);
  }

  const cpu = measured(offered.minimumCpuSpeed);
  const ram = measured(offered.minimumRam);
  const disk = measured(offered.minimumDisk);
  const processor = await slugFor(database, manager, "processor", offered.minimumCpu, report);
  const standing = await database.prepare("SELECT slug FROM software WHERE slug = ?").bind(slug).first();
  const now = new Date().toISOString();

  await database
    .prepare(`
      INSERT INTO software (slug, name, category, description, homepage, released_on, end_of_life,
                            minimum_cpu_slug, minimum_cpu_speed, minimum_cpu_speed_unit,
                            minimum_ram_size, minimum_ram_unit, minimum_disk_size, minimum_disk_unit,
                            published, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 9999, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        name = excluded.name, category = excluded.category, description = excluded.description,
        homepage = excluded.homepage, released_on = excluded.released_on,
        end_of_life = excluded.end_of_life, minimum_cpu_slug = excluded.minimum_cpu_slug,
        minimum_cpu_speed = excluded.minimum_cpu_speed,
        minimum_cpu_speed_unit = excluded.minimum_cpu_speed_unit,
        minimum_ram_size = excluded.minimum_ram_size, minimum_ram_unit = excluded.minimum_ram_unit,
        minimum_disk_size = excluded.minimum_disk_size, minimum_disk_unit = excluded.minimum_disk_unit,
        published = excluded.published, updated_at = excluded.updated_at`)
    .bind(slug, name, category, text(offered.description), text(offered.homepage),
          text(offered.releasedOn), text(offered.endOfLife), processor,
          cpu.size, cpu.unit, ram.size, ram.unit, disk.size, disk.unit,
          flagged(offered.published, 1), now, now)
    .run();

  for (const [kind, table, column, holds] of [
    ["publisher", "software_publishers", "publisher_slug", offered.publishers],
    ["platform", "software_platforms", "platform_slug", offered.platforms],
    ["interface", "software_interfaces", "interface_slug", offered.interfaces],
  ]) {
    if (holds == null) {
      continue;
    }

    await relinked(database, table, "software_slug", slug,
      column, await slugsFor(database, manager, kind, holds, report));
  }

  await noteChange(database, manager, `software:${slug}`, standing ? "updated" : "created", null);
  report[standing ? "changed" : "made"].push(`software:${slug}`);

  return slug;
}

export async function upsertVersion(database, manager, softwareSlug, offered, report) {
  const version = text(offered.version);
  const slug = text(offered.slug) ?? (version ? slugOf(version) : null);

  if (!slug || !version) {
    throw new Error(`Every release of ${softwareSlug} needs a version.`);
  }

  const cpu = measured(offered.minimumCpuSpeed);
  const ram = measured(offered.minimumRam);
  const disk = measured(offered.minimumDisk);

  const standing = await database
    .prepare("SELECT id FROM versions WHERE software_slug = ? AND slug = ?")
    .bind(softwareSlug, slug)
    .first();

  await database
    .prepare(`
      INSERT INTO versions (software_slug, slug, version, architecture_slug,
                            released_on, notes, minimum_cpu_slug, minimum_cpu_speed,
                            minimum_cpu_speed_unit, minimum_ram_size, minimum_ram_unit,
                            minimum_disk_size, minimum_disk_unit, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(software_slug, slug) DO UPDATE SET
        version = excluded.version, architecture_slug = excluded.architecture_slug,
        released_on = excluded.released_on,
        notes = excluded.notes, minimum_cpu_slug = excluded.minimum_cpu_slug,
        minimum_cpu_speed = excluded.minimum_cpu_speed,
        minimum_cpu_speed_unit = excluded.minimum_cpu_speed_unit,
        minimum_ram_size = excluded.minimum_ram_size, minimum_ram_unit = excluded.minimum_ram_unit,
        minimum_disk_size = excluded.minimum_disk_size,
        minimum_disk_unit = excluded.minimum_disk_unit, sort_order = excluded.sort_order`)
    .bind(softwareSlug, slug, version,
          await slugFor(database, manager, "architecture", offered.architecture, report),
          text(offered.releasedOn), text(offered.notes),
          await slugFor(database, manager, "processor", offered.minimumCpu, report),
          cpu.size, cpu.unit, ram.size, ram.unit, disk.size, disk.unit,
          Number(offered.order) || 9999)
    .run();

  const held = await database
    .prepare("SELECT id FROM versions WHERE software_slug = ? AND slug = ?")
    .bind(softwareSlug, slug)
    .first();

  // a release names the systems it runs on, and "platform" alone is still taken
  const offeredPlatforms = offered.platforms ?? offered.platform;

  if (offeredPlatforms != null) {
    await relinked(database, "version_platforms", "version_id", held.id,
      "platform_slug", await slugsFor(database, manager, "platform", offeredPlatforms, report));
  }

  await noteChange(database, manager, `path:${softwareSlug}/${slug}`, standing ? "updated" : "created", null);
  report[standing ? "changed" : "made"].push(`version:${softwareSlug}/${slug}`);

  return { id: held.id, slug, softwareSlug };
}

export async function upsertFile(database, manager, version, offered, report) {
  const displayName = text(offered.displayName);
  const slug = text(offered.slug) ?? (displayName ? slugOf(displayName) : null);

  if (!slug || !displayName) {
    throw new Error(`Every file of ${version.softwareSlug}/${version.slug} needs a display name.`);
  }

  const target = text(offered.hotlink?.url);

  if (!target || !/^https?:\/\//i.test(target)) {
    throw new Error(`${slug} needs a hotlink with a full http or https address.`);
  }

  const linked = await linkedTo(database, manager, text(offered.hotlink.name) ?? displayName, target,
    `${version.softwareSlug}/${version.slug}`);

  if (linked.made) {
    report.made.push(`hotlink:${linked.slug}`);
  }

  const checksum = text(offered.checksum);

  const standing = await database
    .prepare("SELECT id FROM files WHERE version_id = ? AND slug = ?")
    .bind(version.id, slug)
    .first();

  await database
    .prepare(`
      INSERT INTO files (version_id, slug, display_name, file_type_slug, architecture_slug,
                         object_key, hotlink_slug, size_bytes, checksum, checksum_algorithm,
                         notes, published, sort_order)
      VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?)
      ON CONFLICT(version_id, slug) DO UPDATE SET
        display_name = excluded.display_name, file_type_slug = excluded.file_type_slug,
        architecture_slug = excluded.architecture_slug, hotlink_slug = excluded.hotlink_slug,
        checksum = excluded.checksum, checksum_algorithm = excluded.checksum_algorithm,
        notes = excluded.notes, published = excluded.published, sort_order = excluded.sort_order`)
    .bind(version.id, slug, displayName,
          await slugFor(database, manager, "filetype", offered.fileType, report),
          await slugFor(database, manager, "architecture", offered.architecture, report),
          linked.slug, checksum, text(offered.checksumAlgorithm) ?? algorithmFor(checksum),
          text(offered.notes), flagged(offered.published, 1), Number(offered.order) || 100)
    .run();

  const held = await database
    .prepare("SELECT id FROM files WHERE version_id = ? AND slug = ?")
    .bind(version.id, slug)
    .first();

  if (offered.languages != null) {
    await relinked(database, "file_languages", "file_id", held.id,
      "language_slug", await slugsFor(database, manager, "language", offered.languages, report));
  }

  // A file can run in fewer places than the release that carries it, so it keeps its own
  // list. Saying nothing means it runs wherever the release does.
  if (offered.platforms != null) {
    await relinked(database, "file_platforms", "file_id", held.id,
      "platform_slug", await slugsFor(database, manager, "platform", offered.platforms, report));
  } else if (!standing) {
    await database
      .prepare(`
        INSERT OR IGNORE INTO file_platforms (file_id, platform_slug)
        SELECT ?, vp.platform_slug FROM version_platforms vp WHERE vp.version_id = ?`)
      .bind(held.id, version.id)
      .run();
  }

  // the link carries the size, so recording it against the file would let the two drift
  if (Number(offered.sizeBytes) > 0) {
    await database
      .prepare("UPDATE hotlinks SET size_bytes = ? WHERE slug = ?")
      .bind(Number(offered.sizeBytes), linked.slug)
      .run();
  }

  await noteChange(database, manager, `file:${slug}`, standing ? "updated" : "hotlinked", target);
  report[standing ? "changed" : "made"].push(`file:${version.softwareSlug}/${version.slug}/${slug}`);

  return held.id;
}
