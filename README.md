# shifoosoftware

A software archive. Public catalogue of titles, versions and downloadable files,
with a management interface behind single sign-on. Runs as one Cloudflare Worker
with D1 for the catalogue and an S3-compatible store for the files.

## Running it locally

```sh
npm install
cp .dev.vars.example .dev.vars   # then fill it in
npx wrangler d1 execute shifoosoftware --local --file=schema.sql
npx wrangler d1 execute shifoosoftware --local --file=seed.sql
npm run dev
```

## Deploying

Pushing to `main` publishes the worker through GitHub Actions. The workflow also
uploads the runtime secrets, so the repository needs these set:

| Secret | What it is |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | A token with Workers and D1 edit rights |
| `CLOUDFLARE_ACCOUNT_ID` | The account the worker belongs to |
| `ADMIN_PATH` | Where the management interface answers |
| `OIDC_DISCOVERY`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT` | Signing managers in |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME` | The store files are written to |
| `S3_PUBLIC_BASE` | Where readers fetch those files from |

Their values live in `.prod.vars`, which is not committed. It matches
`.dev.vars` except for `OIDC_REDIRECT`, which points at the dev server locally
and at the site in production.

## Schema changes

The deploy applies migrations before publishing the worker, so the code never
meets a schema older than itself. Write them as numbered files in `migrations/`
and keep `schema.sql` in step for building a database from scratch.

```sh
npx wrangler d1 migrations apply shifoosoftware --local
```

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

D1 has no transaction across statements. If a document fails part way through,
what was already written stays, and the reply lists what landed.

## Files

Uploads are signed and sent straight from the browser to `S3_ENDPOINT`, so they
never pass through the worker and are not bound by its request limits. Readers
are pointed at `S3_PUBLIC_BASE`, which fronts the same bucket. The bucket needs a
policy allowing anonymous `s3:GetObject`, or public links will not resolve.
