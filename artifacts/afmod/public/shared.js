// AFMOD — Shared utilities (auth, header, toast, API)
// Each page includes this script to get common functionality.
(function () {
  "use strict";

  // ── API ──────────────────────────────────────────────────────────────────
  function apiFetch(path, options) {
    options = options || {};
    options.credentials = "include";
    options.headers = options.headers || {};
    if (options.body && typeof options.body !== "string") {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(options.body);
    }
    return fetch(path, options).then(function (res) {
      if (!res.ok) {
        return res.json().then(function (data) {
          var err = new Error(data && data.message ? data.message : "Request failed");
          err.status = res.status;
          err.data = data;
          throw err;
        }, function () {
          var err = new Error("Request failed");
          err.status = res.status;
          throw err;
        });
      }
      if (res.status === 204) return null;
      return res.json();
    });
  }

  window.afApi = {
    me:              function () { return apiFetch("/api/auth/me"); },
    logout:          function () { return apiFetch("/api/auth/logout", { method: "POST" }); },
    balance:         function () { return apiFetch("/api/showroom/balance"); },
    myProperties:    function () { return apiFetch("/api/showroom/my-properties"); },
    request:         function (u)   { return apiFetch("/api/auth/request-code", { method: "POST", body: { discordUsername: u } }); },
    verify:          function (u,c) { return apiFetch("/api/auth/verify-code",  { method: "POST", body: { discordUsername: u, code: c } }); },
    buyCar:          function (id)  { return apiFetch("/api/showroom/buy-car",        { method: "POST", body: { carId: id } }); },
    buyHouse:        function (id)  { return apiFetch("/api/showroom/buy-house",       { method: "POST", body: { houseId: id } }); },
    houseOwned:      function ()    { return apiFetch("/api/showroom/houses-owned"); },
    buyGasStation:   function (id)  { return apiFetch("/api/showroom/buy-gas-station", { method: "POST", body: { stationId: id } }); },
    buyGrocery:      function (id)  { return apiFetch("/api/showroom/buy-grocery",     { method: "POST", body: { stationId: id } }); },
    buyBarber:       function (id)  { return apiFetch("/api/showroom/buy-barber",       { method: "POST", body: { shopId: id } }); },
    buyBusiness:     function (type, id) { return apiFetch("/api/showroom/buy-business", { method: "POST", body: { businessType: type, shopId: id } }); },
    // Manufacturing system
    manufactureStatus:      function () { return apiFetch("/api/manufacture/status"); },
    manufactureMine:        function () { return apiFetch("/api/manufacture/mine",         { method: "POST" }); },
    manufactureBuyTable:    function () { return apiFetch("/api/manufacture/buy-table",    { method: "POST" }); },
    manufactureCraftWeapon: function () { return apiFetch("/api/manufacture/craft-weapon", { method: "POST" }); },
    manufactureAdminGive:   function (d) { return apiFetch("/api/manufacture/admin-give",  { method: "POST", body: d }); },
    // House rental system
    houseMyListing:  function (id)  { return apiFetch("/api/house/my-listing?houseId=" + encodeURIComponent(id)); },
    houseListings:   function ()    { return apiFetch("/api/house/listings"); },
    houseSetRental:  function (d)   { return apiFetch("/api/house/set-rental",  { method: "POST", body: d }); },
    houseState:      function (id)  { return apiFetch("/api/house/state?houseId=" + encodeURIComponent(id)); },
    houseRent:       function (d)   { return apiFetch("/api/house/rent",        { method: "POST", body: d }); },
    houseWithdraw:   function (id)  { return apiFetch("/api/house/withdraw",    { method: "POST", body: { houseId: id } }); },
  };

  // ── Toast ────────────────────────────────────────────────────────────────
  function toast(title, body, variant) {
    var container = document.getElementById("toast-container");
    if (!container) return;
    var el = document.createElement("div");
    el.className = "toast" + (variant === "error" ? " toast-error" : "");
    var t = document.createElement("div");
    t.className = "toast-title";
    t.textContent = title;
    var b = document.createElement("div");
    b.className = "toast-body";
    b.textContent = body;
    el.appendChild(t);
    el.appendChild(b);
    container.appendChild(el);
    setTimeout(function () {
      el.style.transition = "opacity 0.4s, transform 0.4s";
      el.style.opacity = "0";
      el.style.transform = "translateY(8px)";
      setTimeout(function () { if (container.contains(el)) container.removeChild(el); }, 400);
    }, 4500);
  }
  window.afToast = toast;

  // ── Price formatter ──────────────────────────────────────────────────────
  window.formatPrice = function (n) {
    if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000)     return "$" + Math.round(n / 1_000) + "K";
    return "$" + n;
  };

  // ── Image fallback ───────────────────────────────────────────────────────
  var IMAGE_FALLBACK =
    'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0" stop-color="#0a1f4d"/>' +
          '<stop offset="1" stop-color="#050f29"/>' +
        '</linearGradient></defs>' +
        '<rect width="320" height="200" fill="url(#g)"/>' +
        '<g fill="none" stroke="#d4af37" stroke-width="2" opacity="0.6">' +
          '<rect x="80" y="60" width="160" height="80" rx="6"/>' +
          '<line x1="80" y1="100" x2="240" y2="100"/>' +
        '</g>' +
        '<text x="160" y="170" font-family="serif" font-size="14" fill="#d4af37" text-anchor="middle" letter-spacing="2">AFMOD</text>' +
      '</svg>'
    );
  window.__afmodImageFallback = function (img) { img.src = IMAGE_FALLBACK; };

  // ── HTML escape ──────────────────────────────────────────────────────────
  window.escText = function (s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };
  window.escAttr = function (s) { return window.escText(s); };

  // ── Auth check (redirects to ministry only on 401/403) ───────────────────
  window.afCheckAuth = function (callback) {
    function attempt(isRetry) {
      window.afApi.me().then(function (user) {
        try { callback(user); } catch (cbErr) { console.error("[afmod] page init error:", cbErr); }
      }, function (err) {
        var status = err && err.status;
        if (status === 401 || status === 403) {
          window.location.href = "ministry.html";
        } else if (!isRetry) {
          // network/server hiccup — retry once after 1.2s
          setTimeout(function () { attempt(true); }, 1200);
        } else {
          window.location.href = "ministry.html";
        }
      });
    }
    attempt(false);
  };

  // ── Render shared header ──────────────────────────────────────────────────
  window.afRenderHeader = function (user, activePage) {
    var header = document.getElementById("site-header");
    if (!header) return;

    var nav = [
      { key: "houses",        label: "السكن",              href: "houses.html" },
      { key: "cars",          label: "السيارات",           href: "cars.html" },
      { key: "gas",           label: "محطات الوقود",      href: "gas.html" },
      { key: "grocery",       label: "محلات البقالة",     href: "grocery.html" },
      { key: "barber",        label: "محلات الحلاقة",     href: "barber.html" },
      { key: "manufacture",   label: "التصنيع",            href: "manufacture.html" },
      { key: "my-properties", label: "ممتلكاتي",          href: "my-properties.html" },
    ];

    var navLinks = nav.map(function (n) {
      var active = n.key === activePage ? " nav-active" : "";
      return '<a href="' + n.href + '" class="nav-link' + active + '">' + n.label + '</a>';
    }).join("");

    var avatarHtml = user.avatarUrl
      ? '<img src="' + escAttr(user.avatarUrl) + '" alt="" />'
      : '<span class="user-avatar-fallback">' + escText((user.username || "").substring(0, 2).toUpperCase()) + '</span>';

    header.innerHTML =
      '<div class="container header-content">' +
        '<a href="ministry.html" class="header-brand">' +
          '<img src="afmod-logo.png" alt="AFMOD Logo" class="header-logo" />' +
          '<div class="header-titles">' +
            '<span class="header-title-ar">وزارة اللوجستيك — عرب فيرست</span>' +
            '<span class="header-title-en">ARAB FIRST — MINISTRY OF LOGISTICS</span>' +
          '</div>' +
        '</a>' +
        '<nav class="header-nav">' + navLinks + '</nav>' +
        '<div class="header-user">' +
          '<div id="header-balance" class="header-balance">رصيد: <span id="balance-val">…</span></div>' +
          '<div class="user-pill">' +
            '<div class="user-pill-text">' +
              '<span class="user-display-name">' + escText(user.displayName) + '</span>' +
              '<span class="user-username" dir="ltr">@' + escText(user.username) + '</span>' +
            '</div>' +
            '<div class="user-avatar">' + avatarHtml + '</div>' +
          '</div>' +
          '<button id="logout-btn" class="btn-icon" title="تسجيل الخروج">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
              '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>' +
              '<polyline points="16 17 21 12 16 7"/>' +
              '<line x1="21" y1="12" x2="9" y2="12"/>' +
            '</svg>' +
          '</button>' +
        '</div>' +
      '</div>';

    var logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        window.afApi.logout().then(function () { window.location.href = "/"; }).catch(function () { window.location.href = "/"; });
      });
    }

    // Load balance
    window.afApi.balance().then(function (data) {
      var val = document.getElementById("balance-val");
      if (val) val.textContent = (data && typeof data.balance === "number") ? window.formatPrice(data.balance) : "—";
    }).catch(function () {
      var val = document.getElementById("balance-val");
      if (val) val.textContent = "—";
    });
  };

  // ── Watermark ────────────────────────────────────────────────────────────
  window.afRenderWatermark = function (user) {
    var wm = document.getElementById("watermark");
    if (!wm) return;
    wm.innerHTML = "";
    var displayName = user.displayName || "مواطن";
    for (var i = 0; i < 30; i++) {
      var item = document.createElement("div");
      item.className = "watermark-item";
      item.innerHTML = escText(displayName) + ' <span class="wm-sep">|</span> AFMOD';
      wm.appendChild(item);
    }
  };

  window.escText = window.escText;
  function escAttr(s) { return window.escText(s); }

})();
