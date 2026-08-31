# shifoosoftware

A software archive: a public catalogue of titles, versions and downloadable
files, with a management interface behind single sign-on. It runs as one
Cloudflare Worker, with D1 for the catalogue and an S3-compatible store for the
files.

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

Their values live in `.prod.vars`, which is the production counterpart to
`.dev.vars` and is not committed. The two differ in `OIDC_REDIRECT`: locally it
is the dev server's origin, in production the site's own.

The deploy brings the database up to date before publishing the worker, so the
code never meets a schema it predates. Schema changes are therefore written as
numbered files in `migrations/` rather than applied by hand, and `schema.sql` is
kept in step for building a database from nothing.

```sh
npx wrangler d1 migrations apply shifoosoftware --local
```

## Ingest

`POST /ingest` takes one JSON document describing a title, its versions and
their files, and writes them idempotently — running the same document twice
updates in place rather than duplicating. Vocabulary is named rather than
addressed, so categories, publishers, platforms, languages, architectures,
processors and file types are created when the catalogue has not met them yet.
Hotlinks are matched on their target address.

It is authenticated by a key, sent as `Authorization: Bearer`. Keys are minted
under the management interface at `/keys`, shown once, and stored only as a
hash. A key acts as whoever minted it, so it can never reach further than they
can. D1 offers no transaction across statements: a document that fails part way
leaves what it already wrote, and the reply says what landed.

## Files

Uploads are signed and sent straight from the browser to `S3_ENDPOINT`, so they
never pass through the worker and are not bound by its request limits. Readers
are pointed at `S3_PUBLIC_BASE`, which fronts the same bucket. The bucket needs a
policy allowing anonymous `s3:GetObject`, or public links will not resolve.
