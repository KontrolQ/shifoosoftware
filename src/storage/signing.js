const SERVICE = "s3";
const ALGORITHM = "AWS4-HMAC-SHA256";
const LIFETIME = 900;

function hex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function hashed(text) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

async function signedWith(key, text) {
  const imported = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  return crypto.subtle.sign("HMAC", imported, new TextEncoder().encode(text));
}

async function signingKey(secret, day, region) {
  let key = new TextEncoder().encode(`AWS4${secret}`);

  for (const step of [day, region, SERVICE, "aws4_request"]) {
    key = new Uint8Array(await signedWith(key, step));
  }

  return key;
}

// Each piece of a key is escaped on its own so the separators survive.
export function escaped(path) {
  return path
    .split("/")
    .map((piece) => encodeURIComponent(piece).replace(/[!'()*]/g, (one) =>
      `%${one.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

export function storageReady(environment) {
  return Boolean(
    environment.S3_ENDPOINT && environment.S3_ACCESS_KEY_ID && environment.S3_SECRET_ACCESS_KEY
  );
}

export function bucketName(environment) {
  return environment.S3_BUCKET_NAME || "shifoosoftware";
}

function stamped() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  return { stamp, day: stamp.slice(0, 8) };
}

// The body is never hashed: an object can be hundreds of megabytes and the
// worker must not hold it to sign for it. TLS carries the integrity instead.
const UNSIGNED = "UNSIGNED-PAYLOAD";

// A signature is taken over the query in sorted order, so the request has to be
// sent in that same order or the store refuses it.
function orderedQuery(query) {
  return [...new URLSearchParams(query ?? "").entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([one, value]) =>
      `${encodeURIComponent(one)}=${encodeURIComponent(value).replace(/[!'()*]/g, (each) =>
        `%${each.charCodeAt(0).toString(16).toUpperCase()}`)}`)
    .join("&");
}

// The store answers on paths outside the bucket too — its own administration among
// them — so signing is over a path rather than over a key.
export async function signedRequest(environment, method, path, options = {}) {
  const endpoint = new URL(environment.S3_ENDPOINT);
  const region = environment.S3_REGION || "us-east-1";
  const { stamp, day } = stamped();
  const scope = `${day}/${region}/${SERVICE}/aws4_request`;
  const query = orderedQuery(options.query);

  const headers = new Headers(options.headers ?? {});

  headers.set("x-amz-content-sha256", UNSIGNED);
  headers.set("x-amz-date", stamp);

  const names = [...headers.keys()].map((one) => one.toLowerCase()).sort();
  const signedNames = ["host", ...names].sort().join(";");
  const canonicalHeaders = ["host", ...names]
    .sort()
    .map((one) => `${one}:${one === "host" ? endpoint.host : headers.get(one).trim()}\n`)
    .join("");

  const canonical = [method, path, query, canonicalHeaders, signedNames, UNSIGNED].join("\n");
  const toSign = [ALGORITHM, stamp, scope, await hashed(canonical)].join("\n");
  const key256 = await signingKey(environment.S3_SECRET_ACCESS_KEY, day, region);
  const signature = hex(await signedWith(key256, toSign));

  headers.set(
    "authorization",
    `${ALGORITHM} Credential=${environment.S3_ACCESS_KEY_ID}/${scope}, ` +
      `SignedHeaders=${signedNames}, Signature=${signature}`
  );

  return fetch(`${endpoint.origin}${path}${query ? `?${query}` : ""}`, {
    method,
    headers,
    body: options.body,
    duplex: options.body ? "half" : undefined,
  });
}

export function signedFetch(environment, method, key, options = {}) {
  return signedRequest(
    environment, method,
    `/${bucketName(environment)}${key ? `/${escaped(key)}` : ""}`,
    options
  );
}

// A browser uploads straight to the store, so the worker never carries the file.
export async function presignedPut(environment, objectKey) {
  const endpoint = new URL(environment.S3_ENDPOINT);
  const region = environment.S3_REGION || "us-east-1";
  const { stamp, day } = stamped();
  const scope = `${day}/${region}/${SERVICE}/aws4_request`;

  const query = new URLSearchParams({
    "X-Amz-Algorithm": ALGORITHM,
    "X-Amz-Credential": `${environment.S3_ACCESS_KEY_ID}/${scope}`,
    "X-Amz-Date": stamp,
    "X-Amz-Expires": String(LIFETIME),
    "X-Amz-SignedHeaders": "host",
  });

  const path = `/${bucketName(environment)}/${escaped(objectKey)}`;
  const canonical = [
    "PUT",
    path,
    [...query.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([one, value]) =>
      `${encodeURIComponent(one)}=${encodeURIComponent(value)}`).join("&"),
    `host:${endpoint.host}\n`,
    "host",
    UNSIGNED,
  ].join("\n");

  const toSign = [ALGORITHM, stamp, scope, await hashed(canonical)].join("\n");
  const key = await signingKey(environment.S3_SECRET_ACCESS_KEY, day, region);

  query.set("X-Amz-Signature", hex(await signedWith(key, toSign)));

  return {
    url: `${endpoint.origin}${path}?${query.toString()}`,
    key: objectKey,
    expiresIn: LIFETIME,
  };
}
