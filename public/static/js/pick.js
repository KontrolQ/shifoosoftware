function hostOf(target) {
  try {
    return new URL(target).host;
  } catch (problem) {
    return "elsewhere";
  }
}

const SHAPES = {
  listfacet: { local: true, seeded: true },
  software: {
    query: `query($q:String){Page(perPage:25){software(query:$q){slug name}}}`,
    rows: (data) => data.Page.software.map((one) => ({ value: one.slug, label: one.name })),
  },
  category: {
    query: `query{Page(perPage:200){categories{slug name titleCount}}}`,
    local: true,
    rows: (data) => data.Page.categories.map((one) => ({
      value: one.slug, label: one.name, note: one.titleCount + " titles",
    })),
  },
  publisher: {
    query: `query{Page(perPage:200){publishers{slug name titleCount}}}`,
    local: true,
    rows: (data) => data.Page.publishers.map((one) => ({
      value: one.slug, label: one.name, note: one.titleCount + " titles",
    })),
  },
  platform: {
    query: `query{Page(perPage:200){platforms{slug name fileCount}}}`,
    local: true,
    rows: (data) => data.Page.platforms.map((one) => ({
      value: one.slug, label: one.name, note: one.fileCount + " files",
    })),
  },
  language: {
    query: `query{Page(perPage:200){languages{slug name fileCount}}}`,
    local: true,
    rows: (data) => data.Page.languages.map((one) => ({
      value: one.slug, label: one.name, note: one.fileCount + " files",
    })),
  },
  architecture: {
    query: `query{Page(perPage:200){vocabulary(kind:"architecture"){slug name used}}}`,
    local: true,
    rows: (data) => data.Page.vocabulary.map((one) => ({
      value: one.slug, label: one.name, note: one.used + " versions",
    })),
  },
  filetype: {
    query: `query{Page(perPage:200){vocabulary(kind:"filetype"){slug name used}}}`,
    local: true,
    rows: (data) => data.Page.vocabulary.map((one) => ({
      value: one.slug, label: one.name, note: one.used + " files",
    })),
  },
  processor: {
    query: `query{Page(perPage:200){vocabulary(kind:"processor"){slug name used}}}`,
    local: true,
    rows: (data) => data.Page.vocabulary.map((one) => ({
      value: one.slug, label: one.name, note: one.used + " titles",
    })),
  },
  interface: {
    query: `query{Page(perPage:200){interfaces{slug name titleCount}}}`,
    local: true,
    rows: (data) => data.Page.interfaces.map((one) => ({
      value: one.slug, label: one.name, note: one.titleCount + " titles",
    })),
  },
  extension: {
    query: `query{Page(perPage:200){fileTypes{slug name fileCount}}}`,
    local: true,
    rows: (data) => data.Page.fileTypes.map((one) => ({
      value: one.slug, label: one.name, note: one.fileCount + " files",
    })),
  },
  version: {
    query: `query($q:String){Page(perPage:40){versionChoices(query:$q){path version softwareName fileCount}}}`,
    rows: (data) => data.Page.versionChoices.map((one) => ({
      value: one.path,
      label: `${one.softwareName} ${one.version}`,
      note: `${one.fileCount} files`,
    })),
  },
  hotlink: {
    query: `query($q:String){Page(perPage:60){hotlinks(query:$q){slug name targetUrl sizeBytes useCount}}}`,
    rows: (data) => data.Page.hotlinks.map((one) => ({
      value: one.slug,
      label: one.name,
      note: [hostOf(one.targetUrl), described(one.sizeBytes)].filter(Boolean).join(" \u00b7 "),
    })),
  },
  bucket: {
    query: `query($q:String){Page(perPage:60){bucketObjects(query:$q){key sizeBytes claimed}}}`,
    rows: (data) => data.Page.bucketObjects.map((one) => ({
      value: one.key,
      label: one.key,
      note: described(one.sizeBytes) + (one.claimed ? " · already used" : ""),
    })),
  },
  file: {
    query: `query($q:String){Page(perPage:40){files(query:$q){id displayName sizeBytes}}}`,
    rows: (data) => data.Page.files.map((one) => ({
      value: String(one.id),
      label: one.displayName,
      note: described(one.sizeBytes),
    })),
  },
  role: {
    query: `query{Page(perPage:200){roles{id name permissions}}}`,
    local: true,
    rows: (data) => data.Page.roles.map((one) => ({
      value: String(one.id),
      label: one.name,
      note: one.permissions === "*" ? "everything" : "limited",
    })),
  },
};

function slugOf(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "file";
}

function described(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let held = Number(bytes ?? 0);
  let step = 0;

  while (held >= 1024 && step < units.length - 1) {
    held /= 1024;
    step += 1;
  }

  return (held < 10 && step > 0 ? held.toFixed(1) : Math.round(held)) + " " + units[step];
}

async function ask(query, variables) {
  const response = await fetch("/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  const body = await response.json();

  if (body.errors) {
    throw new Error(body.errors[0].message);
  }

  return body.data;
}

function wire(box) {
  let source = box.dataset.pick;
  let shape = SHAPES[source];

  if (!shape) {
    return;
  }

  const many = box.dataset.many === "1";
  const field = box.querySelector("[data-pick-value]");
  const chosen = box.querySelector("[data-pick-chosen]");
  const search = box.querySelector("[data-pick-search]");
  const list = box.querySelector("[data-pick-list]");
  const drawer = box.querySelector("[data-pick-drawer]");
  const opener = box.querySelector("[data-pick-open]");

  if (!field || !chosen || !search || !list || !drawer || !opener) {
    return;
  }
  const maker = box.querySelector("[data-pick-make]");
  let waiting = null;
  let cached = null;

  const seeds = [...box.querySelectorAll("[data-pick-list] li[data-value]")].map((one) => ({
    value: one.dataset.value,
    label: one.dataset.label,
    note: one.dataset.note ? `${one.dataset.note} held` : "",
  }));

  const external = box.querySelector("[data-pick-external]");
  const linkField = box.querySelector("[data-pick-hotlink-value]");
  const tabs = [...box.querySelectorAll("[data-pick-tab]")];

  // a hotlinked file carries no object key, so the link itself is what is chosen
  const held = () => {
    if (field.value) {
      return field.value.split(",").filter(Boolean);
    }

    if (linkField && linkField.value) {
      return linkField.value.split(",").filter(Boolean);
    }

    return external && external.value ? [external.value] : [];
  };

  let pending = false;

  // picks made in the drawer are held until it shuts, so several can be made at once
  const hand = () => {
    pending = false;

    if (box.dataset.submit && field.form) {
      field.form.requestSubmit();
    }
  };

  const forget = (value) => {
    const kept = held().filter((one) => one !== value);

    field.value = field.value ? kept.join(",") : "";

    if (linkField && linkField.value === value) {
      linkField.value = "";
    }

    if (external && external.value === value) {
      external.value = "";
    }
  };

  function paint() {
    const values = held();

    chosen.replaceChildren();

    if (values.length === 0) {
      const none = document.createElement("span");

      none.className = "none";
      none.textContent = box.dataset.empty ?? "Nothing linked";
      chosen.appendChild(none);
      return;
    }

    for (const value of values) {
      const tag = document.createElement("span");
      const label = document.createElement("span");
      const drop = document.createElement("button");

      label.textContent = box.dataset.labels && JSON.parse(box.dataset.labels)[value]
        ? JSON.parse(box.dataset.labels)[value]
        : value;
      drop.type = "button";
      drop.textContent = "×";
      drop.title = "Unlink";
      drop.addEventListener("click", () => {
        forget(value);
        paint();
        hand();
      });

      const fromLink = (linkField && linkField.value === value) ||
        (external && external.value === value);

      tag.className = fromLink ? "tag external" : "tag";
      tag.append(label, drop);
      chosen.appendChild(tag);
    }
  }

  function remember(value, label) {
    const labels = box.dataset.labels ? JSON.parse(box.dataset.labels) : {};

    labels[value] = label;
    box.dataset.labels = JSON.stringify(labels);
  }

  function take(value, label) {
    remember(value, label);

    const target = source === "hotlink" && linkField ? linkField : field;

    if (many) {
      const values = held();

      if (!values.includes(value)) {
        values.push(value);
      }

      target.value = values.join(",");
    } else {
      target.value = value;
      close();
    }

    // the two sources are exclusive, so choosing one drops the other
    if (linkField) {
      if (target === linkField) {
        field.value = "";
      } else {
        linkField.value = "";
      }
    }

    paint();

    if (box.dataset.submit === "close") {
      pending = true;
      return;
    }

    hand();
  }

  function say(words) {
    const line = document.createElement("li");

    line.className = "none";
    line.textContent = words;
    list.replaceChildren(line);
  }

  function draw(rows) {
    const wanted = search.value.trim().toLowerCase();
    const shown = shape.local && wanted
      ? rows.filter((row) => row.label.toLowerCase().includes(wanted) || row.value.toLowerCase().includes(wanted))
      : rows;

    if (shown.length === 0) {
      // an empty list and a list filtered down to nothing are different problems
      say(rows.length === 0
        ? (maker ? "None yet. Use Add new to make the first one." : "None yet.")
        : "Nothing matches that.");
      return;
    }

    list.replaceChildren();

    for (const row of shown.slice(0, 60)) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const label = document.createElement("span");
      const note = document.createElement("span");
      const taken = many && held().includes(row.value);

      item.className = taken ? "taken" : "";
      button.type = "button";
      button.textContent = taken ? "Remove" : (box.dataset.verb || "Link");
      button.addEventListener("click", () => {
        if (!taken) {
          take(row.value, row.label);
          look();
          return;
        }

        forget(row.value);
        paint();
        look();

        if (box.dataset.submit === "close") {
          pending = true;
          return;
        }

        hand();
      });

      label.className = "label";
      label.textContent = row.label;
      note.className = "note";
      note.textContent = row.note ?? "";

      item.append(button, label, note);
      list.appendChild(item);
    }
  }

  async function look() {
    if (shape.seeded) {
      draw(seeds);
      return;
    }

    say("Looking…");

    try {
      if (shape.local && cached) {
        draw(shape.rows(cached));
        return;
      }

      const data = await ask(shape.query, { q: search.value.trim() || null });

      if (shape.local) {
        cached = data;
      }

      draw(shape.rows(data));
    } catch (problem) {
      say(problem.message);
    }
  }

  const restingLabel = opener.textContent;

  // the label swaps to "Close" when open, so the button is pinned to whichever
  // of the two is wider and the row it sits in never reflows
  const pinWidth = () => {
    const resting = opener.getBoundingClientRect().width;

    opener.textContent = "Close";

    const opened = opener.getBoundingClientRect().width;

    opener.textContent = restingLabel;

    if (resting > 0 || opened > 0) {
      opener.style.width = `${Math.ceil(Math.max(resting, opened))}px`;
    }
  };

  requestAnimationFrame(pinWidth);

  function open() {
    // two lists over one another read as one broken list, so only one opens
    for (const other of document.querySelectorAll("[data-pick-drawer]")) {
      if (other !== drawer && !other.hidden) {
        other.closest("[data-pick]")?.querySelector("[data-pick-open]")?.click();
      }
    }

    drawer.hidden = false;
    opener.textContent = "Close";

    // in a toolbar the list hangs under the whole row, lined up with its own
    // control but never over another one
    const rail = box.closest(".toolbar");

    if (rail) {
      const room = rail.getBoundingClientRect();
      const mine = box.getBoundingClientRect();
      const wide = drawer.getBoundingClientRect().width;

      drawer.style.left =
        `${Math.max(0, Math.min(mine.left - room.left, room.width - wide))}px`;
    }

    search.focus();
    look();
  }

  function close() {
    drawer.hidden = true;
    opener.textContent = restingLabel;

    if (pending) {
      hand();
    }
  }

  opener.addEventListener("click", () => (drawer.hidden ? open() : close()));

  search.addEventListener("input", () => {
    clearTimeout(waiting);
    waiting = setTimeout(look, 160);
  });

  const uploader = box.querySelector("[data-pick-upload]");
  const chooser = box.querySelector("[data-pick-file]");
  const bar = box.querySelector("[data-pick-bar]");

  if (uploader && chooser) {
    uploader.addEventListener("click", () => chooser.click());

    chooser.addEventListener("change", async () => {
      const picked = chooser.files[0];

      if (!picked) {
        return;
      }

      const dot = picked.name.lastIndexOf(".");
      const stem = slugOf(dot > 0 ? picked.name.slice(0, dot) : picked.name);
      const objectKey = `${box.dataset.prefix || "loose"}/${stem}${dot > 0 ? picked.name.slice(dot) : ""}`;

      bar.hidden = false;
      say(`Uploading ${picked.name}…`);

      const offer = await fetch(box.dataset.uploadUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ key: objectKey }),
      }).then((one) => one.json()).catch(() => null);

      const done = () => {
        bar.hidden = true;
        chooser.value = "";
        cached = null;

        if (many) {
          take(objectKey, objectKey);
          look();
          return;
        }

        remember(objectKey, objectKey);
        field.value = objectKey;
        paint();
        drawer.hidden = false;
        opener.textContent = "Close";
        look();
      };

      const request = new XMLHttpRequest();

      request.upload.addEventListener("progress", (progress) => {
        if (progress.lengthComputable) {
          const share = Math.round((progress.loaded / progress.total) * 100);

          bar.firstElementChild.style.width = `${share}%`;
          say(`${share}% of ${Math.round(progress.total / 1048576)} MB`);
        }
      });

      request.addEventListener("load", () => {
        if (request.status >= 200 && request.status < 400) {
          done();
        } else {
          bar.hidden = true;
          say(`That upload failed with ${request.status}.`);
        }
      });

      request.addEventListener("error", () => {
        bar.hidden = true;
        say("That upload failed.");
      });

      if (offer && offer.direct) {
        request.open("PUT", offer.url);
        request.send(picked);
        return;
      }

      const carried = new FormData();

      carried.set("prefix", box.dataset.prefix || "");
      carried.set("key", objectKey);
      carried.set("payload", picked);

      request.open("POST", box.dataset.putUrl);
      request.send(carried);
    });
  }

  const hotlinker = box.querySelector("[data-pick-hotlink]");

  if (hotlinker && external) {
    hotlinker.addEventListener("click", () => {
      const offered = search.value.trim();

      if (!/^https?:\/\//i.test(offered)) {
        say("Paste a full http or https link in the box above, then press Hotlink.");
        return;
      }

      external.value = offered;
      field.value = "";
      remember(offered, offered);
      paint();
      close();
    });
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const wanted = tab.dataset.pickTab;

      if (!SHAPES[wanted] && wanted !== "upload") {
        return;
      }

      for (const other of tabs) {
        other.classList.toggle("on", other === tab);
      }

      box.classList.toggle("uploading", wanted === "upload");
      box.classList.toggle("linking", wanted === "hotlink");
      search.placeholder = wanted === "hotlink" ? "Search, or paste a link to add" : "Search";

      if (wanted === "upload") {
        list.replaceChildren();
        say("Choose a file to send straight to the bucket.");
        return;
      }

      source = wanted;
      shape = SHAPES[wanted];
      cached = null;
      search.value = "";
      look();
    });
  }

  const linkMaker = box.querySelector("[data-pick-newlink]");

  if (linkMaker && linkField) {
    linkMaker.addEventListener("click", async () => {
      const offered = search.value.trim();

      if (!/^https?:\/\//i.test(offered)) {
        say("Paste a full http or https link, then press Add this link.");
        return;
      }

      const named = decodeURIComponent(offered.split("?")[0].split("/").filter(Boolean).pop() ?? offered);

      const made = await fetch(box.dataset.makeUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          kind: "hotlink",
          name: named,
          target: offered,
          prefix: box.dataset.prefix ?? "",
        }),
      });

      if (!made.ok) {
        say("That link could not be recorded.");
        return;
      }

      const body = await made.json();

      cached = null;
      source = "hotlink";
      shape = SHAPES.hotlink;
      take(body.slug, body.name);
      search.value = "";
    });
  }

  if (maker) {
    maker.addEventListener("click", async () => {
      const typed = search.value.trim();

      if (!typed) {
        say("Type a name first, then press Add new.");
        return;
      }

      const kind = box.dataset.pick;
      const made = await fetch(`${box.dataset.makeUrl}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ name: typed, kind }),
      });

      if (!made.ok) {
        say("That could not be created.");
        return;
      }

      const body = await made.json();

      cached = null;
      take(body.slug ?? String(body.id), body.name);
      search.value = "";
      look();
    });
  }

  paint();
  close();
}

document.querySelectorAll("[data-pick]").forEach(wire);
