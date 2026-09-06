# shifoosoftware

A software archive: a public catalogue of titles, versions and downloadable
files, with a management interface behind single sign-on.

It needs two things to run: a libSQL database for the catalogue, and an
S3-compatible bucket for the files. Both are given as environment variables, so
you choose where each one lives. [sqldash](https://github.com/KontrolQ/sqldash)
can serve the database if you would rather host it yourself.

## Running it locally

```sh
npm install
cp .dev.vars.example .dev.vars   # then fill it in
node scripts/loaddump.mjs schema.sql
node scripts/loaddump.mjs seed.sql
npm run dev
```

## Deploying

Pushing to `main` publishes the worker through GitHub Actions. The workflow also
uploads the runtime secrets, so the repository needs these set:

| Secret | What it is |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | A token with Workers edit rights |
| `CLOUDFLARE_ACCOUNT_ID` | The account the worker belongs to |
| `CATALOGUE_URL`, `CATALOGUE_TOKEN` | The libSQL server holding the catalogue |
| `ADMIN_PATH` | Where the management interface answers |
| `OIDC_DISCOVERY`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT` | Signing managers in |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME` | The store files are written to |
| `S3_PUBLIC_BASE` | Where readers fetch those files from |

## Schema changes

The deploy applies migrations before publishing the worker, so the code never
meets a schema older than itself. Write them as numbered files in `migrations/`
and keep `schema.sql` in step for building a database from scratch.

```sh
node scripts/migrate.mjs            # apply anything outstanding
node scripts/migrate.mjs --dry-run  # say what would be applied, change nothing
```

What has already run is recorded in the database, so nothing is applied twice. Do
not run a migration by hand: the deploy replays the same files, and one already
applied out of band fails it.

## Ingest

`POST /ingest` takes a JSON document describing one title, its versions and
their files. Running the same document twice updates the rows rather than
duplicating them, so it is safe to re-run.

Taxonomies are given by name, not by slug. Categories, publishers, platforms,
languages, architectures, processors and file types are created if the
catalogue does not have them yet. Hotlinks are matched on their target address.

```json
{ "source": "https://example.com/product/thing",
  "software": { "slug": "ms-dos", "name": "MS-DOS",
                "category": { "name": "OS" },
                "publishers": [{ "name": "Microsoft" }] },
  "versions": [ { "slug": "622", "version": "6.22",
                  "files": [ { "displayName": "Setup disks",
                               "hotlink": { "name": "disks.7z",
                                            "url": "https://example.com/dl/1" } } ] } ] }
```

Authentication is a key sent as `Authorization: Bearer`. Mint keys under the
management interface at `/keys`. The key is shown once and only its hash is
kept. A key acts as whoever minted it, so it cannot reach further than they can.

Nothing in a document is written inside a transaction. If one fails part way
through, what was already written stays, and the reply lists what landed.

## Files

Uploads are signed and sent straight from the browser to `S3_ENDPOINT`, so they
never pass through the worker and are not bound by its request limits. Readers
are pointed at `S3_PUBLIC_BASE`, which fronts the same bucket. The bucket needs a
policy allowing anonymous `s3:GetObject`, or public links will not resolve.

The storage page also asks the store how large the disk under it is, through the
admin API an S3-compatible server may offer. Servers spell that reply differently
and the common spellings are accepted. A store that answers none of them leaves
the page reporting only what the bucket holds, and `STORAGE_ALLOWANCE` set on the
worker states a ceiling by hand.
