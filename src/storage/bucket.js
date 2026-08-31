import { bucketName, escaped, signedFetch, storageReady } from "./signing.js";

// The store answers in XML. Only a handful of fields are ever read from it, so
// they are picked out directly rather than by parsing the whole document.
function pieces(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((one) => one[1]);
}

function piece(xml, tag) {
  const found = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);

  return found ? found[1] : null;
}

function unescaped(text) {
  return String(text ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// What the rest of the code expects of a stored object, whichever store holds it.
function described(key, response, body) {
  const type = response.headers.get("content-type");
  const length = Number(response.headers.get("content-length") ?? 0);
  const changed = response.headers.get("last-modified");

  return {
    key,
    body,
    size: Number.isFinite(length) ? length : 0,
    uploaded: changed ? new Date(changed) : new Date(),
    etag: response.headers.get("etag") ?? "",
    httpMetadata: { contentType: type ?? "application/octet-stream" },
    writeHttpMetadata(headers) {
      headers.set("content-type", type ?? "application/octet-stream");
    },
  };
}

export function filesFor(environment) {
  // A real bucket binding wins when there is one; otherwise the store is spoken
  // to over its own API, which is what a MinIO server offers.
  if (environment.FILES) {
    return environment.FILES;
  }

  if (!storageReady(environment)) {
    throw new Error("No file store is configured.");
  }

  return {
    async get(key) {
      const answered = await signedFetch(environment, "GET", key);

      if (answered.status === 404) {
        return null;
      }

      return described(key, answered, answered.body);
    },

    async head(key) {
      const answered = await signedFetch(environment, "HEAD", key);

      return answered.status === 404 ? null : described(key, answered, null);
    },

    async put(key, body, options = {}) {
      const answered = await signedFetch(environment, "PUT", key, {
        body,
        headers: options.contentType ? { "content-type": options.contentType } : {},
      });

      if (!answered.ok) {
        throw new Error(`Storing ${key} failed with ${answered.status}.`);
      }

      return { key };
    },

    // Moving is done by the store itself, so a large file never travels through
    // the worker to be put back where it came from.
    async copy(fromKey, toKey) {
      const answered = await signedFetch(environment, "PUT", toKey, {
        headers: {
          "x-amz-copy-source": `/${bucketName(environment)}/${escaped(fromKey)}`,
        },
      });

      if (!answered.ok) {
        throw new Error(`Copying ${fromKey} failed with ${answered.status}.`);
      }

      return { key: toKey };
    },

    async delete(key) {
      await signedFetch(environment, "DELETE", key);
    },

    async list(options = {}) {
      const query = new URLSearchParams({ "list-type": "2" });

      if (options.prefix) {
        query.set("prefix", options.prefix);
      }

      if (options.delimiter) {
        query.set("delimiter", options.delimiter);
      }

      if (options.cursor) {
        query.set("continuation-token", options.cursor);
      }

      query.set("max-keys", String(options.limit ?? 1000));

      const answered = await signedFetch(environment, "GET", "", { query: query.toString() });
      const xml = await answered.text();

      // A refused listing looks like an empty one unless it is called out.
      if (!answered.ok) {
        throw new Error(`Listing failed with ${answered.status}: ${piece(xml, "Message") ?? ""}`);
      }

      return {
        objects: pieces(xml, "Contents").map((one) => ({
          key: unescaped(piece(one, "Key")),
          size: Number(piece(one, "Size") ?? 0),
          uploaded: new Date(piece(one, "LastModified") ?? Date.now()),
          etag: unescaped(piece(one, "ETag") ?? ""),
        })),
        delimitedPrefixes: pieces(xml, "CommonPrefixes").map((one) =>
          unescaped(piece(one, "Prefix"))),
        truncated: piece(xml, "IsTruncated") === "true",
        cursor: piece(xml, "NextContinuationToken") ?? undefined,
      };
    },
  };
}

// Where a stored file is read from by anyone, which is not where it is written to.
export function publicHref(environment, key) {
  const base = (environment.S3_PUBLIC_BASE || environment.S3_ENDPOINT || "").replace(/\/$/, "");

  return `${base}/${bucketName(environment)}/${escaped(key)}`;
}
