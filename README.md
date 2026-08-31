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

Deploys do not touch the database. Schema changes are applied by hand:

```sh
npx wrangler d1 execute shifoosoftware --remote --file=schema.sql
```

## Files

Uploads are signed and sent straight from the browser to `S3_ENDPOINT`, so they
never pass through the worker and are not bound by its request limits. Readers
are pointed at `S3_PUBLIC_BASE`, which fronts the same bucket. The bucket needs a
policy allowing anonymous `s3:GetObject`, or public links will not resolve.
