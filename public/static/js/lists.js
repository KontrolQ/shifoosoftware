// The address should carry only what was actually asked for, so blank controls
// are left out of it.
for (const form of document.querySelectorAll(".listform")) {
  form.addEventListener("submit", () => {
    for (const one of form.elements) {
      if (one.name && one.value === "") {
        one.disabled = true;
        continue;
      }

      // a unit only means something beside a span that was actually asked for
      const span = /^r\.(.+)\.unit$/.exec(one.name ?? "");

      if (span && !["from", "to"].some((edge) => form.elements[`r.${span[1]}.${edge}`]?.value)) {
        one.disabled = true;
      }
    }
  });
}

// A row of controls per column is a lot to meet at once, so both the column
// filters and the column chooser stay folded away until they are asked for.
function fold(button, rows, names) {
  if (rows.length === 0) {
    return;
  }

  const shown = () => !rows[0].hidden;

  const paint = () => {
    button.textContent = shown() ? names[1] : names[0];
    button.setAttribute("aria-expanded", shown() ? "true" : "false");
  };

  button.addEventListener("click", () => {
    const opening = !shown();

    for (const row of rows) {
      row.hidden = !opening;

      if (opening) {
        // the panel hangs from the button that opened it, without running past
        // the edge of the list it belongs to
        const room = row.offsetParent.getBoundingClientRect();
        const mine = button.getBoundingClientRect();
        const wide = row.offsetWidth;

        // hangs from the left of its button, or from the right of it when there
        // is not enough room to the right — either way it touches the button
        row.style.left = `${Math.max(0, mine.left - room.left + wide <= room.width
          ? mine.left - room.left
          : mine.right - room.left - wide)}px`;
      }
    }

    paint();
  });

  paint();
}

for (const button of document.querySelectorAll("[data-columns-toggle]")) {
  fold(button, [...document.querySelectorAll("[data-columns]")], ["Choose", "Close"]);
}

function panels() {
  return document.querySelectorAll("[data-narrow], [data-columns]");
}

function openerFor(panel) {
  return document.querySelector(
    panel.hasAttribute("data-narrow") ? "[data-narrow-toggle]" : "[data-columns-toggle]"
  );
}

// Where a click landed is settled as it starts, because a panel that rebuilds
// its own contents leaves the clicked node detached, and a detached node is
// inside nothing.
let landedIn = new Set();

document.addEventListener("click", (event) => {
  landedIn = new Set();

  for (const panel of panels()) {
    if (panel.contains(event.target) || openerFor(panel)?.contains(event.target)) {
      landedIn.add(panel);
    }
  }
}, true);

// A panel is done with when you look somewhere else.
document.addEventListener("click", () => {
  for (const panel of panels()) {
    if (panel.hidden || landedIn.has(panel)) {
      continue;
    }

    openerFor(panel)?.click();
  }
});

for (const button of document.querySelectorAll("[data-narrow-toggle]")) {
  fold(button, [...document.querySelectorAll("[data-narrow]")], ["Choose", "Close"]);
}

// The facet panel shows one facet's options at a time, chosen from the list beside it.
function wireFacets(panel) {
  const names = [...panel.querySelectorAll("[data-facet-name]")];
  const bodies = [...panel.querySelectorAll("[data-facet-body]")];

  for (const name of names) {
    name.addEventListener("click", () => {
      for (const body of bodies) {
        body.hidden = body.dataset.facetBody !== name.dataset.facetName;
      }

      for (const other of names) {
        other.classList.toggle("on", other === name);
      }
    });
  }

  for (const body of bodies) {
    const search = body.querySelector("[data-facet-search]");

    if (!search) {
      continue;
    }

    const nothing = document.createElement("p");

    nothing.className = "nothing";
    nothing.textContent = "Nothing here matches that.";
    nothing.hidden = true;
    body.append(nothing);

    search.addEventListener("input", () => {
      const wanted = search.value.trim().toLowerCase();
      let left = 0;

      for (const row of body.querySelectorAll(".optionlist li")) {
        row.hidden = wanted !== "" && !row.textContent.toLowerCase().includes(wanted);
        left += row.hidden ? 0 : 1;
      }

      nothing.hidden = left > 0;
    });
  }
}

document.querySelectorAll("[data-narrow]").forEach(wireFacets);

// Which columns a view shows, and in what order, is one list of keys: the left
// pane is that list, the right pane is everything not in it.
function wireColumns() {
  const field = document.querySelector("[data-columns-value]");
  const shownList = document.querySelector("[data-columns-shown]");
  const spareList = document.querySelector("[data-columns-spare]");
  const source = document.getElementById("columnchoices");

  if (!field || !shownList || !spareList || !source) {
    return;
  }

  const every = JSON.parse(source.textContent);
  const known = new Map(every.map((one) => [one.key, one]));
  let held = field.value.split(",").map((one) => one.trim()).filter((one) => known.has(one));

  const settle = () => {
    field.value = held.join(",");
    paint();
  };

  function step(mark, title, off, when) {
    const button = document.createElement("button");

    button.type = "button";
    button.textContent = mark;
    button.title = title;
    button.className = "step";
    button.disabled = off;

    if (!off) {
      button.addEventListener("click", when);
    }

    return button;
  }

  function paint() {
    shownList.replaceChildren();
    spareList.replaceChildren();

    held.forEach((key, at) => {
      const one = known.get(key);
      const item = document.createElement("li");
      const name = document.createElement("span");
      const moves = document.createElement("span");

      name.className = "who";
      name.textContent = one.label;
      moves.className = "moves";
      moves.append(
        step("▲", `Move ${one.label} up`, at === 0, () => {
          held.splice(at - 1, 0, held.splice(at, 1)[0]);
          settle();
        }),
        step("▼", `Move ${one.label} down`, at === held.length - 1, () => {
          held.splice(at + 1, 0, held.splice(at, 1)[0]);
          settle();
        }),
        step("×", one.fixed ? `${one.label} is always shown` : `Hide ${one.label}`,
          one.fixed, () => {
            held = held.filter((other) => other !== key);
            settle();
          })
      );

      item.append(name, moves);
      shownList.append(item);
    });

    for (const one of every) {
      if (held.includes(one.key)) {
        continue;
      }

      const item = document.createElement("li");
      const add = document.createElement("button");

      add.type = "button";
      add.className = "add";
      add.textContent = one.label;
      add.title = `Show ${one.label}`;
      add.addEventListener("click", () => {
        held.push(one.key);
        settle();
      });

      item.append(add);
      spareList.append(item);
    }
  }

  paint();
}

wireColumns();
