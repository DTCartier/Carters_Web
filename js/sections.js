// Simple client-side partial loader with cache + History API
(function () {
  const app = document.getElementById("app");

  // Map section -> partial path
  const PARTIALS = {
    home: "sections/home.html",
    mission: "sections/mission.html",
    values: "sections/values.html",
    services: "sections/services.html",
    contact: "sections/contact.html",
  };

  const cache = new Map();

  // Initial load from URL (?s=mission) or default to 'home'
  const params = new URLSearchParams(location.search);
  const initial = params.get("s") || "home";
  loadSection(initial, false);

  // Navbar click handling
  document.addEventListener("click", (e) => {
    const link = e.target.closest("[data-section]");
    if (!link) return;
    e.preventDefault();
    loadSection(link.getAttribute("data-section"), true);
  });

  // Back/forward support
  window.addEventListener("popstate", () => {
    const s = new URLSearchParams(location.search).get("s") || "home";
    loadSection(s, false);
  });

  async function loadSection(section, push) {
    if (!PARTIALS[section]) section = "home";

    let html;
    if (cache.has(section)) {
      html = cache.get(section);
    } else {
      try {
        const res = await fetch(PARTIALS[section], {
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        html = await res.text();
        cache.set(section, html);
      } catch (err) {
        html = `<section class="section"><div class="container"><p class="text-danger">Failed to load "${section}".</p></div></section>`;
      }
    }

    // Inject partial
    app.innerHTML = html;

    // Toggle navbar style class (matches your old behavior)
    const nav = document.querySelector("nav.navbar");
    nav.classList.remove(
      "home-style",
      "mission-style",
      "values-style",
      "services-style",
      "contact-style"
    );
    nav.classList.add(`${section}-style`);

    // Active link UI
    document.querySelectorAll("[data-section]").forEach((a) => {
      a.classList.toggle("active", a.getAttribute("data-section") === section);
    });

    // Update URL
    if (push) {
      const url = new URL(location.href);
      url.searchParams.set("s", section);
      history.pushState({}, "", url);
    }

    // Optional: scroll to top
    window.scrollTo({ top: 0, behavior: "instant" });
  }
})();
