// ============================================
// AFMOD — App logic (pure JavaScript, no modules)
// Handles auth flow, view switching, dashboard rendering, and dialogs.
// Talks to /api/auth/* for sessions and /api/showroom/* for purchase events.
// ============================================
(function () {
  "use strict";

  // ---------- DOM helpers ----------
  var $ = function (id) { return document.getElementById(id); };
  var show = function (el) { if (el) el.classList.remove("hidden"); };
  var hide = function (el) { if (el) el.classList.add("hidden"); };

  // ---------- Tier styling ----------
  var TIER_CLASS = {
    "اقتصادي": "tier-economy",
    "متوسط":   "tier-medium",
    "فاخر":    "tier-luxury",
    "حصري":    "tier-exclusive"
  };

  // Local placeholder image (small SVG data-URI) shown if a wiki image fails.
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
        '<text x="160" y="170" font-family="serif" font-size="14" fill="#d4af37" ' +
          'text-anchor="middle" letter-spacing="2">AFMOD</text>' +
      '</svg>'
    );

  // ---------- Toast ----------
  function toast(title, body, variant) {
    var container = $("toast-container");
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
      setTimeout(function () { container.removeChild(el); }, 400);
    }, 4500);
  }

  // ---------- API ----------
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

  var api = {
    me:             function ()             { return apiFetch("/api/auth/me"); },
    request:        function (username)     { return apiFetch("/api/auth/request-code", { method: "POST", body: { discordUsername: username } }); },
    verify:         function (u, code)      { return apiFetch("/api/auth/verify-code",  { method: "POST", body: { discordUsername: u, code: code } }); },
    logout:         function ()             { return apiFetch("/api/auth/logout",       { method: "POST" }); },
    buyCar:         function (carId)        { return apiFetch("/api/showroom/buy-car",         { method: "POST", body: { carId: carId } }); },
    buyHouse:       function (houseId)      { return apiFetch("/api/showroom/buy-house",        { method: "POST", body: { houseId: houseId } }); },
    buyGasStation:  function (stationId)    { return apiFetch("/api/showroom/buy-gas-station",  { method: "POST", body: { stationId: stationId } }); },
    buyGrocery:     function (stationId)    { return apiFetch("/api/showroom/buy-grocery",      { method: "POST", body: { stationId: stationId } }); },
    balance:        function ()             { return apiFetch("/api/showroom/balance"); }
  };

  // ---------- State ----------
  var state = {
    currentUser: null,
    matchedUsername: "",
    expiresIn: 0,
    timerId: null,
    activeTab: "houses",
    activeBody: "ALL"
  };

  // ============================================
  // VIEW: bootstrapping
  // ============================================
  function showLoading() {
    show($("loading-screen"));
    hide($("login-view"));
    hide($("home-view"));
  }
  function showLogin() {
    hide($("loading-screen"));
    hide($("home-view"));
    show($("login-view"));
    resetLoginForm();
  }
  function showHome(user) {
    hide($("loading-screen"));
    hide($("login-view"));
    show($("home-view"));
    renderHome(user);
  }

  function bootstrap() {
    showLoading();
    api.me().then(function (user) {
      state.currentUser = user;
      showHome(user);
    }).catch(function () {
      state.currentUser = null;
      showLogin();
    });
  }

  // ============================================
  // LOGIN FLOW
  // ============================================
  function resetLoginForm() {
    show($("request-form"));
    hide($("verify-form"));
    $("discord-username").value = "";
    var slots = document.querySelectorAll(".otp-slot");
    slots.forEach(function (s) { s.value = ""; });
    if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
    setVerifyButtonEnabled(false);
  }

  function setVerifyButtonEnabled(enabled) {
    $("verify-submit").disabled = !enabled;
  }

  function getOtpValue() {
    var slots = document.querySelectorAll(".otp-slot");
    var v = "";
    slots.forEach(function (s) { v += s.value; });
    return v;
  }

  function setupOtpInputs() {
    var slots = Array.prototype.slice.call(document.querySelectorAll(".otp-slot"));
    slots.forEach(function (slot, i) {
      slot.addEventListener("input", function (e) {
        var v = e.target.value.replace(/\D/g, "");
        e.target.value = v.charAt(v.length - 1) || "";
        if (e.target.value && i < slots.length - 1) slots[i + 1].focus();
        setVerifyButtonEnabled(getOtpValue().length === 6);
      });
      slot.addEventListener("keydown", function (e) {
        if (e.key === "Backspace" && !e.target.value && i > 0) {
          slots[i - 1].focus();
        }
      });
      slot.addEventListener("paste", function (e) {
        e.preventDefault();
        var text = (e.clipboardData || window.clipboardData).getData("text").replace(/\D/g, "").slice(0, 6);
        for (var j = 0; j < slots.length; j++) {
          slots[j].value = text.charAt(j) || "";
        }
        var lastFilled = Math.min(text.length, slots.length) - 1;
        if (lastFilled >= 0 && lastFilled < slots.length - 1) slots[lastFilled + 1].focus();
        else if (lastFilled >= 0) slots[lastFilled].focus();
        setVerifyButtonEnabled(getOtpValue().length === 6);
      });
    });
  }

  function startTimer(seconds) {
    state.expiresIn = seconds;
    var timer = $("otp-timer");
    function render() {
      var m = Math.floor(state.expiresIn / 60);
      var s = state.expiresIn % 60;
      timer.textContent = m + ":" + (s < 10 ? "0" + s : s);
    }
    render();
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = setInterval(function () {
      state.expiresIn = Math.max(0, state.expiresIn - 1);
      render();
      if (state.expiresIn === 0) { clearInterval(state.timerId); state.timerId = null; }
    }, 1000);
  }

  function setupLoginHandlers() {
    var requestForm = $("request-form");
    var verifyForm  = $("verify-form");
    var requestBtn  = $("request-submit");
    var verifyBtn   = $("verify-submit");
    var restartBtn  = $("restart-btn");

    requestForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var username = $("discord-username").value.trim();
      if (!username) return;
      requestBtn.disabled = true;
      requestBtn.querySelector(".btn-label").textContent = "جاري الإرسال...";
      api.request(username).then(function (data) {
        state.matchedUsername = data.discordUsername;
        $("matched-username").textContent = "@" + data.discordUsername;
        hide(requestForm);
        show(verifyForm);
        startTimer(data.expiresInSeconds || 600);
        var first = document.querySelector(".otp-slot");
        if (first) first.focus();
      }).catch(function (err) {
        var msg = "حدث خطأ غير متوقع";
        if (err.status === 404) msg = "لم نجد مستخدم ديسكورد بهذا الاسم";
        else if (err.status === 403) msg = "البوت لا يستطيع إرسال رسالة خاصة لك. تأكد من أنك في سيرفر AFMOD و أن الرسائل الخاصة مفعّلة";
        else if (err.status === 429) msg = "الرجاء الانتظار قبل طلب رمز جديد";
        toast("خطأ", msg, "error");
      }).then(function () {
        requestBtn.disabled = false;
        requestBtn.querySelector(".btn-label").textContent = "اطلب رمز التحقق";
      });
    });

    verifyForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var code = getOtpValue();
      if (code.length !== 6) return;
      verifyBtn.disabled = true;
      verifyBtn.querySelector(".btn-label").textContent = "جاري التحقق...";
      api.verify(state.matchedUsername, code).then(function (user) {
        state.currentUser = user;
        if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
        showHome(user);
      }).catch(function () {
        toast("رمز غير صحيح", "الرمز الذي أدخلته غير صحيح أو منتهي الصلاحية", "error");
      }).then(function () {
        verifyBtn.disabled = getOtpValue().length !== 6;
        verifyBtn.querySelector(".btn-label").textContent = "تحقق و دخول";
      });
    });

    restartBtn.addEventListener("click", function () {
      resetLoginForm();
    });
  }

  // ============================================
  // HOME / DASHBOARD
  // ============================================
  function renderHome(user) {
    // Header user pill
    $("user-display-name").textContent = user.displayName;
    $("user-username").textContent = "@" + user.username;
    var avatarImg = $("user-avatar-img");
    var fallback = $("user-avatar-fallback");
    if (user.avatarUrl) {
      avatarImg.src = user.avatarUrl;
      avatarImg.alt = user.displayName;
      avatarImg.style.display = "";
      fallback.style.display = "none";
    } else {
      avatarImg.style.display = "none";
      fallback.style.display = "";
      fallback.textContent = (user.username || "").substring(0, 2).toUpperCase();
    }

    // Hero
    $("hero-citizen-name").textContent = user.displayName;

    // Houses
    var houses = window.HOUSES || [];
    $("houses-count").textContent = houses.length;
    renderHousesGrid(houses);

    // Cars
    var cars = window.CARS || [];
    $("cars-count").textContent = cars.length;
    renderCarFilters();
    renderCarsGrid();

    // Gas stations
    var stations = window.GAS_STATIONS || [];
    $("gas-count").textContent = stations.length;
    renderGasGrid(stations);

    // Grocery stores (stations that have grocery)
    var groceries = stations.filter(function (s) { return s.hasGrocery; });
    $("grocery-count").textContent = groceries.length;
    renderGroceryGrid(groceries);

    // Watermark — show immediately with spinner balance, update when loaded
    renderWatermark(user, null);
    api.balance().then(function (data) {
      var bal = (data && typeof data.balance === "number") ? data.balance : null;
      state.balance = bal;
      renderWatermark(user, bal);
    }).catch(function () {
      state.balance = null;
    });
  }

  // ============================================
  // TABS
  // ============================================
  function setupTabs() {
    var btns = document.querySelectorAll(".tab-btn");
    btns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var tab = btn.getAttribute("data-tab");
        switchTab(tab);
      });
    });
  }
  function switchTab(tab) {
    state.activeTab = tab;
    var btns = document.querySelectorAll(".tab-btn");
    btns.forEach(function (b) {
      var on = b.getAttribute("data-tab") === tab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    var panels = document.querySelectorAll(".tab-panel");
    panels.forEach(function (p) {
      if (p.id === "tab-" + tab) show(p); else hide(p);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ============================================
  // HOUSES
  // ============================================
  function renderHousesGrid(houses) {
    var grid = $("houses-grid");
    grid.innerHTML = "";
    houses.forEach(function (house, index) {
      var card = buildHouseCard(house, index);
      grid.appendChild(card);
    });
  }

  function buildHouseCard(house, index) {
    var formatPrice = window.formatPrice;
    var card = document.createElement("div");
    card.className = "house-card";
    card.style.animationDelay = (index * 0.07) + "s";

    var imageWrap = document.createElement("div");
    imageWrap.className = "house-card-image-wrap";
    imageWrap.innerHTML =
      '<img src="' + escapeAttr(house.cover) + '" alt="' + escapeAttr(house.nameAr) + '" loading="lazy" referrerpolicy="no-referrer" onerror="window.__afmodImageFallback(this)" />' +
      '<div class="house-card-image-overlay"></div>' +
      '<div class="house-card-tier"><span class="tier-badge ' + (TIER_CLASS[house.tier] || "tier-economy") + '">' + escapeText(house.tier) + '</span></div>' +
      '<div class="house-card-bottom">' +
        '<div class="house-card-price">' +
          '<div class="house-card-price-label">Price</div>' +
          '<div class="house-card-price-amount">' + escapeText(formatPrice(house.price)) + '</div>' +
        '</div>' +
        '<div class="house-card-units">' + escapeText(house.units + " وحدة") + '</div>' +
      '</div>';
    card.appendChild(imageWrap);

    var body = document.createElement("div");
    body.className = "house-card-body";
    body.innerHTML =
      '<h3 class="house-card-name">' + escapeText(house.nameAr) + '</h3>' +
      '<p class="house-card-name-en">' + escapeText(house.nameEn) + '</p>' +
      '<div class="house-card-features">' +
        featureRow(iconLocation(), house.locationsAr) +
        featureRow(iconBed(),      house.bedroomsAr) +
        featureRow(iconBath(),     house.bathroomsAr) +
      '</div>' +
      '<button class="btn-secondary" type="button">' +
        '<span>عرض التفاصيل والمعرض</span>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>' +
        '</svg>' +
      '</button>';
    card.appendChild(body);

    body.querySelector("button").addEventListener("click", function () {
      openGallery(house);
    });
    return card;
  }

  function featureRow(svg, text) {
    return '<div class="house-card-feature">' + svg + '<span>' + escapeText(text) + '</span></div>';
  }

  function iconLocation() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
  }
  function iconBed() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3"/><path d="M2 13h20v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/><path d="M6 13V9a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4"/></svg>';
  }
  function iconBath() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6 6.5 3.5a1.5 1.5 0 0 0-2 0l-1 1a1.5 1.5 0 0 0 0 2L6 9"/><line x1="22" y1="12" x2="2" y2="12"/><path d="M4 12v3a4 4 0 0 0 4 4h8a4 4 0 0 0 4-4v-3"/></svg>';
  }

  // ============================================
  // CARS
  // ============================================
  function renderCarFilters() {
    var bodies = window.CAR_BODIES || [];
    var bar = $("car-filters");
    bar.innerHTML = "";

    var all = document.createElement("button");
    all.type = "button";
    all.className = "filter-pill" + (state.activeBody === "ALL" ? " active" : "");
    all.setAttribute("data-body", "ALL");
    all.textContent = "الكل";
    bar.appendChild(all);

    bodies.forEach(function (b) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-pill" + (state.activeBody === b.key ? " active" : "");
      btn.setAttribute("data-body", b.key);
      btn.textContent = b.ar;
      bar.appendChild(btn);
    });

    bar.querySelectorAll(".filter-pill").forEach(function (b) {
      b.addEventListener("click", function () {
        state.activeBody = b.getAttribute("data-body");
        bar.querySelectorAll(".filter-pill").forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active");
        renderCarsGrid();
      });
    });
  }

  function renderCarsGrid() {
    var cars = window.CARS || [];
    var grid = $("cars-grid");
    grid.innerHTML = "";

    var filtered = state.activeBody === "ALL"
      ? cars
      : cars.filter(function (c) { return c.body === state.activeBody; });

    if (filtered.length === 0) {
      grid.innerHTML = '<p class="empty-state">لا توجد مركبات في هذه الفئة حالياً.</p>';
      return;
    }

    filtered.forEach(function (car, index) {
      grid.appendChild(buildCarCard(car, index));
    });
  }

  function buildCarCard(car, index) {
    var formatPrice = window.formatPrice;
    var card = document.createElement("div");
    card.className = "car-card";
    card.style.animationDelay = (index * 0.04) + "s";

    card.innerHTML =
      '<div class="car-card-image-wrap">' +
        '<img src="' + escapeAttr(car.image) + '" alt="' + escapeAttr(car.nameEn) + '" loading="lazy" referrerpolicy="no-referrer" onerror="window.__afmodImageFallback(this)" />' +
        '<div class="car-card-image-overlay"></div>' +
        '<div class="car-card-tier"><span class="tier-badge ' + (TIER_CLASS[car.tier] || "tier-economy") + '">' + escapeText(car.tier) + '</span></div>' +
        '<div class="car-card-class">' + escapeText(car.classAr) + '</div>' +
      '</div>' +
      '<div class="car-card-body">' +
        '<h3 class="car-card-name">' + escapeText(car.nameEn) + '</h3>' +
        '<p class="car-card-body-type">' + escapeText(car.bodyAr) + ' • ' + escapeText(car.fuelAr) + '</p>' +
        '<div class="car-card-stats">' +
          '<div class="car-stat"><span class="car-stat-label">السرعة</span><span class="car-stat-value">' + escapeText(car.topSpeed) + '</span></div>' +
          '<div class="car-stat"><span class="car-stat-label">0-100</span><span class="car-stat-value">' + escapeText(car.accel) + '</span></div>' +
        '</div>' +
        '<div class="car-card-bottom">' +
          '<div class="car-card-price">' +
            '<div class="car-card-price-label">Price</div>' +
            '<div class="car-card-price-amount">' + escapeText(formatPrice(car.price)) + '</div>' +
          '</div>' +
          '<button class="btn-secondary car-details-btn" type="button">تفاصيل</button>' +
        '</div>' +
      '</div>';

    card.querySelector(".car-details-btn").addEventListener("click", function () {
      openCarDialog(car);
    });
    return card;
  }

  // ============================================
  // GAS STATIONS
  // ============================================
  function renderGasGrid(stations) {
    var grid = $("gas-grid");
    grid.innerHTML = "";
    stations.forEach(function (st, index) {
      grid.appendChild(buildGasCard(st, index));
    });
  }
  function buildGasCard(st, index) {
    var formatPrice = window.formatPrice;
    var card = document.createElement("div");
    card.className = "gas-card";
    card.style.animationDelay = (index * 0.07) + "s";

    card.innerHTML =
      '<div class="gas-card-image-wrap">' +
        '<img src="' + escapeAttr(st.image) + '" alt="' + escapeAttr(st.nameAr) + '" loading="lazy" referrerpolicy="no-referrer" onerror="window.__afmodImageFallback(this)" />' +
        '<div class="gas-card-image-overlay"></div>' +
        '<div class="gas-card-name-wrap">' +
          '<h3 class="gas-card-name">' + escapeText(st.nameAr) + '</h3>' +
          '<p class="gas-card-name-en">' + escapeText(st.nameEn) + '</p>' +
        '</div>' +
      '</div>' +
      '<div class="gas-card-body">' +
        '<div class="gas-card-feature"><strong>الموقع:</strong> <span>' + escapeText(st.locationAr) + '</span></div>' +
        '<div class="gas-card-feature"><strong>عدد المضخات:</strong> <span>' + escapeText(String(st.pumps)) + '</span></div>' +
        '<div class="gas-card-feature"><strong>أنواع الوقود:</strong> <span>' + escapeText(st.fuelTypesAr.join("، ")) + '</span></div>' +
        '<div class="gas-card-feature"><strong>الخدمة:</strong> <span>' + escapeText(st.serviceAr) + '</span></div>' +
        (st.hasGrocery ? '<div class="gas-card-feature"><strong>البقالة:</strong> <span class="grocery-tag">✓ يحتوي على بقالة (تبويب مستقل)</span></div>' : '') +
        '<div class="gas-card-price-row">' +
          '<span class="gas-card-price-label">السعر الرسمي للوقود</span>' +
          '<span class="gas-card-price">' + escapeText(st.pricePerLiterAr) + '</span>' +
        '</div>' +
        (st.notesAr ? '<p class="gas-card-notes">' + escapeText(st.notesAr) + '</p>' : '') +
        '<div class="gas-card-buy-row">' +
          '<button class="btn-gas-station" type="button" data-id="' + escapeAttr(st.id) + '">' +
            '<span class="btn-label">شراء مشروع المحطة</span>' +
            '<span class="btn-gas-station-price">' + escapeText(formatPrice(st.price)) + '</span>' +
          '</button>' +
        '</div>' +
      '</div>';

    card.querySelector(".btn-gas-station").addEventListener("click", function () {
      handleBuyGasStation(st, card.querySelector(".btn-gas-station"));
    });
    return card;
  }

  // ============================================
  // GROCERY STORES
  // ============================================
  function renderGroceryGrid(groceries) {
    var grid = $("grocery-grid");
    grid.innerHTML = "";
    if (!groceries || groceries.length === 0) {
      grid.innerHTML = '<p class="empty-state">لا توجد محلات بقالة معروضة حالياً.</p>';
      return;
    }
    groceries.forEach(function (st, index) {
      grid.appendChild(buildGroceryCard(st, index));
    });
  }

  function buildGroceryCard(st, index) {
    var formatPrice = window.formatPrice;
    var card = document.createElement("div");
    card.className = "gas-card grocery-card";
    card.style.animationDelay = (index * 0.07) + "s";

    card.innerHTML =
      '<div class="gas-card-image-wrap">' +
        '<img src="' + escapeAttr(st.image) + '" alt="' + escapeAttr(st.nameAr) + ' — بقالة" loading="lazy" referrerpolicy="no-referrer" onerror="window.__afmodImageFallback(this)" />' +
        '<div class="gas-card-image-overlay grocery-overlay"></div>' +
        '<div class="gas-card-name-wrap">' +
          '<h3 class="gas-card-name">' + escapeText("بقالة " + st.nameAr) + '</h3>' +
          '<p class="gas-card-name-en">' + escapeText(st.nameEn + " — Grocery") + '</p>' +
        '</div>' +
      '</div>' +
      '<div class="gas-card-body">' +
        '<div class="gas-card-feature"><strong>الموقع:</strong> <span>' + escapeText(st.locationAr) + '</span></div>' +
        '<div class="gas-card-feature"><strong>النوع:</strong> <span>محل بقالة مرفق بالمحطة</span></div>' +
        '<div class="gas-card-feature"><strong>ساعات العمل:</strong> <span>٢٤ ساعة / ٧ أيام</span></div>' +
        '<div class="gas-card-feature"><strong>المشروع الأصلي:</strong> <span>' + escapeText(st.nameAr) + '</span></div>' +
        (st.notesAr ? '<p class="gas-card-notes">' + escapeText(st.notesAr) + '</p>' : '') +
        '<div class="gas-card-buy-row">' +
          '<button class="btn-gas-grocery" type="button" data-id="' + escapeAttr(st.id) + '">' +
            '<span class="btn-label">شراء مشروع البقالة</span>' +
            '<span class="btn-gas-grocery-price">' + escapeText(formatPrice(st.groceryPrice)) + '</span>' +
          '</button>' +
        '</div>' +
      '</div>';

    card.querySelector(".btn-gas-grocery").addEventListener("click", function () {
      handleBuyGrocery(st, card.querySelector(".btn-gas-grocery"));
    });
    return card;
  }

  function handleBuyGasStation(st, btn) {
    btn.disabled = true;
    btn.querySelector(".btn-label").textContent = "جاري إرسال الطلب...";
    api.buyGasStation(st.id).then(function () {
      toast("تم إرسال الطلب", "تم تسجيل طلب شراء " + st.nameAr + " كمشروع وسيتم تأكيده عبر البوت في الديسكورد.", "success");
    }).catch(function (err) {
      var msg = "تعذّر إرسال الطلب. حاول مرة أخرى.";
      if (err.status === 402) msg = "الرصيد البنكي غير كافٍ لإتمام الشراء.";
      else if (err.status === 409) msg = "هذه المحطة مملوكة بالفعل.";
      else if (err.status === 503) msg = "البوت غير متصل حالياً، يرجى المحاولة لاحقاً.";
      else if (err.status === 401) msg = "انتهت جلستك، يرجى تسجيل الدخول مجدداً.";
      toast("فشل الشراء", msg, "error");
    }).then(function () {
      btn.disabled = false;
      btn.querySelector(".btn-label").textContent = "شراء المشروع";
    });
  }

  function handleBuyGrocery(st, btn) {
    btn.disabled = true;
    btn.querySelector(".btn-label").textContent = "جاري إرسال الطلب...";
    api.buyGrocery(st.id).then(function () {
      toast("تم إرسال الطلب", "تم تسجيل طلب شراء بقالة " + st.nameAr + " وسيتم تأكيده عبر البوت في الديسكورد.", "success");
    }).catch(function (err) {
      var msg = "تعذّر إرسال الطلب. حاول مرة أخرى.";
      if (err.status === 402) msg = "الرصيد البنكي غير كافٍ لإتمام الشراء.";
      else if (err.status === 409) msg = "هذه البقالة مملوكة بالفعل.";
      else if (err.status === 503) msg = "البوت غير متصل حالياً، يرجى المحاولة لاحقاً.";
      else if (err.status === 401) msg = "انتهت جلستك، يرجى تسجيل الدخول مجدداً.";
      toast("فشل الشراء", msg, "error");
    }).then(function () {
      btn.disabled = false;
      btn.querySelector(".btn-label").textContent = "شراء البقالة";
    });
  }

  // ============================================
  // WATERMARK
  // ============================================
  function renderWatermark(user, balance) {
    var wm = $("watermark");
    wm.innerHTML = "";
    var displayName = user.displayName || "مواطن";
    var username = user.username || "";
    var avatar = user.avatarUrl || "";
    var balanceTxt = balance !== null && balance !== undefined
      ? "$" + Number(balance).toLocaleString("en-US")
      : "…";
    for (var i = 0; i < 30; i++) {
      var item = document.createElement("div");
      item.className = "watermark-item";
      var html = "";
      if (avatar) html += '<img src="' + escapeAttr(avatar) + '" alt="" />';
      else        html += '<div style="width:2rem;height:2rem;border-radius:50%;background:rgba(0,0,0,0.2);margin-bottom:0.25rem;"></div>';
      html += '<span class="wm-name">' + escapeText(displayName) + '</span>';
      html += '<span class="wm-user">@' + escapeText(username) + '</span>';
      html += '<span class="wm-balance">' + escapeText(balanceTxt) + '</span>';
      item.innerHTML = html;
      wm.appendChild(item);
    }
  }

  // ============================================
  // GALLERY DIALOG (HOUSES)
  // ============================================
  function openGallery(house) {
    var formatPrice = window.formatPrice;
    var dialog = $("gallery-dialog");
    $("dialog-tier").textContent = house.tier;
    $("dialog-title").textContent = house.nameAr;
    $("dialog-subtitle").textContent = house.nameEn;
    $("dialog-price").textContent = formatPrice(house.price);
    $("dialog-locations").textContent = house.locationsAr;
    $("dialog-bedrooms").textContent = house.bedroomsAr;
    $("dialog-bathrooms").textContent = house.bathroomsAr;
    $("dialog-units").textContent = house.units + " وحدة";

    var amen = $("dialog-amenities");
    amen.innerHTML = "";
    house.amenitiesAr.forEach(function (a) {
      var s = document.createElement("span");
      s.className = "amenity-badge";
      s.textContent = a;
      amen.appendChild(s);
    });

    var notesWrap = $("dialog-notes-wrapper");
    if (house.notesAr) {
      $("dialog-notes").textContent = house.notesAr;
      show(notesWrap);
    } else {
      hide(notesWrap);
    }

    var gallery = $("dialog-gallery");
    gallery.innerHTML = "";
    var coverItem = document.createElement("div");
    coverItem.className = "gallery-item cover-item";
    coverItem.innerHTML =
      '<img class="gallery-item-image" src="' + escapeAttr(house.cover) + '" alt="' + escapeAttr(house.nameAr) + '" loading="lazy" referrerpolicy="no-referrer" onerror="window.__afmodImageFallback(this)" />' +
      '<div class="gallery-item-caption">Exterior • الواجهة الخارجية</div>';
    gallery.appendChild(coverItem);

    house.gallery.forEach(function (g) {
      var item = document.createElement("div");
      item.className = "gallery-item";
      item.innerHTML =
        '<img class="gallery-item-image" src="' + escapeAttr(g.url) + '" alt="' + escapeAttr(g.captionAr) + '" loading="lazy" referrerpolicy="no-referrer" onerror="window.__afmodImageFallback(this)" />' +
        '<div class="gallery-item-caption">' + escapeText(g.captionAr) + '</div>';
      gallery.appendChild(item);
    });

    show(dialog);
    document.body.style.overflow = "hidden";
  }
  function closeGallery() {
    hide($("gallery-dialog"));
    document.body.style.overflow = "";
  }

  // ============================================
  // CAR DIALOG
  // ============================================
  function openCarDialog(car) {
    var formatPrice = window.formatPrice;
    $("car-dialog-tier").textContent = car.tier;
    $("car-dialog-title").textContent = car.nameEn;
    $("car-dialog-subtitle").textContent = car.bodyAr + " • " + car.classAr;
    $("car-dialog-price").textContent = formatPrice(car.price);

    var img = $("car-dialog-image");
    img.src = car.image;
    img.alt = car.nameEn;
    img.onerror = function () { window.__afmodImageFallback(img); };

    $("car-dialog-speed").textContent = car.topSpeed;
    $("car-dialog-accel").textContent = car.accel;
    $("car-dialog-body").textContent = car.bodyAr;
    $("car-dialog-fuel").textContent = car.fuelAr;
    $("car-dialog-class-badge").textContent = "فئة: " + car.classAr;
    $("car-dialog-body-badge").textContent = "هيكل: " + car.bodyAr;
    $("car-dialog-fuel-badge").textContent = "وقود: " + car.fuelAr;

    var buyBtn = $("car-dialog-buy");
    buyBtn.disabled = false;
    buyBtn.querySelector(".btn-label").textContent = "شراء المركبة";
    buyBtn.onclick = function () { handleBuyCar(car, buyBtn); };

    show($("car-dialog"));
    document.body.style.overflow = "hidden";
  }
  function closeCarDialog() {
    hide($("car-dialog"));
    document.body.style.overflow = "";
  }
  function handleBuyCar(car, btn) {
    btn.disabled = true;
    btn.querySelector(".btn-label").textContent = "جاري إرسال الطلب...";
    api.buyCar(car.id).then(function (res) {
      toast("تم إرسال الطلب", "تم تسجيل طلب شراء " + car.nameEn + " وسيتم تأكيده عبر البوت في الديسكورد.", "success");
      closeCarDialog();
    }).catch(function (err) {
      var msg = "تعذّر إرسال الطلب. حاول مرة أخرى.";
      if (err.status === 402) msg = "الرصيد البنكي غير كافٍ لإتمام الشراء.";
      else if (err.status === 503) msg = "البوت غير متصل حالياً، يرجى المحاولة لاحقاً.";
      else if (err.status === 401) msg = "انتهت جلستك، يرجى تسجيل الدخول مجدداً.";
      toast("فشل الشراء", msg, "error");
    }).then(function () {
      btn.disabled = false;
      btn.querySelector(".btn-label").textContent = "شراء المركبة";
    });
  }

  // ============================================
  // DIALOG SETUP
  // ============================================
  function setupDialogHandlers() {
    $("dialog-close").addEventListener("click", closeGallery);
    $("gallery-dialog").addEventListener("click", function (e) {
      if (e.target === e.currentTarget) closeGallery();
    });
    $("car-dialog-close").addEventListener("click", closeCarDialog);
    $("car-dialog").addEventListener("click", function (e) {
      if (e.target === e.currentTarget) closeCarDialog();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (!$("gallery-dialog").classList.contains("hidden")) closeGallery();
        if (!$("car-dialog").classList.contains("hidden")) closeCarDialog();
      }
    });
  }

  // ============================================
  // LOGOUT
  // ============================================
  function setupLogoutHandler() {
    $("logout-btn").addEventListener("click", function () {
      var btn = $("logout-btn");
      btn.disabled = true;
      api.logout().then(function () {
        state.currentUser = null;
        showLogin();
      }).catch(function () {
        toast("خطأ", "تعذّر تسجيل الخروج، حاول مرة أخرى", "error");
      }).then(function () {
        btn.disabled = false;
      });
    });
  }

  // ============================================
  // IMAGE FALLBACK (handles flaky CDN/wiki images)
  // ============================================
  // Exposed on window so inline onerror handlers can call it.
  // Strategy: 1) retry once with cache-bust, 2) swap to local SVG placeholder.
  window.__afmodImageFallback = function (imgEl) {
    if (!imgEl) return;
    var attempts = parseInt(imgEl.getAttribute("data-fallback-attempts") || "0", 10);
    if (attempts === 0) {
      imgEl.setAttribute("data-fallback-attempts", "1");
      var sep = imgEl.src.indexOf("?") >= 0 ? "&" : "?";
      imgEl.src = imgEl.src.split("#")[0] + sep + "_r=" + Date.now();
      return;
    }
    if (attempts === 1) {
      imgEl.setAttribute("data-fallback-attempts", "2");
      imgEl.classList.add("img-fallback");
      imgEl.src = IMAGE_FALLBACK;
      imgEl.onerror = null;
    }
  };

  // ============================================
  // ESCAPE HELPERS
  // ============================================
  function escapeText(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function escapeAttr(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ============================================
  // INIT
  // ============================================
  document.addEventListener("DOMContentLoaded", function () {
    setupOtpInputs();
    setupLoginHandlers();
    setupDialogHandlers();
    setupLogoutHandler();
    setupTabs();
    bootstrap();
  });
})();
