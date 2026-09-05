// Times are recorded in UTC and printed here in whatever zone the reader is in. The
// server has no way to know that zone, so the page arrives in UTC and is corrected once
// it opens; a reader with scripting off still sees a true time, just not their own.
function shownAs(when, withClock) {
  const parts = { year: "numeric", month: "2-digit", day: "2-digit" };

  if (withClock) {
    Object.assign(parts, { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  const held = new Intl.DateTimeFormat("en-CA", parts).format(when);

  return held.replace(",", "");
}

function localise(root) {
  root.querySelectorAll("[data-when]").forEach((one) => {
    const when = new Date(one.dataset.when);

    if (Number.isNaN(when.getTime())) {
      return;
    }

    const withClock = /\d:\d/.test(one.textContent);

    one.textContent = shownAs(when, withClock);
    one.title = `${one.dataset.when} UTC`;
  });
}

function reveal(root) {
  root.querySelectorAll("[data-reveal]").forEach((button) => {
    button.addEventListener("click", () => {
      const box = button.closest(".reveal");
      const secret = box.querySelector("[data-secret]");
      const masked = box.querySelector("[data-masked]");
      const hidden = secret.hidden;

      secret.hidden = !hidden;
      masked.hidden = hidden;
      button.textContent = hidden ? "Hide the key" : "Show the key";
    });
  });
}

function copying(root) {
  root.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const said = button.textContent;

      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        button.textContent = "Copied";
      } catch (refused) {
        button.textContent = "Copy failed";
      }

      setTimeout(() => { button.textContent = said; }, 1500);
    });
  });
}

// The server drops a day its month cannot hold, but a form should not let one be typed
// in the first place.
function daysIn(month, year) {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const at = Number(month) - 1;

  if (at < 0 || at > 11) {
    return 31;
  }

  if (at === 1) {
    const held = Number(year);
    const leap = held % 4 === 0 && (held % 100 !== 0 || held % 400 === 0);

    return year ? (leap ? 29 : 28) : 29;
  }

  return lengths[at];
}

function realDates(root) {
  root.querySelectorAll(".datefield").forEach((field) => {
    const day = field.querySelector("input[name$='_day']");
    const month = field.querySelector("select[name$='_month']");
    const year = field.querySelector("input[name$='_year']");

    if (!day || !month || !year) {
      return;
    }

    const trim = () => {
      const allowed = daysIn(month.value, year.value);

      day.max = String(allowed);

      if (Number(day.value) > allowed) {
        day.value = "";
      }
    };

    month.addEventListener("change", trim);
    year.addEventListener("change", trim);
    day.addEventListener("change", trim);
    trim();
  });
}

// The sheet is chosen by cookie on the server; the box only has to agree with it.
function themePicked(root) {
  const held = /(?:^|;)\s*theme=([a-z]+)/.exec(document.cookie);

  root.querySelectorAll("[data-theme-pick]").forEach((box) => {
    if (held && [...box.options].some((one) => one.value === held[1])) {
      box.value = held[1];
    }

    box.addEventListener("change", () => box.form.submit());
  });
}

localise(document);
themePicked(document);
reveal(document);
copying(document);
realDates(document);
