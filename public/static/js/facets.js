const PAGE = 40;

function ask(facet, query, offset) {
  return fetch("/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `query($f:String!,$q:String,$page:Int,$per:Int){
        Page(page:$page,perPage:$per){
          pageInfo{hasNextPage}
          facetOptions(facet:$f,query:$q){value label held}}}`,
      variables: { f: facet, q: query || null, page: Math.floor(offset / PAGE) + 1, per: PAGE },
    }),
  })
    .then((one) => one.json())
    .then((body) => body?.data?.Page?.facetOptions ?? [])
    .catch(() => []);
}

function wire(pane) {
  const names = [...pane.querySelectorAll("[data-facet], [data-range]")];
  const bodies = [...pane.querySelectorAll("[data-body]")];

  function show(key) {
    for (const body of bodies) {
      body.hidden = body.dataset.body !== key;
    }

    for (const name of names) {
      name.classList.toggle("on", (name.dataset.facet ?? name.dataset.range) === key);
    }
  }

  for (const name of names) {
    name.addEventListener("click", () => show(name.dataset.facet ?? name.dataset.range));
  }

  for (const body of bodies) {
    const facet = body.dataset.body;
    const list = body.querySelector("[data-list]");
    const search = body.querySelector("[data-facet-search]");
    const field = body.querySelector("[data-picked]");

    if (!list || !field) {
      continue;
    }

    const tally = pane.querySelector(`[data-facet="${facet}"] [data-tally]`);
    const chosen = new Set(field.value.split(",").filter(Boolean));
    let offset = 0;
    let asking = false;
    let drained = false;
    let typed = "";

    function count() {
      field.value = [...chosen].join(",");

      if (tally) {
        tally.textContent = chosen.size > 0 ? String(chosen.size) : "";
      }
    }

    function add(rows) {
      for (const row of rows) {
        const item = document.createElement("li");
        const label = document.createElement("label");

        label.className = "optionrow";
        const box = document.createElement("input");
        const held = document.createElement("span");

        box.type = "checkbox";
        box.value = row.value;
        box.checked = chosen.has(row.value);
        box.addEventListener("change", () => {
          if (box.checked) {
            chosen.add(row.value);
          } else {
            chosen.delete(row.value);
          }

          count();
        });

        held.className = "optionheld";
        held.textContent = row.held > 0 ? String(row.held) : "";

        const name = document.createElement("span");

        name.className = "optionname";
        name.textContent = row.label;

        label.append(box, name, held);
        item.appendChild(label);
        list.appendChild(item);
      }
    }

    async function more() {
      if (asking || drained) {
        return;
      }

      asking = true;

      const rows = await ask(facet, typed, offset);

      if (rows.length < PAGE) {
        drained = true;
      }

      offset += rows.length;
      add(rows);
      asking = false;

      // a short list leaves nothing to scroll, so keep filling until it can
      if (!drained && list.scrollHeight <= list.clientHeight) {
        more();
      }
    }

    function restart() {
      offset = 0;
      drained = false;
      list.replaceChildren();
      more();
    }

    list.addEventListener("scroll", () => {
      if (list.scrollTop + list.clientHeight >= list.scrollHeight - 40) {
        more();
      }
    });

    if (search) {
      let waiting = null;

      search.addEventListener("input", () => {
        clearTimeout(waiting);
        waiting = setTimeout(() => {
          typed = search.value.trim();
          restart();
        }, 180);
      });
    }

    count();
    restart();
  }
}

document.querySelectorAll("[data-facets]").forEach(wire);

// A month has the days it has, so 31 February can never be offered.
function daysIn(month, year) {
  if (!month) {
    return 31;
  }

  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const at = Number(month) - 1;

  if (at === 1 && year) {
    const leap = Number(year) % 4 === 0 && (Number(year) % 100 !== 0 || Number(year) % 400 === 0);

    return leap ? 29 : 28;
  }

  return lengths[at] ?? 31;
}

function wireDates(root) {
  for (const end of root.querySelectorAll(".dateend")) {
    const day = end.querySelector("select[name$='_day']");
    const month = end.querySelector("select[name$='_month']");
    const year = end.querySelector("select[name$='_year']");

    if (!day || !month || !year) {
      continue;
    }

    const trim = () => {
      const allowed = daysIn(month.value, year.value);
      let dropped = false;

      for (const option of day.options) {
        const at = Number(option.value);
        const tooFar = at > allowed;

        option.hidden = tooFar;
        option.disabled = tooFar;

        if (tooFar && option.selected) {
          dropped = true;
        }
      }

      if (dropped) {
        day.value = "";
      }
    };

    month.addEventListener("change", trim);
    year.addEventListener("change", trim);
    trim();
  }
}

document.querySelectorAll("[data-facets]").forEach(wireDates);
