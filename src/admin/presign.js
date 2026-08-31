import { presignedPut, storageReady } from "../storage/signing.js";
import { can } from "./permissions.js";

export { presignedPut };

export function directUploadsReady(environment) {
  return storageReady(environment);
}

export async function askForUploadUrl(environment, manager, form) {
  const answer = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });

  if (!can(manager, "files.create")) {
    return answer({ error: "You do not have permission to upload." }, 403);
  }

  if (!directUploadsReady(environment)) {
    return answer({ direct: false });
  }

  const objectKey = String(form.get("key") ?? "").trim();

  if (!objectKey || objectKey.includes("..")) {
    return answer({ error: "A usable object key is required." }, 400);
  }

  return answer({ direct: true, ...(await presignedPut(environment, objectKey)) });
}
