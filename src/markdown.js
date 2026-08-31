const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

function escaped(text) {
  return String(text).replace(/[&<>"]/g, (character) => ESCAPES[character]);
}

function inline(text) {
  return escaped(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    // a link may point inside the site or out of it, but never at a script
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label, target) => {
      if (!/^(https?:\/\/|mailto:|\/|#)/i.test(target)) {
        return whole;
      }

      const away = /^https?:\/\//i.test(target);

      return `<a href="${target}"${away ? ' rel="noreferrer"' : ""}>${label}</a>`;
    });
}

export function rendered(source) {
  if (!source) {
    return "";
  }

  const out = [];
  let list = null;

  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  for (const raw of String(source).replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();

    if (line.trim() === "") {
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);

    if (heading) {
      closeList();
      const depth = heading[1].length + 2;
      out.push(`<h${depth}>${inline(heading[2])}</h${depth}>`);
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);

    if (bullet) {
      if (list !== "ul") {
        closeList();
        out.push("<ul>");
        list = "ul";
      }

      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }

    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);

    if (numbered) {
      if (list !== "ol") {
        closeList();
        out.push("<ol>");
        list = "ol";
      }

      out.push(`<li>${inline(numbered[1])}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }

  closeList();

  return out.join("\n");
}

export function plain(source, limit = 200) {
  const text = String(source ?? "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*#{1,6}\s/.test(line))
    .join("\n")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/[#*`>]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
