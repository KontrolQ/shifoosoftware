// Minifies every template, stylesheet and script.
//
// By default it writes a mirror into build/ so the result can be read and served
// without touching the sources. With --overwrite-sources it writes each file back over
// itself instead, which is what the deploy does: wrangler bundles the tree it is given
// whatever a --cwd or a config copy says, so the only reliable way to publish minified
// output is to hand it a checkout that is already minified. Never run that here.

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import CleanCSS from "clean-css";
import { minify as minifyHtml } from "html-minifier-terser";
import { minify as minifyJs } from "terser";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "build");

// Mustache tags live in attribute values and between elements, so anything that
// rewrites attributes or re-quotes them is left off. Two style attributes hold a
// tag rather than a declaration, which is why stylesheet minifying is off here and
// done directly against the sheets instead. A tag standing where an attribute would
// go is not parsable HTML, so every tag is lifted out before the parse and put back
// after it. Whitespace is collapsed to a single space rather than removed: a run that
// separates two words carries meaning, and a breadcrumb loses its spacing without it.
const HTML_SETTINGS = {
  ignoreCustomFragments: [/\{\{[\s\S]*?\}\}/],
  collapseWhitespace: true,
  conservativeCollapse: true,
  collapseInlineTagWhitespace: false,
  removeComments: true,
  removeRedundantAttributes: false,
  removeAttributeQuotes: false,
  removeEmptyAttributes: false,
  collapseBooleanAttributes: true,
  minifyCSS: false,
  minifyJS: true,
  sortAttributes: false,
  sortClassName: false,
};

// Level one works declaration by declaration. Level two would merge and reorder
// rules, and the themes rely on the order they are written in.
const styles = new CleanCSS({ level: 1, returnPromise: true });

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

const GUARDED = /<(pre|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi;
const OPAQUE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
const RUNNABLE = /^(|text\/javascript|application\/javascript|module)$/i;
const TAGS = /<(\/?)([a-zA-Z][\w-]*)/g;
const COMMENT = /<!--[\s\S]*?-->/g;
const LINE_BREAK = /\s*\r?\n\s*/g;
const DOUBLE_SPACE = /[ \t]{2,}/g;

// Two characters no template can hold, so what is set aside comes back where it left.
const KEPT_MARK = /\u0000(\d+)\u0000/g;
const SCRIPT_MARK = /\u0001(\d+)\u0001/g;

function balances(html) {
  const open = [];

  for (const [, closing, name] of html.replace(OPAQUE, "").matchAll(TAGS)) {
    const tag = name.toLowerCase();

    if (VOID_TAGS.has(tag)) {
      continue;
    }

    if (!closing) {
      open.push(tag);
    } else if (open.pop() !== tag) {
      return false;
    }
  }

  return open.length === 0;
}

// The shell partials open the page and the foot partials close it, so neither balances
// on its own. A parser reading one of those closes whatever it finds open, which would
// end the page before its content ever arrived. Anything that does not balance is
// therefore squeezed rather than parsed: comments go, runs of whitespace become one
// space, and the scripts inside are minified on their own terms. No markup moves.
async function squeezed(source) {
  const kept = [];
  const scripts = [];

  let text = source.replace(GUARDED, (found) => `\u0000${kept.push(found) - 1}\u0000`);

  text = text.replace(INLINE_SCRIPT, (whole, attributes, body) => {
    scripts.push({ attributes, body });

    return `\u0001${scripts.length - 1}\u0001`;
  });

  for (const script of scripts) {
    const type = (/type\s*=\s*"([^"]*)"/i.exec(script.attributes)?.[1] ?? "").trim();

    script.made = RUNNABLE.test(type)
      ? (await minifyJs(script.body, { ecma: 2022, format: { comments: false } })).code
      : script.body.trim();
  }

  text = text
    .replace(COMMENT, "")
    .replace(LINE_BREAK, " ")
    .replace(DOUBLE_SPACE, " ")
    .trim();

  return text
    .replace(SCRIPT_MARK, (whole, at) => {
      const script = scripts[Number(at)];

      return `<script${script.attributes}>${script.made}</script>`;
    })
    .replace(KEPT_MARK, (whole, at) => kept[Number(at)]);
}

async function* filesUnder(where) {
  for (const found of await readdir(where, { withFileTypes: true })) {
    const path = join(where, found.name);

    if (found.isDirectory()) {
      yield* filesUnder(path);
    } else if (found.isFile()) {
      yield path;
    }
  }
}

async function written(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf8");
}

async function minifiedPage(source, target) {
  const held = await readFile(source, "utf8");
  const made = balances(held)
    ? await minifyHtml(held, HTML_SETTINGS)
    : await squeezed(held);

  await written(target, made);

  return [held.length, made.length];
}

async function minifiedSheet(source, target) {
  const held = await readFile(source, "utf8");
  const made = await styles.minify(held);

  if (made.errors.length) {
    throw new Error(`${relative(ROOT, source)}: ${made.errors.join("; ")}`);
  }

  await written(target, made.styles);

  return [held.length, made.styles.length];
}

async function minifiedScript(source, target) {
  const held = await readFile(source, "utf8");
  const made = await minifyJs(held, {
    ecma: 2022,
    module: false,
    format: { comments: false },
  });

  await written(target, made.code);

  return [held.length, made.code.length];
}

function reported(name, saved) {
  const [was, now] = saved;
  const share = was ? Math.round(((was - now) / was) * 100) : 0;

  return `${name}  ${was} → ${now} (-${share}%)`;
}

async function present(path) {
  try {
    await stat(path);

    return true;
  } catch (missing) {
    return false;
  }
}

async function build() {
  const inPlace = process.argv.includes("--overwrite-sources");

  if (inPlace) {
    console.log("minifying the checkout in place");
  } else {
    await rm(BUILD, { recursive: true, force: true });
    await mkdir(BUILD, { recursive: true });

    // The worker's own modules go over as they are; wrangler minifies them itself.
    await cp(join(ROOT, "src"), join(BUILD, "src"), { recursive: true });
    await cp(join(ROOT, "wrangler.toml"), join(BUILD, "wrangler.toml"));

    if (await present(join(ROOT, "migrations"))) {
      await cp(join(ROOT, "migrations"), join(BUILD, "migrations"), { recursive: true });
    }
  }

  const totals = { was: 0, now: 0 };
  const lines = [];

  for (const source of [join(ROOT, "templates"), join(ROOT, "public")]) {
    for await (const path of filesUnder(source)) {
      const within = relative(ROOT, path);
      const target = inPlace ? path : join(BUILD, within);
      const kind = extname(path).toLowerCase();

      let saved = null;

      if (kind === ".html") {
        saved = await minifiedPage(path, target);
      } else if (kind === ".css") {
        saved = await minifiedSheet(path, target);
      } else if (kind === ".js") {
        saved = await minifiedScript(path, target);
      } else if (!inPlace) {
        await mkdir(dirname(target), { recursive: true });
        await cp(path, target);
      }

      if (saved) {
        totals.was += saved[0];
        totals.now += saved[1];
        lines.push(reported(within.split(sep).join("/"), saved));
      }
    }
  }

  lines.sort();
  console.log(lines.join("\n"));
  console.log(reported("\nall text", [totals.was, totals.now]));
}

await build();
