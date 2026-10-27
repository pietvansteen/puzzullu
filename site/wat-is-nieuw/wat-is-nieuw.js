/* Puzzullu — release notes from /changelog.json (newest first). */
(function () {
  "use strict";

  const { esc } = window.PZ;
  const box = document.getElementById("changes");

  // a line may link a word to a page of the site, markdown style: "de [generator](/generator/) kan nu …"
  const regel = (c) => esc(c).replace(/\[([^\]]+)\]\((\/[\w\/-]*)\)/g, '<a href="$2">$1</a>');
  const dag = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });

  fetch("/changelog.json", { cache: "no-cache" })
    .then((r) => r.json())
    .then((versies) => {
      box.innerHTML = versies.map((v, i) => `
        <article class="release">
          <header><h2>v${esc(v.version)}</h2><time datetime="${esc(v.date)}">${esc(dag(v.date))}</time>${i === 0 ? '<span class="now">nu live</span>' : ""}</header>
          <ul>${v.changes.map((c) => `<li>${regel(c)}</li>`).join("")}</ul>
        </article>`).join("");
    })
    .catch(() => { box.innerHTML = `<p class="empty">De lijst met wijzigingen kon niet worden geladen. Probeer het over een paar minuten opnieuw.</p>`; });
})();
