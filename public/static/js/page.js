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

localise(document);
reveal(document);
copying(document);
