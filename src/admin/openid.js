import { managerForKey } from "./keys.js";
import { render } from "../rendering.js";

const COOKIE = "management";
const PENDING = "management_start";
const SESSION_DAYS = 14;

function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function cookieFrom(request, name) {
  const jar = request.headers.get("cookie") ?? "";
  const found = jar.split(";").map((one) => one.trim()).find((one) => one.startsWith(`${name}=`));

  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

function laid(name, value, seconds) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
}

let discovered = null;

async function discovery(environment) {
  if (discovered) {
    return discovered;
  }

  const response = await fetch(environment.OIDC_DISCOVERY);

  if (!response.ok) {
    throw new Error(`The identity provider did not answer: ${response.status}`);
  }

  discovered = await response.json();

  return discovered;
}

function base64UrlToBytes(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));

  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function claimsOf(token) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(token.split(".")[1])));
}

async function signatureHolds(environment, token) {
  const [header, payload, signature] = token.split(".");
  const { kid, alg } = JSON.parse(new TextDecoder().decode(base64UrlToBytes(header)));

  if (alg !== "RS256") {
    return false;
  }

  const { jwks_uri: jwksUri } = await discovery(environment);
  const { keys } = await (await fetch(jwksUri)).json();
  const jwk = keys.find((one) => one.kid === kid) ?? keys[0];

  if (!jwk) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(signature),
    new TextEncoder().encode(`${header}.${payload}`)
  );
}

function redirectUri(environment, root, url) {
  const origin = environment.OIDC_REDIRECT || `${url.protocol}//${url.host}`;

  return `${origin}${root}/callback`;
}

export function doorway(root, message, wanted) {
  return new Response(render("admin-doorway", { root, message, wanted, title: "Sign in" }), {
    status: message ? 401 : 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function safeReturn(root, offered) {
  const wanted = String(offered ?? "");

  return wanted.startsWith(`${root}/`) || wanted === root ? wanted : root;
}

export async function beginSignIn(environment, root, url) {
  const { authorization_endpoint: endpoint } = await discovery(environment);
  const state = randomHex(16);
  const nonce = randomHex(16);
  const next = safeReturn(root, url.searchParams.get("next"));

  const wanted = new URL(endpoint);

  wanted.searchParams.set("client_id", environment.OIDC_CLIENT_ID);
  wanted.searchParams.set("redirect_uri", redirectUri(environment, root, url));
  wanted.searchParams.set("response_type", "code");
  wanted.searchParams.set("scope", "openid email profile");
  wanted.searchParams.set("state", state);
  wanted.searchParams.set("nonce", nonce);

  return new Response(null, {
    status: 303,
    headers: {
      location: wanted.toString(),
      "set-cookie": laid(PENDING, `${state}.${nonce}.${next}`, 600),
    },
  });
}

export async function finishSignIn(request, environment, root, url) {
  const database = environment.CATALOGUE;
  const pending = cookieFrom(request, PENDING) ?? "";
  const [state, nonce, ...rest] = pending.split(".");
  const next = safeReturn(root, rest.join("."));
  const code = url.searchParams.get("code");

  if (!code || !state || url.searchParams.get("state") !== state) {
    return doorway(root, "That sign in did not come back cleanly. Try again.");
  }

  const { token_endpoint: tokenEndpoint, issuer } = await discovery(environment);

  const exchanged = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(environment, root, url),
      client_id: environment.OIDC_CLIENT_ID,
      client_secret: environment.OIDC_CLIENT_SECRET,
    }),
  });

  if (!exchanged.ok) {
    return doorway(root, `The identity provider refused the exchange: ${exchanged.status}`);
  }

  const { id_token: idToken } = await exchanged.json();

  if (!idToken || !(await signatureHolds(environment, idToken))) {
    return doorway(root, "That identity token could not be verified.");
  }

  const claims = claimsOf(idToken);
  const now = Math.floor(Date.now() / 1000);

  if (claims.iss !== issuer || claims.exp < now || claims.nonce !== nonce) {
    return doorway(root, "That identity token was not meant for this site.");
  }

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];

  if (!audiences.includes(environment.OIDC_CLIENT_ID)) {
    return doorway(root, "That identity token was issued for another application.");
  }

  const email = String(claims.email ?? "").toLowerCase();

  if (!email) {
    return doorway(root, "The identity provider did not share an email address.");
  }

  const counted = await database.prepare("SELECT COUNT(*) AS held FROM managers").first();
  const owner = await database.prepare("SELECT id FROM roles WHERE permissions = '*' ORDER BY id LIMIT 1").first();
  const first = (counted?.held ?? 0) === 0;
  const stamp = new Date().toISOString();

  await database
    .prepare(`
      INSERT INTO managers (subject, email, display_name, role_id, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        subject = excluded.subject, display_name = excluded.display_name, last_seen_at = excluded.last_seen_at`)
    .bind(claims.sub, email, claims.name ?? claims.preferred_username ?? email,
          first ? owner?.id ?? null : null, stamp, stamp)
    .run();

  const held = await database.prepare("SELECT id FROM managers WHERE email = ?").bind(email).first();
  const token = randomHex(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);

  await database.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(stamp).run();
  await database
    .prepare("INSERT INTO sessions (token, manager_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(token, held.id, stamp, expires.toISOString())
    .run();

  return new Response(null, {
    status: 303,
    headers: [
      ["location", next],
      ["set-cookie", laid(COOKIE, token, SESSION_DAYS * 86400)],
      ["set-cookie", laid(PENDING, "", 0)],
    ],
  });
}

export async function managerFor(request, database) {
  const token = cookieFrom(request, COOKIE);

  if (!token) {
    return managerForKey(request, database);
  }

  const held = await database
    .prepare(`
      SELECT m.id, m.email, m.display_name, m.role_id, s.expires_at,
             r.name AS role_name, r.permissions
      FROM sessions s
      JOIN managers m ON m.id = s.manager_id
      LEFT JOIN roles r ON r.id = m.role_id
      WHERE s.token = ?`)
    .bind(token)
    .first();

  if (!held || held.expires_at < new Date().toISOString()) {
    return null;
  }

  return {
    id: held.id,
    email: held.email,
    name: held.display_name || held.email,
    roleId: held.role_id,
    roleName: held.role_name ?? "No role",
    permissions: held.permissions ?? "",
    token,
  };
}

export async function signOut(environment, root, manager) {
  if (manager) {
    await environment.CATALOGUE.prepare("DELETE FROM sessions WHERE token = ?").bind(manager.token).run();
  }

  return new Response(null, {
    status: 303,
    headers: { location: root, "set-cookie": laid(COOKIE, "", 0) },
  });
}
