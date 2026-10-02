let allSchemes = [],
  allPartners = [],
  selectedScheme = null;

const MIN_LOAN_LIMIT = 1000;

const $ = (id) => document.getElementById(id);

function money(v) {
  const n = Number(v);

  return Number.isFinite(n)
    ? new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(n)
    : "—";
}

function esc(v) {
  const d = document.createElement("div");
  d.textContent = v ?? "";
  return d.innerHTML;
}

function toast(msg) {
  const c = $("toastContainer");

  if (!c) return;

  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;

  c.appendChild(t);

  setTimeout(() => t.remove(), 3200);
}

async function jsonFetch(url, options = {}) {
  const r = await fetch(url, options);
  const d = await r
    .json()
    .catch(() => ({ success: false, error: "Invalid server response" }));

  if (!r.ok || d.success === false) {
    throw new Error(d.error || `Request failed (${r.status})`);
  }

  return d;
}

function scrollToTop() {
  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}

function scrollToSection(id) {
  const toolbarLink = document.querySelector(
    `.navbar a[href="#${id}"]`
  );

  if (toolbarLink) {
    toolbarLink.click();
    return;
  }

  const section = document.getElementById(id);

  if (section) {
    section.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
}

function schemeName(s) {
  return s.name || s.scheme_name || s.title || "Government Scheme";
}

async function initializeApplication() {
  initializeLanguage();
  bindEvents();
  initializeLocationDropdowns();
  initializeChatbot();
  await loadSchemes();
  await Promise.all([loadSyncStatus(), loadPartners()]);
}



const teamMembers = [
    { image: "/static/images/GauravImage.jpg", i18nKey: "team.member1" },
    { image: "/static/images/BhumikaImage.jpg", i18nKey: "team.member2" },
    { image: "/static/images/AabhaasImage.jpg", i18nKey: "team.member3" },
    { image: "/static/images/OmImage.jpg", i18nKey: "team.member4" },
    { image: "/static/images/PariImage.jpg", i18nKey: "team.member5" },
    { image: "/static/images/ShivanshImage.jpg", i18nKey: "team.member6" }
];

function openTeamMember(index) {
    const member = teamMembers[index];

    if (!member) {
        return;
    }

    const modal = $("schemeModal");
    const modalBody = $("modalBody");

    if (!modal || !modalBody) {
        return;
    }

    window.__openTeamMemberIndex = index;

    const memberName = t(`${member.i18nKey}.name`);

    let imageContent = "";

    if (member.image && member.image.trim() !== "") {
        imageContent = `
            <div class="team-modal-photo">
                <img
                    src="${esc(member.image)}"
                    alt="${esc(memberName)}"
                    class="team-modal-image"
                    onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
                >
                <div class="team-modal-avatar" style="display:none;">
                    TM
                </div>
            </div>
        `;
    } else {
        imageContent = `
            <div class="team-modal-avatar">
                TM
            </div>
        `;
    }

    modalBody.innerHTML = `
        <div class="team-modal">

            ${imageContent}

            <div class="team-modal-name">
                ${esc(memberName)}
            </div>

            <div class="team-modal-role">
                ${esc(t(`${member.i18nKey}.role`))}
            </div>

            <div class="team-modal-section">
                <strong>${esc(t("team.roleInProject"))}</strong>
                <p>${esc(t(`${member.i18nKey}.projectRole`))}</p>
            </div>

            <div class="team-modal-section">
                <strong>${esc(t("team.aboutMe"))}</strong>
                <p>${esc(t(`${member.i18nKey}.about`))}</p>
            </div>

        </div>
    `;

      

    modal.classList.remove("hidden");
    modal.classList.remove("is-closing");
    modal.setAttribute("aria-hidden", "false");

    document.body.classList.add("modal-open");

    requestAnimationFrame(() => {
        modal.classList.add("is-open");
    });

    const closeButton = $("modalClose");

    if (closeButton) {
        closeButton.focus();
    }
}

function setupOtherDropdown(selectId, inputId, wrapperId) {
  const select = $(selectId);
  const input = $(inputId);
  const wrapper = wrapperId ? $(wrapperId) : input;

  if (!select || !input) return;

  const update = () => {
    const isOther = select.value === "Other";
    const target = wrapper || input;

    if (target) {
      target.classList.toggle("hidden", !isOther);
    }

    if (isOther) {
      input.focus();
    } else {
      input.value = "";
    }
  };

  select.addEventListener("change", update);
  update();
}

function bindEvents() {
  initializeTheme();

  setupOtherDropdown("category", "categoryOther");
  setupOtherDropdown("requirementType", "requirementOther");
  setupOtherDropdown("familyIncome", "familyIncomeOther", "familyIncomeOtherWrap");
  setupOtherDropdown("projectCost", "projectCostOther", "projectCostOtherWrap");
  setupOtherDropdown("educationStatus", "educationStatusOther");
  setupOtherDropdown("courseField", "courseFieldOther");

  $("profileForm").addEventListener("submit", submitProfile);

  $("calculatorScheme").addEventListener("change", () =>
    populateCalculator(true)
  );

  $("modalClose").addEventListener("click", closeSchemeModal);

  $("schemeModal").addEventListener("click", (e) => {
    if (e.target === $("schemeModal")) closeSchemeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (
      e.key === "Escape" &&
      !$("schemeModal").classList.contains("hidden")
    ) {
      closeSchemeModal();
    }
  });

  document.querySelectorAll(".impact-card").forEach((c) =>
    c.addEventListener("click", () => scrollToSection(c.dataset.target))
  );

  enhanceAllSelects();
}



const customSelectRegistry = new Map();

function closeAllCustomSelects(except) {
  document.querySelectorAll(".custom-select.is-open").forEach((wrap) => {
    if (wrap !== except) wrap.classList.remove("is-open");
  });
}

function enhanceSelect(selectEl) {
  if (!selectEl || selectEl.dataset.enhanced === "true") return;
  selectEl.dataset.enhanced = "true";

  const wrap = document.createElement("div");
  wrap.className = "custom-select";

  selectEl.parentNode.insertBefore(wrap, selectEl);
  wrap.appendChild(selectEl);
  selectEl.classList.add("custom-select-native");

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "custom-select-trigger";

  const triggerLabel = document.createElement("span");
  triggerLabel.className = "custom-select-trigger-label";
  trigger.appendChild(triggerLabel);
  wrap.appendChild(trigger);

  const panel = document.createElement("div");
  panel.className = "custom-select-panel";
  wrap.appendChild(panel);

  function renderOptions() {
    panel.innerHTML = "";

    Array.from(selectEl.options).forEach((opt, idx) => {
      const item = document.createElement("div");
      item.className = "custom-select-option";
      item.textContent = opt.textContent.trim();

      item.addEventListener("click", () => {
        if (selectEl.selectedIndex !== idx) {
          selectEl.selectedIndex = idx;
          selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        }
        closeAllCustomSelects();
      });

      panel.appendChild(item);
    });

    syncFromSelect();
  }

  function syncFromSelect() {
    const opt = selectEl.options[selectEl.selectedIndex];
    triggerLabel.textContent = opt ? opt.textContent.trim() : "";
    triggerLabel.classList.toggle("is-placeholder", !opt || opt.value === "");
    trigger.disabled = selectEl.disabled;

    Array.from(panel.children).forEach((item, idx) => {
      item.classList.toggle("is-selected", idx === selectEl.selectedIndex);
    });
  }

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (wrap.classList.contains("is-open")) {
      wrap.classList.remove("is-open");
    } else {
      closeAllCustomSelects();
      wrap.classList.add("is-open");
    }
  });

  selectEl.addEventListener("change", syncFromSelect);

  customSelectRegistry.set(selectEl, { renderOptions, syncFromSelect });
  renderOptions();
}

function refreshCustomSelect(selectEl) {
  const entry = customSelectRegistry.get(selectEl);
  if (entry) entry.syncFromSelect();
}

function refreshCustomSelectOptions(selectEl) {
  const entry = customSelectRegistry.get(selectEl);
  if (entry) entry.renderOptions();
}

function refreshAllCustomSelects() {
  customSelectRegistry.forEach((entry) => entry.renderOptions());
}



function enhanceLocationCombobox(inputEl, datalistEl) {
  if (!inputEl || !datalistEl || inputEl.dataset.enhanced === "true") return;
  inputEl.dataset.enhanced = "true";
  inputEl.removeAttribute("list");

  const wrap = inputEl.parentNode;
  wrap.classList.add("custom-select", "custom-combobox");

  const panel = document.createElement("div");
  panel.className = "custom-select-panel";
  wrap.appendChild(panel);
  

  function renderOptions(applyFilter = true) {
    const query = applyFilter ? inputEl.value.trim().toLowerCase() : "";
    panel.innerHTML = "";

    const options = Array.from(datalistEl.options);

    if (!options.length) {
      const empty = document.createElement("div");
      empty.className = "custom-select-empty";
      empty.textContent = inputEl.disabled
        ? inputEl.placeholder
        : "No matches";
      panel.appendChild(empty);
      return;
    }

    let anyVisible = false;

    options.forEach((opt) => {
      const label = opt.value;
      if (query && !label.toLowerCase().includes(query)) return;
      anyVisible = true;

      const item = document.createElement("div");
      item.className = "custom-select-option";
      item.textContent = label;
      item.classList.toggle("is-selected", label === inputEl.value);

      
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        inputEl.value = label;
        inputEl.dispatchEvent(new Event("input", { bubbles: true }));
        inputEl.dispatchEvent(new Event("change", { bubbles: true }));
        wrap.classList.remove("is-open");
      });

      panel.appendChild(item);
    });

    if (!anyVisible) {
      const empty = document.createElement("div");
      empty.className = "custom-select-empty";
      empty.textContent = "No matches";
      panel.appendChild(empty);
    }
  }

  inputEl.addEventListener("focus", () => {
    if (inputEl.disabled) return;
    closeAllCustomSelects(wrap);
    renderOptions(false);
    wrap.classList.add("is-open");
    
    inputEl.select();
  });

  inputEl.addEventListener("input", () => {
    renderOptions(true);
    wrap.classList.add("is-open");
  });

  inputEl.addEventListener("blur", () => {
    setTimeout(() => wrap.classList.remove("is-open"), 120);
  });

  
  new MutationObserver(renderOptions).observe(datalistEl, { childList: true });

  customSelectRegistry.set(inputEl, {
    renderOptions,
    syncFromSelect: renderOptions,
  });
}

function enhanceAllSelects() {
  [
    "category",
    "familyIncome",
    "requirementType",
    "projectCost",
    "educationStatus",
    "courseField",
    "calculatorScheme",
    "schemeCategoryFilter",
    "schemeStatusFilter",
  ].forEach((id) => enhanceSelect($(id)));

  ["loanAmount", "interestRate", "tenureYears"].forEach(enhanceNumberStepper);

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".custom-select")) closeAllCustomSelects();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllCustomSelects();
  });

  const form = $("profileForm");
  if (form) {
    form.addEventListener("reset", () => setTimeout(refreshAllCustomSelects, 0));
  }
}



function enhanceNumberStepper(inputId) {
  const input = $(inputId);
  if (!input || input.dataset.stepperEnhanced === "true") return;
  input.dataset.stepperEnhanced = "true";

  const minus = document.querySelector(
    `.stepper-minus[data-stepper-target="${inputId}"]`
  );
  const plus = document.querySelector(
    `.stepper-plus[data-stepper-target="${inputId}"]`
  );
  if (!minus || !plus) return;

  const step = parseFloat(input.step) || 1;
  const min = input.min !== "" ? parseFloat(input.min) : -Infinity;
  const max = input.max !== "" ? parseFloat(input.max) : Infinity;
  const decimals = (String(step).split(".")[1] || "").length;

  function currentValue() {
    const v = parseFloat(input.value);
    return Number.isFinite(v) ? v : Math.max(0, min === -Infinity ? 0 : min);
  }

  function commit(value) {
    const clamped = Math.min(max, Math.max(min, value));
    input.value = decimals ? clamped.toFixed(decimals) : String(clamped);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    syncButtons();
  }

  function syncButtons() {
    const v = currentValue();
    minus.disabled = v <= min;
    plus.disabled = v >= max;
  }

  minus.addEventListener("click", () => commit(currentValue() - step));
  plus.addEventListener("click", () => commit(currentValue() + step));
  input.addEventListener("input", syncButtons);

  syncButtons();
}

async function loadSchemes() {
  try {
    const d = await jsonFetch("/api/schemes");

    allSchemes = Array.isArray(d.schemes)
      ? d.schemes.filter((s) => Number(s.loan_limit) >= MIN_LOAN_LIMIT)
      : [];

    renderSchemes();
    populateSchemeSelect();

    const count = d.count ?? allSchemes.length;

    $("statSchemes").textContent = count;
    $("heroSchemeCount").textContent = count;

    await loadSyncStatus();
  } catch (e) {
    allSchemes = [];

    $("schemesContainer").innerHTML =
      '<div class="empty">Unable to load schemes: ' +
      esc(e.message) +
      "</div>";

    $("statSchemes").textContent = "—";
    $("heroSchemeCount").textContent = "—";

    toast(e.message);
  }
}

async function loadPartners() {
  try {
    const d = await jsonFetch("/api/partners");

    allPartners = Array.isArray(d.partners) ? d.partners : [];

    $("statPartners").textContent = d.count ?? allPartners.length;
  } catch (e) {
    allPartners = [];
    $("statPartners").textContent = "—";
  }
}

async function loadSyncStatus() {
  try {
    const d = await jsonFetch("/api/sync-status");
    const s = d.schemes || {};

    $("statLastSync").textContent = s.last_updated
      ? formatDate(s.last_updated)
      : "—";

    $("syncMessage").textContent = `${
      s.count ?? allSchemes.length
    } scheme records currently loaded.`;

    $("syncStatus").textContent = "READY";
  } catch (e) {
    $("statLastSync").textContent = "—";
    $("syncStatus").textContent = "UNAVAILABLE";
    $("syncMessage").textContent = e.message;
  }
}

async function refreshData() {
  const bs = document.querySelectorAll(".refresh,.sync-right button");

  bs.forEach((b) => (b.disabled = true));

  const rb = document.querySelector(".refresh");

  if (rb) rb.textContent = "↻ Refreshing...";

  try {
    await jsonFetch("/api/refresh", {
      method: "POST",
    });

    toast("Government data refresh completed.");

    await loadSchemes();
    await loadSyncStatus();
    await loadPartners();
  } catch (e) {
    toast("Refresh failed: " + e.message);
  } finally {
    bs.forEach((b) => (b.disabled = false));

    if (rb) rb.textContent = "↻ Refresh Data";
  }
}

function renderSchemes() {
  const q = ($("schemeSearch")?.value || "").trim().toLowerCase();
  const cat = ($("schemeCategoryFilter")?.value || "")
    .trim()
    .toLowerCase();
  const status = ($("schemeStatusFilter")?.value || "")
    .trim()
    .toUpperCase();

  const filtered = allSchemes
    .map((scheme, index) => ({
      scheme,
      index,
    }))
    .filter(({ scheme }) => {
      const text = JSON.stringify(scheme).toLowerCase();

      return (
        (!q || text.includes(q)) &&
        (!cat || text.includes(cat)) &&
        (!status ||
          String(scheme.status || "").toUpperCase() === status)
      );
    });

  if (!filtered.length) {
    $("schemesContainer").innerHTML =
      '<div class="empty">No schemes match the current filters.</div>';

    return;
  }

  $("schemesContainer").innerHTML = filtered
    .map(({ scheme, index }) => schemeCard(scheme, index))
    .join("");

  attachSchemeCardEvents();
}

function filterSchemes() {
  renderSchemes();
}

function schemeCard(s, index) {
  const rates = Array.isArray(s.interest_rates)
    ? s.interest_rates.join("–") + "%"
    : s.interest_rate ?? "Not specified";

  return `
    <article
      class="scheme-card scheme-clickable"
      tabindex="0"
      role="button"
      aria-label="View details for ${esc(schemeName(s))}"
      data-scheme-index="${index}"
    >
      <span class="tag">${esc(
        s.status || "GOVERNMENT SCHEME"
      )}</span>

      <h3>${esc(schemeName(s))}</h3>

      <p>${esc(
        s.description ||
          s.purpose ||
          "Government financial assistance scheme."
      )}</p>

      <div class="scheme-meta">
        <div>
          <small>Loan Limit</small>
          <b>${money(s.loan_limit)}</b>
        </div>

        <div>
          <small>Interest</small>
          <b>${esc(String(rates))}</b>
        </div>

        <div>
          <small>Income Limit</small>
          <b>${money(s.income_limit)}</b>
        </div>

        <div>
          <small>Repayment</small>
          <b>${
            s.repayment_years
              ? esc(s.repayment_years) + " yrs"
              : "—"
          }</b>
        </div>
      </div>
    </article>
  `;
}

function attachSchemeCardEvents() {
  document.querySelectorAll(".scheme-clickable").forEach((card) => {
    const open = () =>
      showScheme(Number(card.dataset.schemeIndex));

    card.addEventListener("click", open);

    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  });
}

function populateSchemeSelect() {
  const s = $("calculatorScheme");

  s.innerHTML =
    '<option value="">Select a scheme</option>' +
    allSchemes
      .map(
        (x, i) =>
          `<option value="${i}">${esc(schemeName(x))}</option>`
      )
      .join("");

  refreshCustomSelectOptions(s);
}

function selectScheme(i) {
  $("calculatorScheme").value = i;
  refreshCustomSelect($("calculatorScheme"));
  populateCalculator(true);
  scrollToSection("calculator");
}

function populateCalculator(overwrite = false) {
  const i = $("calculatorScheme").value;

  if (i === "") return;

  selectedScheme = allSchemes[Number(i)];

  if (!selectedScheme) return;

  const s = selectedScheme;

  const r = Array.isArray(s.interest_rates)
    ? s.interest_rates
        .filter((v) => Number.isFinite(Number(v)))
        .map(Number)
    : [];

  if (overwrite || !$("loanAmount").value) {
    $("loanAmount").value = s.loan_limit
      ? Math.min(Number(s.loan_limit), 100000)
      : 100000;
  }

  if (overwrite || !$("interestRate").value) {
    $("interestRate").value = r.length ? r[0] : "";
  }

  if (overwrite || !$("tenureYears").value) {
    $("tenureYears").value = s.repayment_years || "";
  }
}

async function calculateEMI() {
  const i = $("calculatorScheme").value;

  if (i === "") {
    toast("Select a scheme first.");
    return;
  }

  populateCalculator(false);

  const loanAmount = Number($("loanAmount").value);
  const interestRate = Number($("interestRate").value);
  const tenureYears = Number($("tenureYears").value);

  if (!Number.isFinite(loanAmount) || loanAmount < MIN_LOAN_LIMIT) {
    toast("Enter a loan amount of at least ₹1,000.");
    return;
  }

  if (!Number.isFinite(interestRate) || interestRate < 0) {
    toast("Enter a valid interest rate.");
    return;
  }

  if (!Number.isFinite(tenureYears) || tenureYears <= 0) {
    toast("Enter a valid repayment period.");
    return;
  }

  try {
    const d = await jsonFetch("/api/calculate-emi", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scheme: allSchemes[Number(i)],
        loan_amount: loanAmount,
        interest_rate: interestRate,
        tenure_years: tenureYears,
      }),
    });

    const emi =
      d.emi ??
      d.monthly_emi ??
      d.monthly_payment ??
      d.emi_amount ??
      d.monthly_installment;

    const total =
      d.total_repayment ??
      d.total_repayment_amount ??
      d.total_payment ??
      d.total_amount ??
      d.total_payable;

    if (!Number.isFinite(Number(emi))) {
      throw new Error(
        "The server did not return a valid EMI value."
      );
    }

    if (!Number.isFinite(Number(total))) {
      throw new Error(
        "The server did not return a valid total repayment value."
      );
    }

    const result = $("calculatorResult");

    result.classList.remove("hidden");

    $("emiValue").textContent = money(emi);

    $("resultPrincipal").textContent = money(
      d.loan_amount ?? loanAmount
    );

    $("resultRate").textContent =
      (d.interest_rate ?? interestRate) + "%";

    $("resultTotal").textContent = money(total);

    result.style.overflow = "hidden";
    result.style.maxHeight = "0";
    result.style.opacity = "0";
    result.style.transform = "translateY(-12px)";
    result.style.transition =
      "max-height 500ms ease, opacity 350ms ease, transform 500ms ease";

    requestAnimationFrame(() => {
      result.style.maxHeight = result.scrollHeight + "px";
      result.style.opacity = "1";
      result.style.transform = "translateY(0)";
    });

    setTimeout(() => {
      result.style.maxHeight = "none";
    }, 520);

  } catch (e) {
    const result = $("calculatorResult");

    result.classList.add("hidden");
    result.style.maxHeight = "";
    result.style.opacity = "";
    result.style.transform = "";
    result.style.transition = "";

    toast("Calculator: " + e.message);
  }
}

async function submitProfile(ev) {
  ev.preventDefault();

  const category =
    $("category").value === "Other"
      ? $("categoryOther").value.trim()
      : $("category").value;

  const requirementType =
    $("requirementType").value === "Other"
      ? $("requirementOther").value.trim()
      : $("requirementType").value;

  const familyIncome =
    $("familyIncome").value === "Other"
      ? Number($("familyIncomeOther").value)
      : Number($("familyIncome").value);

  const projectCost =
    $("projectCost").value === "Other"
      ? Number($("projectCostOther").value)
      : Number($("projectCost").value);

  const educationStatus =
    $("educationStatus").value === "Other"
      ? $("educationStatusOther").value.trim()
      : $("educationStatus").value;

  const course =
    $("courseField").value === "Other"
      ? $("courseFieldOther").value.trim()
      : $("courseField").value;

  const location = [
    $("cityDistrict").value.trim(),
    $("state").value.trim()
  ].filter(Boolean).join(", ");

  $("location").value = location;

  if (!category) {
    toast("Enter an applicant category.");
    return;
  }

  if (!Number.isFinite(familyIncome) || familyIncome < 0) {
    toast("Select or enter a valid annual family income.");
    return;
  }

  if (!requirementType) {
    toast("Enter a requirement type.");
    return;
  }

  if (!Number.isFinite(projectCost) || projectCost <= 0) {
    toast("Select or enter a valid project or course cost.");
    return;
  }

  const payload = {
    category: category,
    family_income: familyIncome,
    project_type: requirementType,
    project_cost: projectCost,
    education_status:
      $("educationRequired").checked ||
      educationStatus,
    education_level: educationStatus,
    course: course,
    location: location,
    purpose: $("purpose").value,
    limit: 6,
  };

  const box = $("recommendationsContainer");

  box.innerHTML =
    '<div class="empty"><span class="spinner"></span><p>AI is evaluating available schemes...</p></div>';

  try {
    const d = await jsonFetch("/api/match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const matchCount = renderRecommendations(d.matches || []);
    scrollToSection("recommendations");
    return { ok: true, count: matchCount };
  } catch (e) {
    box.innerHTML =
      '<div class="empty">Matching failed: ' +
      esc(e.message) +
      "</div>";

    toast(e.message);
    throw e;
  }
}

function renderRecommendations(matches) {
  const box = $("recommendationsContainer");

  const valid = Array.isArray(matches)
    ? matches.filter((m) => {
        const s = m.scheme || m;
        return Number(s.loan_limit) >= MIN_LOAN_LIMIT;
      })
    : [];

  if (!valid.length) {
    box.innerHTML =
      '<div class="empty">No verified schemes currently match the supplied profile.</div>';

    return 0;
  }

  box.innerHTML = valid
    .map((m) => {
      const s = m.scheme || m;

      let i = allSchemes.indexOf(s);

      if (i === -1) {
        i = allSchemes.findIndex(
          (x) => schemeName(x) === schemeName(s)
        );
      }

      const score = Number(m.score);

      const reasons = Array.isArray(m.reasons)
        ? m.reasons.join(" ")
        : "";

      const rates = Array.isArray(s.interest_rates)
        ? s.interest_rates.join("–") + "%"
        : s.interest_rate ?? "—";

      return `
        <article
          class="scheme-card scheme-clickable recommendation-card"
          tabindex="0"
          role="button"
          aria-label="View AI recommendation details for ${esc(
            schemeName(s)
          )}"
          data-scheme-index="${i}"
        >
          <span class="tag">${
            Number.isFinite(score)
              ? Math.round(score) + "% AI MATCH"
              : "AI RECOMMENDED"
          }</span>

          <h3>${esc(schemeName(s))}</h3>

          <p>${esc(
            reasons ||
              m.summary ||
              s.description ||
              "Suitable based on your profile."
          )}</p>

          <div class="scheme-meta">
            <div>
              <small>Loan Limit</small>
              <b>${money(s.loan_limit)}</b>
            </div>

            <div>
              <small>Interest</small>
              <b>${esc(String(rates))}</b>
            </div>

            <div>
              <small>Eligibility</small>
              <b>${esc(
                m.eligibility_status || "Eligible"
              )}</b>
            </div>

            <div>
              <small>Project Cost</small>
              <b>${money(
                s.project_cost_limit || s.max_project_cost
              )}</b>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  attachRecommendationCardEvents();

  return valid.length;
}

function attachRecommendationCardEvents() {
  document
    .querySelectorAll(".recommendation-card")
    .forEach((card) => {
      const open = () => {
        const i = Number(card.dataset.schemeIndex);

        if (Number.isInteger(i) && i >= 0) {
          showScheme(i);
        } else {
          toast("Scheme details are unavailable.");
        }
      };

      card.addEventListener("click", open);

      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    });
}

function showScheme(i) {
  const s = allSchemes[i];

  if (!s) {
    toast("Scheme details are unavailable.");
    return;
  }

  window.__openTeamMemberIndex = null;

  const rates = Array.isArray(s.interest_rates)
    ? s.interest_rates.join("–") + "%"
    : s.interest_rate ?? "Not specified";

  const fields = [
    ["Status", s.status || "Not confirmed"],
    [
      "Maximum Loan",
      s.loan_limit != null
        ? money(s.loan_limit)
        : "Not specified",
    ],
    [
      "Income Limit",
      s.income_limit != null
        ? money(s.income_limit)
        : "Not specified",
    ],
    ["Interest Rate", rates],
    [
      "Repayment Period",
      s.repayment_years != null
        ? `${s.repayment_years} years`
        : "Not specified",
    ],
    [
      "Moratorium",
      s.moratorium_months != null
        ? `${s.moratorium_months} months`
        : "Not specified",
    ],
  ];

  if (s.project_cost_limit != null) {
    fields.push([
      "Project Cost Limit",
      money(s.project_cost_limit),
    ]);
  } else if (s.max_project_cost != null) {
    fields.push([
      "Maximum Project Cost",
      money(s.max_project_cost),
    ]);
  }

  if (s.category) {
    fields.push(["Category", s.category]);
  }

  if (s.purpose) {
    fields.push(["Purpose", s.purpose]);
  }

  if (s.partner_type) {
    fields.push(["Channel Partner", s.partner_type]);
  }

  if (s.course) {
    fields.push(["Course / Field", s.course]);
  }

  if (s.location) {
    fields.push(["Location", s.location]);
  }

  $("modalBody").innerHTML = `
    <div class="scheme-modal-content">
      <span class="tag">${esc(
        s.status || "GOVERNMENT SCHEME"
      )}</span>

      <h2 id="modalTitle">${esc(schemeName(s))}</h2>

      <p class="scheme-description">${esc(
        s.description ||
          s.purpose ||
          "Government financial assistance scheme."
      )}</p>

      <div class="scheme-detail-grid">
        ${fields
          .map(
            ([l, v]) => `
              <div class="scheme-detail">
                <small>${esc(l)}</small>
                <b>${esc(String(v))}</b>
              </div>
            `
          )
          .join("")}
      </div>

      ${
        s.source_url
          ? `
            <div class="scheme-source">
              <small>Official Scheme Page</small>
              <a
                href="${esc(s.source_url)}"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Official Scheme ↗
              </a>
            </div>
          `
          : `
            <div class="scheme-source">
              <small>Official Scheme Page</small>
              <span>Scheme-specific source link unavailable</span>
            </div>
          `
      }

      <div class="modal-actions">
        <button
          type="button"
          class="secondary"
          onclick="closeSchemeModal()"
        >
          Close
        </button>

        <button
          type="button"
          class="primary"
          onclick="selectScheme(${i});closeSchemeModal()"
        >
          Calculate EMI
        </button>
      </div>
    </div>
  `;

  $("schemeModal").classList.remove("hidden");
  $("schemeModal").setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");

  requestAnimationFrame(() =>
    $("schemeModal").classList.add("is-open")
  );

  $("modalClose").focus();
}

function closeSchemeModal() {
  const modal = $("schemeModal");

  window.__openTeamMemberIndex = null;

  if (modal.classList.contains("hidden")) return;

  modal.classList.remove("is-open");
  modal.classList.add("is-closing");
  modal.setAttribute("aria-hidden", "true");

  setTimeout(() => {
    modal.classList.add("hidden");
    modal.classList.remove("is-closing");
    document.body.classList.remove("modal-open");
  }, 260);
}

function findNearbyPartners() {
  if (!navigator.geolocation) {
    toast("Geolocation is not supported by this browser.");
    return;
  }

  $("locationStatus").textContent =
    "Requesting your location...";

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const d = await jsonFetch("/api/route", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            limit: 5,
          }),
        });

        renderPartners(
          d.alternatives ||
            (d.partner ? [d.partner] : [])
        );

        $("locationStatus").textContent = d.routing_available
          ? "Nearest available partner found."
          : "No routable partner is currently available.";
      } catch (e) {
        $("locationStatus").textContent = e.message;
        toast(e.message);
      }
    },
    (err) => {
      $("locationStatus").textContent =
        "Location access was not granted: " + err.message;
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000,
    }
  );
}

function renderPartners(partners) {
  const box = $("partnersContainer");

  if (!partners.length) {
    box.innerHTML =
      '<div class="empty">No partner locations with usable coordinates are currently available.</div>';

    return;
  }

  box.innerHTML = partners
    .map(
      (p) => `
        <article class="scheme-card">
          <span class="tag">CHANNEL PARTNER</span>

          <h3>${esc(
            p.name || p.partner_name || "Partner"
          )}</h3>

          <p>${esc(
            p.address ||
              p.location ||
              "Location information available in partner data."
          )}</p>

          <div class="scheme-meta">
            <div>
              <small>Distance</small>
              <b>${
                p.distance_km != null
                  ? Number(p.distance_km).toFixed(1) + " km"
                  : "—"
              }</b>
            </div>

            <div>
              <small>Status</small>
              <b>${esc(p.status || "Available")}</b>
            </div>
          </div>
        </article>
      `
    )
    .join("");
}

function formatDate(v) {
  if (!v) return "—";

  const d = new Date(v);

  if (Number.isNaN(d.getTime())) return "—";

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  const time = d.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return `${day}/${month}/${year}, ${time}`;
}

function clearRecommendations() {
  setTimeout(() => {
    $("recommendationsContainer").innerHTML =
      '<div class="empty">Submit your profile to see recommendations.</div>';
  }, 0);
}

function setTheme(mode, animate = true) {
  const dark = mode === "dark";

  const applyTheme = () => {
    document.documentElement.classList.toggle(
      "dark-mode",
      dark
    );

    document.body.classList.toggle(
      "dark-mode",
      dark
    );

    const icon = $("themeIcon");
    const iconMoon = $("iconMoon");
    const iconSun = $("iconSun");

    if (iconMoon && iconSun) {
      iconMoon.hidden = dark;
      iconSun.hidden = !dark;
    } else if (icon) {
      icon.textContent = dark ? "☀" : "☾";
    }

    const button = $("themeToggle");

    if (button) {
      button.setAttribute(
        "aria-pressed",
        String(dark)
      );

      button.setAttribute(
        "aria-label",
        dark
          ? "Switch to light mode"
          : "Switch to dark mode"
      );

      button.title = dark
        ? "Switch to light mode"
        : "Switch to dark mode";
    }

    localStorage.setItem(
      "schemematch-theme",
      dark ? "dark" : "light"
    );
  };

  if (
    !animate ||
    !document.startViewTransition
  ) {
    applyTheme();
    return;
  }

  let style = document.getElementById(
    "theme-wipe-style"
  );

  if (!style) {
    style = document.createElement("style");
    style.id = "theme-wipe-style";
    document.head.appendChild(style);
  }

  style.textContent = `
    html {
      view-transition-name: root;
    }

    ::view-transition-old(root) {
      animation: none;
    }

    ::view-transition-new(root) {
      animation-duration: ${
        dark ? "520ms" : "300ms"
      };
      animation-timing-function: ease-in-out;
      animation-fill-mode: both;
    }

    @keyframes wipe-right-to-left {
      from {
        clip-path: inset(0 0 0 100%);
      }
      to {
        clip-path: inset(0 0 0 0);
      }
    }

    @keyframes wipe-left-to-right {
      from {
        clip-path: inset(0 100% 0 0);
      }
      to {
        clip-path: inset(0 0 0 0);
      }
    }

    ::view-transition-new(root) {
      animation-name: ${
        dark
          ? "wipe-right-to-left"
          : "wipe-left-to-right"
      };
    }
  `;

  document.startViewTransition(() => {
    applyTheme();
  });
}

function toggleTheme() {
  setTheme(
    document.body.classList.contains("dark-mode")
      ? "light"
      : "dark"
  );
}

function initializeTheme() {
  const saved = localStorage.getItem(
    "schemematch-theme"
  );

  const preferred =
    window.matchMedia &&
    window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches
      ? "dark"
      : "light";

  setTheme(saved || preferred, false);

  const button = $("themeToggle");

  if (button) {
    button.addEventListener("click", toggleTheme);
  }
}

document.querySelectorAll(".faq-item").forEach(item => {
  const summary = item.querySelector("summary");
  const answer = item.querySelector("p");

  summary.addEventListener("click", event => {
    event.preventDefault();

    if (item.open) {
      item.classList.remove("is-open");

      answer.style.maxHeight = answer.scrollHeight + "px";

      requestAnimationFrame(() => {
        answer.style.maxHeight = "0";
        answer.style.opacity = "0";
        answer.style.marginBottom = "0";
      });

      answer.addEventListener("transitionend", function closeFAQ(e) {
        if (e.propertyName === "max-height") {
          item.removeAttribute("open");
          answer.removeEventListener("transitionend", closeFAQ);
        }
      });
    } else {
      item.setAttribute("open", "");
      item.classList.add("is-open");

      answer.style.maxHeight = "0";
      answer.style.opacity = "0";
      answer.style.marginBottom = "0";

      requestAnimationFrame(() => {
        answer.style.maxHeight = answer.scrollHeight + "px";
        answer.style.opacity = "1";
        answer.style.marginBottom = "20px";
      });
    }
  });
});

window.scrollToTop = scrollToTop;
window.scrollToSection = scrollToSection;
window.refreshData = refreshData;
window.filterSchemes = filterSchemes;
window.calculateEMI = calculateEMI;
window.findNearbyPartners = findNearbyPartners;
window.showScheme = showScheme;
window.openTeamMember = openTeamMember;
window.closeSchemeModal = closeSchemeModal;
window.selectScheme = selectScheme;
window.clearRecommendations = clearRecommendations;
window.toggleTheme = toggleTheme;

window.addEventListener(
  "DOMContentLoaded",
  initializeApplication
)

function initializeLocationDropdowns() {
  const stateInput = $("state");
  const districtInput = $("cityDistrict");
  const districtList = $("cityDistrictOptions");

  if (!stateInput || !districtInput || !districtList) return;

  const districtsByState = {"Andhra Pradesh":["Alluri Sitharama Raju","Anakapalli","Ananthapuramu","Annamayya","Bapatla","Chittoor","Dr B R Ambedkar Konaseema","East Godavari","Eluru","Guntur","Kakinada","Krishna","Kurnool","NTR","Nandyal","Nellore","Palnadu","Parvathipuram Manyam","Prakasam","Sri Sathya Sai","Srikakulam","Tirupati","Visakhapatnam","Vizianagaram","West Godavari","YSR Kadapa"],"Arunachal Pradesh":["Anjaw","Changlang","Dibang Valley","East Kameng","East Siang","Itanagar Capital Complex","Kamle","Keyi Panyor","Kra Daadi","Kurung Kumey","Lepa Rada","Lohit","Longding","Lower Dibang Valley","Lower Siang","Lower Subansiri","Namsai","Papum Pare","Shi Yomi","Siang","Tawang","Tirap","Upper Siang","Upper Subansiri","West Kameng","West Siang"],"Assam":["Baksa","Barpeta","Biswanath","Bongaigaon","Cachar","Charaideo","Chirang","Darrang","Dhemaji","Dhubri","Dibrugarh","Dima Hasao","Goalpara","Golaghat","Hailakandi","Hojai","Jorhat","Kamrup","Kamrup Metropolitan","Karbi Anglong","Karimganj","Kokrajhar","Lakhimpur","Majuli","Morigaon","Nagaon","Nalbari","Sivasagar","Sonitpur","South Salmara-Mankachar","Tamulpur","Tinsukia","Udalguri","West Karbi Anglong"],"Bihar":["Araria","Arwal","Aurangabad","Banka","Begusarai","Bhagalpur","Bhojpur","Buxar","Darbhanga","East Champaran","Gaya","Gopalganj","Jamui","Jehanabad","Kaimur","Katihar","Khagaria","Kishanganj","Lakhisarai","Madhepura","Madhubani","Munger","Muzaffarpur","Nalanda","Nawada","Patna","Purnia","Rohtas","Saharsa","Samastipur","Saran","Sheikhpura","Sheohar","Sitamarhi","Siwan","Supaul","Vaishali","West Champaran"],"Chhattisgarh":["Balod","Baloda Bazar-Bhatapara","Balrampur-Ramanujganj","Bastar","Bemetara","Bijapur","Bilaspur","Dantewada","Dhamtari","Durg","Gariaband","Gauravpath? ","Gaurela-Pendra-Marwahi","Janjgir-Champa","Jashpur","Kabirdham","Kanker","Khairagarh-Chhuikhadan-Gandai","Kondagaon","Korba","Koriya","Mahasamund","Manendragarh-Chirmiri-Bharatpur","Mungeli","Narayanpur","Raigarh","Raipur","Rajnandgaon","Sakti","Sarangarh-Bilaigarh","Sukma","Surajpur","Surguja"],"Goa":["North Goa","South Goa"],"Gujarat":["Ahmedabad","Amreli","Anand","Aravalli","Banaskantha","Bharuch","Bhavnagar","Botad","Chhota Udepur","Dahod","Dang","Devbhumi Dwarka","Gandhinagar","Gir Somnath","Jamnagar","Junagadh","Kheda","Kutch","Mahisagar","Mehsana","Morbi","Narmada","Navsari","Panchmahal","Patan","Porbandar","Rajkot","Sabarkantha","Surat","Surendranagar","Tapi","Vadodara","Valsad"],"Haryana":["Ambala","Bhiwani","Charkhi Dadri","Faridabad","Fatehabad","Gurugram","Hisar","Jhajjar","Jind","Kaithal","Karnal","Kurukshetra","Mahendragarh","Nuh","Palwal","Panchkula","Panipat","Rewari","Rohtak","Sirsa","Sonipat","Yamunanagar"],"Himachal Pradesh":["Bilaspur","Chamba","Hamirpur","Kangra","Kinnaur","Kullu","Lahaul and Spiti","Mandi","Shimla","Sirmaur","Solan","Una"],"Jharkhand":["Bokaro","Chatra","Deoghar","Dhanbad","Dumka","East Singhbhum","Garhwa","Giridih","Godda","Gumla","Hazaribagh","Jamtara","Khunti","Koderma","Latehar","Lohardaga","Pakur","Palamu","Ramgarh","Ranchi","Sahibganj","Saraikela-Kharsawan","Simdega","West Singhbhum"],"Karnataka":["Bagalkot","Ballari","Belagavi","Bengaluru Rural","Bengaluru Urban","Bidar","Chamarajanagar","Chikkaballapur","Chikkamagaluru","Chitradurga","Dakshina Kannada","Davanagere","Dharwad","Gadag","Hassan","Haveri","Kalaburagi","Kodagu","Kolar","Koppal","Mandya","Mysuru","Raichur","Ramanagara","Shivamogga","Tumakuru","Udupi","Uttara Kannada","Vijayapura","Yadgir"],"Kerala":["Alappuzha","Ernakulam","Idukki","Kannur","Kasaragod","Kollam","Kottayam","Kozhikode","Malappuram","Palakkad","Pathanamthitta","Thiruvananthapuram","Thrissur","Wayanad"],"Madhya Pradesh":["Agar-Malwa","Alirajpur","Anuppur","Ashoknagar","Balaghat","Barwani","Betul","Bhind","Bhopal","Burhanpur","Chhatarpur","Chhindwara","Damoh","Datia","Dewas","Dhar","Dindori","Guna","Gwalior","Harda","Indore","Jabalpur","Jhabua","Katni","Khandwa","Khargone","Maihar","Mandla","Mandsaur","Mauganj","Morena","Narmadapuram","Narsinghpur","Neemuch","Niwari","Panna","Raisen","Rajgarh","Ratlam","Rewa","Sagar","Satna","Sehore","Seoni","Shahdol","Shajapur","Sheopur","Shivpuri","Sidhi","Singrauli","Tikamgarh","Ujjain","Umaria","Vidisha"],"Maharashtra":["Ahilyanagar","Akola","Amravati","Beed","Bhandara","Buldhana","Chandrapur","Chhatrapati Sambhajinagar","Dharashiv","Dhule","Gadchiroli","Gondia","Hingoli","Jalgaon","Jalna","Kolhapur","Latur","Mumbai City","Mumbai Suburban","Nagpur","Nanded","Nandurbar","Nashik","Palghar","Parbhani","Pune","Raigad","Ratnagiri","Sangli","Satara","Sindhudurg","Solapur","Thane","Wardha","Washim","Yavatmal"],"Manipur":["Bishnupur","Chandel","Churachandpur","Imphal East","Imphal West","Jiribam","Kakching","Kamjong","Kangpokpi","Noney","Pherzawl","Senapati","Tamenglong","Tengnoupal","Thoubal","Ukhrul"],"Meghalaya":["East Garo Hills","East Jaintia Hills","East Khasi Hills","North Garo Hills","Ri Bhoi","South Garo Hills","South West Garo Hills","South West Khasi Hills","West Garo Hills","West Jaintia Hills","West Khasi Hills"],"Mizoram":["Aizawl","Champhai","Hnahthial","Khawzawl","Kolasib","Lawngtlai","Lunglei","Mamit","Saitual","Serchhip"],"Nagaland":["Chumoukedima","Dimapur","Kiphire","Kohima","Longleng","Mokokchung","Mon","Noklak","Peren","Phek","Shamator","Tseminyu","Tuensang","Wokha","Zunheboto"],"Odisha":[" Koraput","Angul","Balangir","Balasore","Bargarh","Bhadrak","Boudh","Cuttack","Deogarh","Dhenkanal","Gajapati","Ganjam","Jagatsinghpur","Jajpur","Jharsuguda","Kalahandi","Kandhamal","Kendrapara","Keonjhar","Khordha","Malkangiri","Mayurbhanj","Nabarangpur","Nayagarh","Nuapada","Puri","Rayagada","Sambalpur","Subarnapur","Sundargarh"],"Punjab":["Amritsar","Barnala","Bathinda","Faridkot","Fatehgarh Sahib","Fazilka","Ferozepur","Gurdaspur","Hoshiarpur","Jalandhar","Kapurthala","Ludhiana","Malerkotla","Mansa","Moga","Muktsar","Pathankot","Patiala","Sahibzada Ajit Singh Nagar","Sangrur","Shaheed Bhagat Singh Nagar","Tarn Taran"],"Rajasthan":["Ajmer","Alwar","Balotra","Banswara","Baran","Barmer","Beawar","Bharatpur","Bharatpur? ","Bhilwara","Bikaner","Bundi","Chittorgarh","Churu","Dausa","Deeg","Dholpur","Didwana-Kuchamana","Dudu","Dungarpur","Gangapur City","Hanumangarh","Jaipur","Jaipur Rural","Jaisalmer","Jalore","Jhalawar","Jhunjhunu","Jodhpur","Jodhpur Rural","Karauli","Khairthal-Tijara","Kota","Kotputli-Behror","Nagaur","Neem Ka Thana","Pali","Phalodi","Pratapgarh","Rajsamand","Salumbar","Sawai Madhopur","Sikar","Sirohi","Sri Ganganagar","Tonk","Udaipur"],"Sikkim":["Gangtok","Gyalshing","Mangan","Namchi","Pakyong","Soreng"],"Tamil Nadu":["Ariyalur","Chengalpattu","Chennai","Coimbatore","Cuddalore","Dharmapuri","Dindigul","Erode","Kallakurichi","Kancheepuram","Karur","Krishnagiri","Madurai","Mayiladuthurai","Nagapattinam","Namakkal","Nilgiris","Perambalur","Pudukkottai","Ramanathapuram","Ranipet","Salem","Sivaganga","Tenkasi","Thanjavur","Theni","Thoothukudi","Tiruchirappalli","Tirunelveli","Tirupathur","Tiruppur","Tiruvallur","Tiruvannamalai","Tiruvarur","Vellore","Viluppuram","Virudhunagar"],"Telangana":[" Mahabubabad","Adilabad","Bhadradri Kothagudem","Hanamkonda","Hyderabad","Jagtial","Jangaon","Jayashankar Bhupalpally","Jogulamba Gadwal","Kamareddy","Karimnagar","Khammam","Komaram Bheem","Mahbubnagar","Mancherial","Medak","Medchal-Malkajgiri","Mulugu","Nagarkurnool","Nalgonda","Narayanpet","Nirmal","Nizamabad","Peddapalli","Rajanna Sircilla","Rangareddy","Sangareddy","Siddipet","Suryapet","Vikarabad","Warangal","Yadadri Bhuvanagiri"],"Tripura":["Dhalai","Gomati","Khowai","North Tripura","Sepahijala","South Tripura","Unakoti","West Tripura"],"Uttar Pradesh":["Agra","Aligarh","Ambedkar Nagar","Amethi","Amroha","Auraiya","Ayodhya","Azamgarh","Baghpat","Bahraich","Ballia","Balrampur","Banda","Barabanki","Bareilly","Basti","Bhadohi","Bijnor","Budaun","Bulandshahr","Chandauli","Chitrakoot","Deoria","Etah","Etawah","Farrukhabad","Fatehpur","Firozabad","Gautam Buddha Nagar","Ghaziabad","Ghazipur","Gonda","Gorakhpur","Hamirpur","Hapur","Hardoi","Hathras","Jalaun","Jaunpur","Jhansi","Kannauj","Kanpur Dehat","Kanpur Nagar","Kasganj","Kaushambi","Kushinagar","Lakhimpur Kheri","Lalitpur","Lucknow","Maharajganj","Mahoba","Mainpuri","Mathura","Mau","Meerut","Mirzapur","Moradabad","Muzaffarnagar","Pilibhit","Pratapgarh","Prayagraj","Raebareli","Rampur","Saharanpur","Sambhal","Sant Kabir Nagar","Shahjahanpur","Shamli","Shravasti","Siddharthnagar","Sitapur","Sonbhadra","Sultanpur","Unnao","Varanasi"],"Uttarakhand":["Almora","Bageshwar","Chamoli","Champawat","Dehradun","Haridwar","Nainital","Pauri Garhwal","Pithoragarh","Rudraprayag","Tehri Garhwal","Udham Singh Nagar","Uttarkashi"],"West Bengal":["Alipurduar","Bankura","Birbhum","Cooch Behar","Dakshin Dinajpur","Darjeeling","Hooghly","Howrah","Jalpaiguri","Jhargram","Kalimpong","Kolkata","Maldah","Murshidabad","Nadia","North 24 Parganas","Paschim Medinipur","Pashchim Bardhaman","Purba Bardhaman","Purba Medinipur","Purulia","South 24 Parganas","Uttar Dinajpur"],"Andaman and Nicobar Islands":["Nicobar","North and Middle Andaman","South Andaman"],"Chandigarh":["Chandigarh"],"Dadra and Nagar Haveli and Daman and Diu":["Dadra and Nagar Haveli","Daman","Diu"],"Delhi":["Central Delhi","East Delhi","New Delhi","North Delhi","North East Delhi","North West Delhi","Shahdara","South Delhi","South East Delhi","South West Delhi","West Delhi"],"Jammu and Kashmir":["Anantnag","Bandipora","Baramulla","Budgam","Doda","Ganderbal","Jammu","Kathua","Kishtwar","Kulgam","Kupwara","Poonch","Pulwama","Rajouri","Ramban","Reasi","Samba","Shopian","Srinagar","Udhampur"],"Ladakh":["Kargil","Leh"],"Lakshadweep":["Agatti","Andrott","Bitra","Chetlat","Kadmat","Kalpeni","Kavaratti","Kiltan","Minicoy"],"Puducherry":["Karaikal","Mahe","Puducherry","Yanam"]};

  function resetDistrict() {
    districtInput.value = "";
    districtInput.disabled = true;
    districtInput.placeholder = "Select state first";
    districtList.innerHTML = "";
  }

  function updateDistricts() {
    const state = stateInput.value.trim();
    districtList.innerHTML = "";
    districtInput.value = "";

    const districts = districtsByState[state];

    if (!districts) {
      districtInput.disabled = true;
      districtInput.placeholder = "Select state first";
      return;
    }

    districts.forEach((district) => {
      const option = document.createElement("option");
      option.value = district;
      districtList.appendChild(option);
    });

    districtInput.disabled = false;
    districtInput.placeholder = "Search district / city";
  }

  stateInput.addEventListener("change", updateDistricts);
  stateInput.addEventListener("input", () => {
    const exact = Object.keys(districtsByState).find(
      s => s.toLowerCase() === stateInput.value.trim().toLowerCase()
    );
    if (exact && exact !== stateInput.value) stateInput.value = exact;
    updateDistricts();
  });

  resetDistrict();

  enhanceLocationCombobox(stateInput, $("stateOptions"));
  enhanceLocationCombobox(districtInput, districtList);
}
;



function initializeSectionPhotography() {
  const sections = Array.from(document.querySelectorAll('.photo-section[data-photo]'));
  if (!sections.length) return;

  const loadPhoto = (section) => {
    if (section.dataset.photoLoaded === 'true') return;

    const photo = section.dataset.photo;
    if (!photo) return;

    section.style.setProperty('--photo-image', `url("${photo}")`);
    section.dataset.photoLoaded = 'true';
  };

  const showPhoto = (section) => {
    loadPhoto(section);
    


    requestAnimationFrame(() => {
      requestAnimationFrame(() => section.classList.add('photo-visible'));
    });
  };

  const hidePhoto = (section) => {
    section.classList.remove('photo-visible');
  };

  if (!('IntersectionObserver' in window)) {
    sections.forEach(showPhoto);
    return;
  }

  

  const preloadObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) loadPhoto(entry.target);
    });
  }, {
    root: null,
    rootMargin: '500px 0px',
    threshold: 0
  });



  const visibilityObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting && entry.intersectionRatio > 0.08) {
        showPhoto(entry.target);
      } else {
        hidePhoto(entry.target);
      }
    });
  }, {
    root: null,
    rootMargin: '-8% 0px -8% 0px',
    threshold: [0, 0.08, 0.2, 0.4, 0.7]
  });

  sections.forEach((section) => {
    preloadObserver.observe(section);
    visibilityObserver.observe(section);
  });
}

window.addEventListener('DOMContentLoaded', initializeSectionPhotography);

let currentLang = "en";

const LANGUAGES = [
  { code: "en", name: "English", native: "English", short: "EN", rtl: false },
  { code: "hi", name: "Hindi", native: "हिन्दी", short: "हिं", rtl: false },
  { code: "as", name: "Assamese", native: "অসমীয়া", short: "অস", rtl: false },
  { code: "bn", name: "Bengali", native: "বাংলা", short: "বাং", rtl: false },
  { code: "brx", name: "Bodo", native: "बड़ो", short: "बड़ो", rtl: false },
  { code: "doi", name: "Dogri", native: "डोगरी", short: "डोगरी", rtl: false },
  { code: "gu", name: "Gujarati", native: "ગુજરાતી", short: "ગુજ", rtl: false },
  { code: "kn", name: "Kannada", native: "ಕನ್ನಡ", short: "ಕನ್ನ", rtl: false },
  { code: "ks", name: "Kashmiri", native: "کٲشُر", short: "کٲش", rtl: true },
  { code: "kok", name: "Konkani", native: "कोंकणी", short: "कों", rtl: false },
  { code: "mai", name: "Maithili", native: "मैथिली", short: "मैथ", rtl: false },
  { code: "ml", name: "Malayalam", native: "മലയാളം", short: "മല", rtl: false },
  { code: "mni", name: "Manipuri", native: "ꯃꯩꯇꯩꯂꯣꯟ", short: "মণি", rtl: false },
  { code: "mr", name: "Marathi", native: "मराठी", short: "मर", rtl: false },
  { code: "ne", name: "Nepali", native: "नेपाली", short: "नेप", rtl: false },
  { code: "or", name: "Odia", native: "ଓଡ଼ିଆ", short: "ଓଡ଼ି", rtl: false },
  { code: "pa", name: "Punjabi", native: "ਪੰਜਾਬੀ", short: "ਪੰਜ", rtl: false },
  { code: "sa", name: "Sanskrit", native: "संस्कृतम्", short: "सं", rtl: false },
  { code: "sat", name: "Santali", native: "ᱥᱟᱱᱛᱟᱲᱤ", short: "সান", rtl: false },
  { code: "sd", name: "Sindhi", native: "سنڌي", short: "سنڌ", rtl: true },
  { code: "ta", name: "Tamil", native: "தமிழ்", short: "தமி", rtl: false },
  { code: "te", name: "Telugu", native: "తెలుగు", short: "తెలు", rtl: false },
  { code: "ur", name: "Urdu", native: "اردو", short: "اردو", rtl: true },
];

const translations = {
  en: {
    "brandbadge.title": "  SAMARTH",
    "nav.home": "Home",
    "nav.findSchemes": "Find Schemes",
    "nav.recommendations": "AI Recommendations",
    "nav.schemes": "Available Schemes",
    "nav.calculator": "Calculator",
    "nav.partner": "Partner",
    "nav.impact": "Social Impact",
    "nav.faq": "FAQ",
    "nav.about": "About Us",
    "nav.datarefresher": "↻ Refresh Data",
    "hero.badge": "AI - POWERED GOVERNMENT SCHEME MATCHING",
    "hero.title": "Find The Right <span>FINANCIAL SUPPORT</span> For Your <span>JOURNEY</span>",
    "hero.subtitle": "SAMARTH Connects Your PROFILE, FINANCIAL REQUIREMENTS And GOALS With Suitable GOVERNMENT SCHEMES For MARGINALIZED ENTREPRENEUR.",
    "hero.ctaPrimary": "Find My Scheme",
    "hero.ctaSecondary": "Explore Schemes",
    "hero.tick1": "✓ Government Sources",
    "hero.tick2": "✓ AI - Based Matching",
    "hero.tick3": "✓ Financial Calculator",
    "hero.inteligence": "LIVE SCHEME INTELLIGENCE",
    "hero.connectivity": "● CONNECTED",
    "profile.kicker": "01 / SMART MATCHING",
    "profile.title": "Tell Us About <span>YOUR REQUIREMENTS</span>",
    "profile.subtitle": "Enter your basic details and SAMARTH will rank the available schemes based on your profile.",
    "form.category": "Applicant Category",
    "form.familyIncome": "Annual Family Income",
    "form.requirementType": "Requirement Type",
    "form.projectCost": "Estimated Project / Course Cost",
    "form.submit": "Generate Recommendations",
    "form.clear": "Clear",
    "rec.kicker": "02 / AI RECOMMENDATIONS",
    "rec.title": "Your <span>BEST MATCHES</span>",
    "rec.subtitle": "Results are ranked using eligibility checks and profile similarity.",
    "schemes.title": "Explore <span>GOVERNMENT SUPPORT</span>",
    "schemes.subtitle": "Click any scheme card to view its complete details without leaving this page.",
    "schemes.searchPlaceholder": "Search Schemes...",
    "schemes.filterAllCategories": "All Categories",
    "calc.title": "Understand Your <span>REPAYMENT</span>",
    "calc.subtitle": "Select a scheme and estimate your monthly EMI and total repayment.",
    "partners.title": "Find A Nearby <span>PARTNER</span>",
    "partners.subtitle": "Use your location to find available channel partners from the partner data.",
    "impact.title": "From <span>DISCOVERY</span> To <span>ACCESS</span>",
    "impact.subtitle": "A simple journey for people looking for suitable government financial support.",
    "faq.title": "<span>ANSWERS</span> To Your <span>QUESTIONS</span>",
    "faq.subtitle": "Quick answers about SAMARTH, government scheme matching and using the platform.",
    "about.title": "Meet The <span>TECH TITANS</span>",
    "about.subtitle": "We are a six-member team building SAMARTH to make government financial support easier to discover, understand and access.",
    "bot.launcherLabel": "Open scheme assistant",
    "bot.title": "SAMARTH Assistant",
    "bot.greeting": "Hi! I can help you find matching government schemes in under a minute.",
    "bot.qCategory": "First, what's your applicant category?",
    "bot.qIncome": "Got it. What's your approximate annual family income?",
    "bot.qRequirement": "Thanks. What do you need support for?",
    "bot.qCost": "Almost done — what's the estimated project or course cost?",
    "bot.qEducationRequired": "Is this related to an education requirement (like a course or degree)?",
    "bot.qEducationStatus": "What's your current education status?",
    "bot.qCourseField": "Which course or field is this for?",
    "bot.qState": "Which state or UT are you in?",
    "bot.qCityDistrict": "And which district or city?",
    "bot.yes": "Yes",
    "bot.no": "No",
    "bot.typeManually": "Type manually",
    "bot.otherPlaceholder": "Type your answer...",
    "bot.otherSend": "Send",
    "bot.matching": "Great, matching you with schemes now...",
    "bot.done": "Done! I've filled in your answers and pulled your best matches below.",
    "bot.notFound": "I couldn't find any matching schemes for these details. You can restart and adjust a few answers, or review your filters in the form above.",
    "bot.error": "Something went wrong while matching. You can also check your answers in the form above and try again.",
    "bot.restart": "Start Over",
    "bot.restartLabel": "Restart conversation",
    "bot.minimizeLabel": "Minimise assistant",
    "bot.closeLabel": "Close and reset assistant",
    "about.kicker": "08 / ABOUT US",
    "calc.kicker": "04 / FINANCIAL CALCULATOR",
    "faq.kicker": "07 / FREQUENTLY ASKED QUESTIONS",
    "impact.kicker": "06 / SOCIAL IMPACT",
    "partners.kicker": "05 / CHANNEL PARTNERS",
    "schemes.kicker": "03 / AVAILABLE SCHEMES",
    "form.courseField": "Course / Field",
    "form.educationRequired": "Education requirement",
    "form.educationStatus": "Education Status",
    "form.location": "Location",
    "form.purpose": "Purpose",
    "opt.category.select": "Select Category",
    "opt.category.sc": "Scheduled Caste (SC)",
    "opt.category.st": "Scheduled Tribe (ST)",
    "opt.category.obc": "Other Backward Classes (OBC)",
    "opt.category.minority": "Minority Community",
    "opt.category.pwd": "Person with Disability",
    "opt.category.senior": "Senior Citizen",
    "opt.category.student": "Student / Youth",
    "opt.other": "Other",
    "opt.income.select": "Select Annual Family Income",
    "opt.income.b1": "Up to ₹50,000",
    "opt.income.b2": "₹50,001 – ₹1 Lakh",
    "opt.income.b3": "₹1 Lakh – ₹2.5 Lakh",
    "opt.income.b4": "₹2.5 Lakh – ₹5 Lakh",
    "opt.income.b5": "₹5 Lakh – ₹10 Lakh",
    "opt.income.b6": "₹10 Lakh – ₹25 Lakh",
    "opt.income.b7": "Above ₹25 Lakh",
    "opt.cost.select": "Select Estimated Cost",
    "opt.cost.b1": "Up to ₹50,000",
    "opt.cost.b2": "₹50,001 – ₹1 Lakh",
    "opt.cost.b3": "₹1 Lakh – ₹2.5 Lakh",
    "opt.cost.b4": "₹2.5 Lakh – ₹5 Lakh",
    "opt.cost.b5": "₹5 Lakh – ₹10 Lakh",
    "opt.cost.b6": "₹10 Lakh – ₹25 Lakh",
    "opt.cost.b7": "₹25 Lakh – ₹50 Lakh",
    "opt.requirement.select": "Select Requirement Type",
    "opt.requirement.business": "Business / Entrepreneurship",
    "opt.requirement.microFinance": "Micro Finance",
    "opt.requirement.termLoan": "Term Loan",
    "opt.requirement.education": "Education / Higher Education",
    "opt.requirement.agriculture": "Agriculture & Allied Activities",
    "opt.requirement.skillDevelopment": "Skill Development / Training",
    "opt.requirement.employment": "Employment / Livelihood",
    "opt.requirement.housing": "Housing",
    "opt.requirement.healthcare": "Health / Medical Assistance",
    "opt.requirement.scholarship": "Scholarship / Financial Aid",
    "opt.requirement.socialSecurity": "Social Security / Welfare",
    "opt.requirement.financialInclusion": "Financial Inclusion",
    "opt.requirement.startup": "Startup / Innovation",
    "opt.eduStatus.na": "Not applicable",
    "opt.eduStatus.student": "Student",
    "opt.eduStatus.graduate": "Graduate",
    "opt.eduStatus.postgraduate": "Postgraduate",
    "opt.eduStatus.doctoral": "Doctoral",
    "opt.course.select": "Select Course / Field",
    "opt.course.engineering": "Engineering",
    "opt.course.cs": "Computer Science / IT",
    "opt.course.ai": "Artificial Intelligence / Machine Learning",
    "opt.course.medical": "Medical / Medicine",
    "opt.course.dental": "Dental",
    "opt.course.pharmacy": "Pharmacy",
    "opt.course.nursing": "Nursing",
    "opt.course.management": "Management / MBA",
    "opt.course.commerce": "Commerce / Finance",
    "opt.course.law": "Law",
    "opt.course.architecture": "Architecture",
    "opt.course.agriculture": "Agriculture",
    "opt.course.veterinary": "Veterinary Science",
    "opt.course.education": "Education / Teaching",
    "opt.course.science": "Science",
    "opt.course.arts": "Arts / Humanities",
    "opt.course.vocational": "Vocational / Skill Training",
    "placeholder.categoryOther": "Enter applicant category",
    "placeholder.familyIncomeOther": "Enter annual family income",
    "placeholder.requirementOther": "Enter requirement type",
    "placeholder.projectCostOther": "Enter estimated cost",
    "placeholder.educationStatusOther": "Enter education status",
    "placeholder.courseFieldOther": "Enter course / field",
    "placeholder.state": "Search State / UT",
    "placeholder.purpose": "Briefly describe what the funding will be used for...",
    "stat.schemes": "Schemes",
    "stat.aimatch": "AI",
    "stat.matching": "Matching",
    "stat.ailive": "LIVE",
    "stat.sources": "Sources",
    "stat.availableSchemes": "Available Schemes",
    "stat.incomeBenchmark": "Income Benchmark",
    "stat.channelPartners": "Channel Partners",
    "stat.lastSync": "Last Sync",
    "sync.title": "Government Data Synchronization",
    "sync.checking": "Checking available government sources...",
    "sync.button": "↻ Sync Now",
    "faq.q1": "What is SAMARTH?",
    "faq.a1": "SAMARTH is a digital platform that uses profile-based eligibility checks and AI-assisted matching to help users discover suitable government financial support schemes.",
    "faq.q2": "Where does the scheme information come from?",
    "faq.a2": "The platform fetches scheme information from configured government sources and validates the extracted information before making it available for matching.",
    "faq.q3": "Does a recommendation guarantee approval?",
    "faq.a3": "No. A recommendation indicates that a scheme appears suitable based on the available information. Final eligibility, documentation and approval are determined by the concerned government authority or channel partner.",
    "faq.q4": "How does the AI recommendation work?",
    "faq.a4": "The matching engine combines eligibility rules, financial limits, requirement type, education-related conditions and text similarity to rank suitable schemes.",
    "faq.q5": "Can I calculate my expected EMI?",
    "faq.a5": "Yes. Select an available scheme in the Financial Calculator, enter the loan amount, interest rate and repayment period, and the platform will estimate the monthly EMI and total repayment.",
    "faq.q6": "How can I find a channel partner?",
    "faq.a6": "Use the Channel Partners section and allow location access. The platform can use available partner coordinates to identify nearby routable partners.",
    "team.roleInProject": "Role in Project",
    "team.aboutMe": "About Me",
    "team.member1.role": "Lead Developer",
    "team.member1.projectRole": "Managed the overall project and led the development of the application",
    "team.member1.about": "An energetic and keen learner who always looks forward to",
    "team.member2.role": "Presentation Lead",
    "team.member2.projectRole": "Designed the presentation and effectively communicated the project's features and workflow.",
    "team.member2.about": "A keen learner who loves exploring new ideas and turning them into reality.",
    "team.member3.role": "Demo Coordinator",
    "team.member3.projectRole": "Manage the demonstration flow, verify key functionalities, and ensure that the project was ready for presentation.",
    "team.member3.about": "A curious and enthusiastic learner, always eager to explore new ideas and develop new skills and learn from every experience.",
    "team.member4.role": "Integration & Testing Lead",
    "team.member4.projectRole": "Tested the application, identified issues and ensured smooth and reliable functionality.",
    "team.member4.about": "Passionate about coding and game development with a keen interest in building creative and interactive applications.",
    "team.member5.role": "Data & Research Lead",
    "team.member5.projectRole": "Managed project research, data collection, references and documentation to support the development and presentation of the application",
    "team.member5.about": "Lifelong learner always looking forward to enhance knowledge",
    "team.member6.role": "Project Documentation Lead",
    "team.member6.projectRole": "Coordinated the project demonstration and ensured that the application was ready for final presentation",
    "team.member6.about": "Passionate about developing applications and large language models to help out people.",
    "team.member1.name": "Gaurav Dahiya",
    "team.member2.name": "Bhumika Rajput",
    "team.member3.name": "Aabhaas Bhargava",
    "team.member4.name": "Om Tapas",
    "team.member5.name": "Pari Mehra",
    "team.member6.name": "Shivansh Garg",
    "place.state.Andhra Pradesh": "Andhra Pradesh",
    "place.district.Andhra Pradesh.Alluri Sitharama Raju": "Alluri Sitharama Raju",
    "place.district.Andhra Pradesh.Anakapalli": "Anakapalli",
    "place.district.Andhra Pradesh.Ananthapuramu": "Ananthapuramu",
    "place.district.Andhra Pradesh.Annamayya": "Annamayya",
    "place.district.Andhra Pradesh.Bapatla": "Bapatla",
    "place.district.Andhra Pradesh.Chittoor": "Chittoor",
    "place.district.Andhra Pradesh.Dr B R Ambedkar Konaseema": "Dr B R Ambedkar Konaseema",
    "place.district.Andhra Pradesh.East Godavari": "East Godavari",
    "place.district.Andhra Pradesh.Eluru": "Eluru",
    "place.district.Andhra Pradesh.Guntur": "Guntur",
    "place.district.Andhra Pradesh.Kakinada": "Kakinada",
    "place.district.Andhra Pradesh.Krishna": "Krishna",
    "place.district.Andhra Pradesh.Kurnool": "Kurnool",
    "place.district.Andhra Pradesh.NTR": "NTR",
    "place.district.Andhra Pradesh.Nandyal": "Nandyal",
    "place.district.Andhra Pradesh.Nellore": "Nellore",
    "place.district.Andhra Pradesh.Palnadu": "Palnadu",
    "place.district.Andhra Pradesh.Parvathipuram Manyam": "Parvathipuram Manyam",
    "place.district.Andhra Pradesh.Prakasam": "Prakasam",
    "place.district.Andhra Pradesh.Sri Sathya Sai": "Sri Sathya Sai",
    "place.district.Andhra Pradesh.Srikakulam": "Srikakulam",
    "place.district.Andhra Pradesh.Tirupati": "Tirupati",
    "place.district.Andhra Pradesh.Visakhapatnam": "Visakhapatnam",
    "place.district.Andhra Pradesh.Vizianagaram": "Vizianagaram",
    "place.district.Andhra Pradesh.West Godavari": "West Godavari",
    "place.district.Andhra Pradesh.YSR Kadapa": "YSR Kadapa",
    "place.state.Arunachal Pradesh": "Arunachal Pradesh",
    "place.district.Arunachal Pradesh.Anjaw": "Anjaw",
    "place.district.Arunachal Pradesh.Changlang": "Changlang",
    "place.district.Arunachal Pradesh.Dibang Valley": "Dibang Valley",
    "place.district.Arunachal Pradesh.East Kameng": "East Kameng",
    "place.district.Arunachal Pradesh.East Siang": "East Siang",
    "place.district.Arunachal Pradesh.Itanagar Capital Complex": "Itanagar Capital Complex",
    "place.district.Arunachal Pradesh.Kamle": "Kamle",
    "place.district.Arunachal Pradesh.Keyi Panyor": "Keyi Panyor",
    "place.district.Arunachal Pradesh.Kra Daadi": "Kra Daadi",
    "place.district.Arunachal Pradesh.Kurung Kumey": "Kurung Kumey",
    "place.district.Arunachal Pradesh.Lepa Rada": "Lepa Rada",
    "place.district.Arunachal Pradesh.Lohit": "Lohit",
    "place.district.Arunachal Pradesh.Longding": "Longding",
    "place.district.Arunachal Pradesh.Lower Dibang Valley": "Lower Dibang Valley",
    "place.district.Arunachal Pradesh.Lower Siang": "Lower Siang",
    "place.district.Arunachal Pradesh.Lower Subansiri": "Lower Subansiri",
    "place.district.Arunachal Pradesh.Namsai": "Namsai",
    "place.district.Arunachal Pradesh.Papum Pare": "Papum Pare",
    "place.district.Arunachal Pradesh.Shi Yomi": "Shi Yomi",
    "place.district.Arunachal Pradesh.Siang": "Siang",
    "place.district.Arunachal Pradesh.Tawang": "Tawang",
    "place.district.Arunachal Pradesh.Tirap": "Tirap",
    "place.district.Arunachal Pradesh.Upper Siang": "Upper Siang",
    "place.district.Arunachal Pradesh.Upper Subansiri": "Upper Subansiri",
    "place.district.Arunachal Pradesh.West Kameng": "West Kameng",
    "place.district.Arunachal Pradesh.West Siang": "West Siang",
    "place.state.Assam": "Assam",
    "place.district.Assam.Baksa": "Baksa",
    "place.district.Assam.Barpeta": "Barpeta",
    "place.district.Assam.Biswanath": "Biswanath",
    "place.district.Assam.Bongaigaon": "Bongaigaon",
    "place.district.Assam.Cachar": "Cachar",
    "place.district.Assam.Charaideo": "Charaideo",
    "place.district.Assam.Chirang": "Chirang",
    "place.district.Assam.Darrang": "Darrang",
    "place.district.Assam.Dhemaji": "Dhemaji",
    "place.district.Assam.Dhubri": "Dhubri",
    "place.district.Assam.Dibrugarh": "Dibrugarh",
    "place.district.Assam.Dima Hasao": "Dima Hasao",
    "place.district.Assam.Goalpara": "Goalpara",
    "place.district.Assam.Golaghat": "Golaghat",
    "place.district.Assam.Hailakandi": "Hailakandi",
    "place.district.Assam.Hojai": "Hojai",
    "place.district.Assam.Jorhat": "Jorhat",
    "place.district.Assam.Kamrup": "Kamrup",
    "place.district.Assam.Kamrup Metropolitan": "Kamrup Metropolitan",
    "place.district.Assam.Karbi Anglong": "Karbi Anglong",
    "place.district.Assam.Karimganj": "Karimganj",
    "place.district.Assam.Kokrajhar": "Kokrajhar",
    "place.district.Assam.Lakhimpur": "Lakhimpur",
    "place.district.Assam.Majuli": "Majuli",
    "place.district.Assam.Morigaon": "Morigaon",
    "place.district.Assam.Nagaon": "Nagaon",
    "place.district.Assam.Nalbari": "Nalbari",
    "place.district.Assam.Sivasagar": "Sivasagar",
    "place.district.Assam.Sonitpur": "Sonitpur",
    "place.district.Assam.South Salmara-Mankachar": "South Salmara-Mankachar",
    "place.district.Assam.Tamulpur": "Tamulpur",
    "place.district.Assam.Tinsukia": "Tinsukia",
    "place.district.Assam.Udalguri": "Udalguri",
    "place.district.Assam.West Karbi Anglong": "West Karbi Anglong",
    "place.state.Bihar": "Bihar",
    "place.district.Bihar.Araria": "Araria",
    "place.district.Bihar.Arwal": "Arwal",
    "place.district.Bihar.Aurangabad": "Aurangabad",
    "place.district.Bihar.Banka": "Banka",
    "place.district.Bihar.Begusarai": "Begusarai",
    "place.district.Bihar.Bhagalpur": "Bhagalpur",
    "place.district.Bihar.Bhojpur": "Bhojpur",
    "place.district.Bihar.Buxar": "Buxar",
    "place.district.Bihar.Darbhanga": "Darbhanga",
    "place.district.Bihar.East Champaran": "East Champaran",
    "place.district.Bihar.Gaya": "Gaya",
    "place.district.Bihar.Gopalganj": "Gopalganj",
    "place.district.Bihar.Jamui": "Jamui",
    "place.district.Bihar.Jehanabad": "Jehanabad",
    "place.district.Bihar.Kaimur": "Kaimur",
    "place.district.Bihar.Katihar": "Katihar",
    "place.district.Bihar.Khagaria": "Khagaria",
    "place.district.Bihar.Kishanganj": "Kishanganj",
    "place.district.Bihar.Lakhisarai": "Lakhisarai",
    "place.district.Bihar.Madhepura": "Madhepura",
    "place.district.Bihar.Madhubani": "Madhubani",
    "place.district.Bihar.Munger": "Munger",
    "place.district.Bihar.Muzaffarpur": "Muzaffarpur",
    "place.district.Bihar.Nalanda": "Nalanda",
    "place.district.Bihar.Nawada": "Nawada",
    "place.district.Bihar.Patna": "Patna",
    "place.district.Bihar.Purnia": "Purnia",
    "place.district.Bihar.Rohtas": "Rohtas",
    "place.district.Bihar.Saharsa": "Saharsa",
    "place.district.Bihar.Samastipur": "Samastipur",
    "place.district.Bihar.Saran": "Saran",
    "place.district.Bihar.Sheikhpura": "Sheikhpura",
    "place.district.Bihar.Sheohar": "Sheohar",
    "place.district.Bihar.Sitamarhi": "Sitamarhi",
    "place.district.Bihar.Siwan": "Siwan",
    "place.district.Bihar.Supaul": "Supaul",
    "place.district.Bihar.Vaishali": "Vaishali",
    "place.district.Bihar.West Champaran": "West Champaran",
    "place.state.Chhattisgarh": "Chhattisgarh",
    "place.district.Chhattisgarh.Balod": "Balod",
    "place.district.Chhattisgarh.Baloda Bazar-Bhatapara": "Baloda Bazar-Bhatapara",
    "place.district.Chhattisgarh.Balrampur-Ramanujganj": "Balrampur-Ramanujganj",
    "place.district.Chhattisgarh.Bastar": "Bastar",
    "place.district.Chhattisgarh.Bemetara": "Bemetara",
    "place.district.Chhattisgarh.Bijapur": "Bijapur",
    "place.district.Chhattisgarh.Bilaspur": "Bilaspur",
    "place.district.Chhattisgarh.Dantewada": "Dantewada",
    "place.district.Chhattisgarh.Dhamtari": "Dhamtari",
    "place.district.Chhattisgarh.Durg": "Durg",
    "place.district.Chhattisgarh.Gariaband": "Gariaband",
    "place.district.Chhattisgarh.Gauravpath? ": "Gauravpath",
    "place.district.Chhattisgarh.Gaurela-Pendra-Marwahi": "Gaurela-Pendra-Marwahi",
    "place.district.Chhattisgarh.Janjgir-Champa": "Janjgir-Champa",
    "place.district.Chhattisgarh.Jashpur": "Jashpur",
    "place.district.Chhattisgarh.Kabirdham": "Kabirdham",
    "place.district.Chhattisgarh.Kanker": "Kanker",
    "place.district.Chhattisgarh.Khairagarh-Chhuikhadan-Gandai": "Khairagarh-Chhuikhadan-Gandai",
    "place.district.Chhattisgarh.Kondagaon": "Kondagaon",
    "place.district.Chhattisgarh.Korba": "Korba",
    "place.district.Chhattisgarh.Koriya": "Koriya",
    "place.district.Chhattisgarh.Mahasamund": "Mahasamund",
    "place.district.Chhattisgarh.Manendragarh-Chirmiri-Bharatpur": "Manendragarh-Chirmiri-Bharatpur",
    "place.district.Chhattisgarh.Mungeli": "Mungeli",
    "place.district.Chhattisgarh.Narayanpur": "Narayanpur",
    "place.district.Chhattisgarh.Raigarh": "Raigarh",
    "place.district.Chhattisgarh.Raipur": "Raipur",
    "place.district.Chhattisgarh.Rajnandgaon": "Rajnandgaon",
    "place.district.Chhattisgarh.Sakti": "Sakti",
    "place.district.Chhattisgarh.Sarangarh-Bilaigarh": "Sarangarh-Bilaigarh",
    "place.district.Chhattisgarh.Sukma": "Sukma",
    "place.district.Chhattisgarh.Surajpur": "Surajpur",
    "place.district.Chhattisgarh.Surguja": "Surguja",
    "place.state.Goa": "Goa",
    "place.district.Goa.North Goa": "North Goa",
    "place.district.Goa.South Goa": "South Goa",
    "place.state.Gujarat": "Gujarat",
    "place.district.Gujarat.Ahmedabad": "Ahmedabad",
    "place.district.Gujarat.Amreli": "Amreli",
    "place.district.Gujarat.Anand": "Anand",
    "place.district.Gujarat.Aravalli": "Aravalli",
    "place.district.Gujarat.Banaskantha": "Banaskantha",
    "place.district.Gujarat.Bharuch": "Bharuch",
    "place.district.Gujarat.Bhavnagar": "Bhavnagar",
    "place.district.Gujarat.Botad": "Botad",
    "place.district.Gujarat.Chhota Udepur": "Chhota Udepur",
    "place.district.Gujarat.Dahod": "Dahod",
    "place.district.Gujarat.Dang": "Dang",
    "place.district.Gujarat.Devbhumi Dwarka": "Devbhumi Dwarka",
    "place.district.Gujarat.Gandhinagar": "Gandhinagar",
    "place.district.Gujarat.Gir Somnath": "Gir Somnath",
    "place.district.Gujarat.Jamnagar": "Jamnagar",
    "place.district.Gujarat.Junagadh": "Junagadh",
    "place.district.Gujarat.Kheda": "Kheda",
    "place.district.Gujarat.Kutch": "Kutch",
    "place.district.Gujarat.Mahisagar": "Mahisagar",
    "place.district.Gujarat.Mehsana": "Mehsana",
    "place.district.Gujarat.Morbi": "Morbi",
    "place.district.Gujarat.Narmada": "Narmada",
    "place.district.Gujarat.Navsari": "Navsari",
    "place.district.Gujarat.Panchmahal": "Panchmahal",
    "place.district.Gujarat.Patan": "Patan",
    "place.district.Gujarat.Porbandar": "Porbandar",
    "place.district.Gujarat.Rajkot": "Rajkot",
    "place.district.Gujarat.Sabarkantha": "Sabarkantha",
    "place.district.Gujarat.Surat": "Surat",
    "place.district.Gujarat.Surendranagar": "Surendranagar",
    "place.district.Gujarat.Tapi": "Tapi",
    "place.district.Gujarat.Vadodara": "Vadodara",
    "place.district.Gujarat.Valsad": "Valsad",
    "place.state.Haryana": "Haryana",
    "place.district.Haryana.Ambala": "Ambala",
    "place.district.Haryana.Bhiwani": "Bhiwani",
    "place.district.Haryana.Charkhi Dadri": "Charkhi Dadri",
    "place.district.Haryana.Faridabad": "Faridabad",
    "place.district.Haryana.Fatehabad": "Fatehabad",
    "place.district.Haryana.Gurugram": "Gurugram",
    "place.district.Haryana.Hisar": "Hisar",
    "place.district.Haryana.Jhajjar": "Jhajjar",
    "place.district.Haryana.Jind": "Jind",
    "place.district.Haryana.Kaithal": "Kaithal",
    "place.district.Haryana.Karnal": "Karnal",
    "place.district.Haryana.Kurukshetra": "Kurukshetra",
    "place.district.Haryana.Mahendragarh": "Mahendragarh",
    "place.district.Haryana.Nuh": "Nuh",
    "place.district.Haryana.Palwal": "Palwal",
    "place.district.Haryana.Panchkula": "Panchkula",
    "place.district.Haryana.Panipat": "Panipat",
    "place.district.Haryana.Rewari": "Rewari",
    "place.district.Haryana.Rohtak": "Rohtak",
    "place.district.Haryana.Sirsa": "Sirsa",
    "place.district.Haryana.Sonipat": "Sonipat",
    "place.district.Haryana.Yamunanagar": "Yamunanagar",
    "place.state.Himachal Pradesh": "Himachal Pradesh",
    "place.district.Himachal Pradesh.Bilaspur": "Bilaspur",
    "place.district.Himachal Pradesh.Chamba": "Chamba",
    "place.district.Himachal Pradesh.Hamirpur": "Hamirpur",
    "place.district.Himachal Pradesh.Kangra": "Kangra",
    "place.district.Himachal Pradesh.Kinnaur": "Kinnaur",
    "place.district.Himachal Pradesh.Kullu": "Kullu",
    "place.district.Himachal Pradesh.Lahaul and Spiti": "Lahaul and Spiti",
    "place.district.Himachal Pradesh.Mandi": "Mandi",
    "place.district.Himachal Pradesh.Shimla": "Shimla",
    "place.district.Himachal Pradesh.Sirmaur": "Sirmaur",
    "place.district.Himachal Pradesh.Solan": "Solan",
    "place.district.Himachal Pradesh.Una": "Una",
    "place.state.Jharkhand": "Jharkhand",
    "place.district.Jharkhand.Bokaro": "Bokaro",
    "place.district.Jharkhand.Chatra": "Chatra",
    "place.district.Jharkhand.Deoghar": "Deoghar",
    "place.district.Jharkhand.Dhanbad": "Dhanbad",
    "place.district.Jharkhand.Dumka": "Dumka",
    "place.district.Jharkhand.East Singhbhum": "East Singhbhum",
    "place.district.Jharkhand.Garhwa": "Garhwa",
    "place.district.Jharkhand.Giridih": "Giridih",
    "place.district.Jharkhand.Godda": "Godda",
    "place.district.Jharkhand.Gumla": "Gumla",
    "place.district.Jharkhand.Hazaribagh": "Hazaribagh",
    "place.district.Jharkhand.Jamtara": "Jamtara",
    "place.district.Jharkhand.Khunti": "Khunti",
    "place.district.Jharkhand.Koderma": "Koderma",
    "place.district.Jharkhand.Latehar": "Latehar",
    "place.district.Jharkhand.Lohardaga": "Lohardaga",
    "place.district.Jharkhand.Pakur": "Pakur",
    "place.district.Jharkhand.Palamu": "Palamu",
    "place.district.Jharkhand.Ramgarh": "Ramgarh",
    "place.district.Jharkhand.Ranchi": "Ranchi",
    "place.district.Jharkhand.Sahibganj": "Sahibganj",
    "place.district.Jharkhand.Saraikela-Kharsawan": "Saraikela-Kharsawan",
    "place.district.Jharkhand.Simdega": "Simdega",
    "place.district.Jharkhand.West Singhbhum": "West Singhbhum",
    "place.state.Karnataka": "Karnataka",
    "place.district.Karnataka.Bagalkot": "Bagalkot",
    "place.district.Karnataka.Ballari": "Ballari",
    "place.district.Karnataka.Belagavi": "Belagavi",
    "place.district.Karnataka.Bengaluru Rural": "Bengaluru Rural",
    "place.district.Karnataka.Bengaluru Urban": "Bengaluru Urban",
    "place.district.Karnataka.Bidar": "Bidar",
    "place.district.Karnataka.Chamarajanagar": "Chamarajanagar",
    "place.district.Karnataka.Chikkaballapur": "Chikkaballapur",
    "place.district.Karnataka.Chikkamagaluru": "Chikkamagaluru",
    "place.district.Karnataka.Chitradurga": "Chitradurga",
    "place.district.Karnataka.Dakshina Kannada": "Dakshina Kannada",
    "place.district.Karnataka.Davanagere": "Davanagere",
    "place.district.Karnataka.Dharwad": "Dharwad",
    "place.district.Karnataka.Gadag": "Gadag",
    "place.district.Karnataka.Hassan": "Hassan",
    "place.district.Karnataka.Haveri": "Haveri",
    "place.district.Karnataka.Kalaburagi": "Kalaburagi",
    "place.district.Karnataka.Kodagu": "Kodagu",
    "place.district.Karnataka.Kolar": "Kolar",
    "place.district.Karnataka.Koppal": "Koppal",
    "place.district.Karnataka.Mandya": "Mandya",
    "place.district.Karnataka.Mysuru": "Mysuru",
    "place.district.Karnataka.Raichur": "Raichur",
    "place.district.Karnataka.Ramanagara": "Ramanagara",
    "place.district.Karnataka.Shivamogga": "Shivamogga",
    "place.district.Karnataka.Tumakuru": "Tumakuru",
    "place.district.Karnataka.Udupi": "Udupi",
    "place.district.Karnataka.Uttara Kannada": "Uttara Kannada",
    "place.district.Karnataka.Vijayapura": "Vijayapura",
    "place.district.Karnataka.Yadgir": "Yadgir",
    "place.state.Kerala": "Kerala",
    "place.district.Kerala.Alappuzha": "Alappuzha",
    "place.district.Kerala.Ernakulam": "Ernakulam",
    "place.district.Kerala.Idukki": "Idukki",
    "place.district.Kerala.Kannur": "Kannur",
    "place.district.Kerala.Kasaragod": "Kasaragod",
    "place.district.Kerala.Kollam": "Kollam",
    "place.district.Kerala.Kottayam": "Kottayam",
    "place.district.Kerala.Kozhikode": "Kozhikode",
    "place.district.Kerala.Malappuram": "Malappuram",
    "place.district.Kerala.Palakkad": "Palakkad",
    "place.district.Kerala.Pathanamthitta": "Pathanamthitta",
    "place.district.Kerala.Thiruvananthapuram": "Thiruvananthapuram",
    "place.district.Kerala.Thrissur": "Thrissur",
    "place.district.Kerala.Wayanad": "Wayanad",
    "place.state.Madhya Pradesh": "Madhya Pradesh",
    "place.district.Madhya Pradesh.Agar-Malwa": "Agar-Malwa",
    "place.district.Madhya Pradesh.Alirajpur": "Alirajpur",
    "place.district.Madhya Pradesh.Anuppur": "Anuppur",
    "place.district.Madhya Pradesh.Ashoknagar": "Ashoknagar",
    "place.district.Madhya Pradesh.Balaghat": "Balaghat",
    "place.district.Madhya Pradesh.Barwani": "Barwani",
    "place.district.Madhya Pradesh.Betul": "Betul",
    "place.district.Madhya Pradesh.Bhind": "Bhind",
    "place.district.Madhya Pradesh.Bhopal": "Bhopal",
    "place.district.Madhya Pradesh.Burhanpur": "Burhanpur",
    "place.district.Madhya Pradesh.Chhatarpur": "Chhatarpur",
    "place.district.Madhya Pradesh.Chhindwara": "Chhindwara",
    "place.district.Madhya Pradesh.Damoh": "Damoh",
    "place.district.Madhya Pradesh.Datia": "Datia",
    "place.district.Madhya Pradesh.Dewas": "Dewas",
    "place.district.Madhya Pradesh.Dhar": "Dhar",
    "place.district.Madhya Pradesh.Dindori": "Dindori",
    "place.district.Madhya Pradesh.Guna": "Guna",
    "place.district.Madhya Pradesh.Gwalior": "Gwalior",
    "place.district.Madhya Pradesh.Harda": "Harda",
    "place.district.Madhya Pradesh.Indore": "Indore",
    "place.district.Madhya Pradesh.Jabalpur": "Jabalpur",
    "place.district.Madhya Pradesh.Jhabua": "Jhabua",
    "place.district.Madhya Pradesh.Katni": "Katni",
    "place.district.Madhya Pradesh.Khandwa": "Khandwa",
    "place.district.Madhya Pradesh.Khargone": "Khargone",
    "place.district.Madhya Pradesh.Maihar": "Maihar",
    "place.district.Madhya Pradesh.Mandla": "Mandla",
    "place.district.Madhya Pradesh.Mandsaur": "Mandsaur",
    "place.district.Madhya Pradesh.Mauganj": "Mauganj",
    "place.district.Madhya Pradesh.Morena": "Morena",
    "place.district.Madhya Pradesh.Narmadapuram": "Narmadapuram",
    "place.district.Madhya Pradesh.Narsinghpur": "Narsinghpur",
    "place.district.Madhya Pradesh.Neemuch": "Neemuch",
    "place.district.Madhya Pradesh.Niwari": "Niwari",
    "place.district.Madhya Pradesh.Panna": "Panna",
    "place.district.Madhya Pradesh.Raisen": "Raisen",
    "place.district.Madhya Pradesh.Rajgarh": "Rajgarh",
    "place.district.Madhya Pradesh.Ratlam": "Ratlam",
    "place.district.Madhya Pradesh.Rewa": "Rewa",
    "place.district.Madhya Pradesh.Sagar": "Sagar",
    "place.district.Madhya Pradesh.Satna": "Satna",
    "place.district.Madhya Pradesh.Sehore": "Sehore",
    "place.district.Madhya Pradesh.Seoni": "Seoni",
    "place.district.Madhya Pradesh.Shahdol": "Shahdol",
    "place.district.Madhya Pradesh.Shajapur": "Shajapur",
    "place.district.Madhya Pradesh.Sheopur": "Sheopur",
    "place.district.Madhya Pradesh.Shivpuri": "Shivpuri",
    "place.district.Madhya Pradesh.Sidhi": "Sidhi",
    "place.district.Madhya Pradesh.Singrauli": "Singrauli",
    "place.district.Madhya Pradesh.Tikamgarh": "Tikamgarh",
    "place.district.Madhya Pradesh.Ujjain": "Ujjain",
    "place.district.Madhya Pradesh.Umaria": "Umaria",
    "place.district.Madhya Pradesh.Vidisha": "Vidisha",
    "place.state.Maharashtra": "Maharashtra",
    "place.district.Maharashtra.Ahilyanagar": "Ahilyanagar",
    "place.district.Maharashtra.Akola": "Akola",
    "place.district.Maharashtra.Amravati": "Amravati",
    "place.district.Maharashtra.Beed": "Beed",
    "place.district.Maharashtra.Bhandara": "Bhandara",
    "place.district.Maharashtra.Buldhana": "Buldhana",
    "place.district.Maharashtra.Chandrapur": "Chandrapur",
    "place.district.Maharashtra.Chhatrapati Sambhajinagar": "Chhatrapati Sambhajinagar",
    "place.district.Maharashtra.Dharashiv": "Dharashiv",
    "place.district.Maharashtra.Dhule": "Dhule",
    "place.district.Maharashtra.Gadchiroli": "Gadchiroli",
    "place.district.Maharashtra.Gondia": "Gondia",
    "place.district.Maharashtra.Hingoli": "Hingoli",
    "place.district.Maharashtra.Jalgaon": "Jalgaon",
    "place.district.Maharashtra.Jalna": "Jalna",
    "place.district.Maharashtra.Kolhapur": "Kolhapur",
    "place.district.Maharashtra.Latur": "Latur",
    "place.district.Maharashtra.Mumbai City": "Mumbai City",
    "place.district.Maharashtra.Mumbai Suburban": "Mumbai Suburban",
    "place.district.Maharashtra.Nagpur": "Nagpur",
    "place.district.Maharashtra.Nanded": "Nanded",
    "place.district.Maharashtra.Nandurbar": "Nandurbar",
    "place.district.Maharashtra.Nashik": "Nashik",
    "place.district.Maharashtra.Palghar": "Palghar",
    "place.district.Maharashtra.Parbhani": "Parbhani",
    "place.district.Maharashtra.Pune": "Pune",
    "place.district.Maharashtra.Raigad": "Raigad",
    "place.district.Maharashtra.Ratnagiri": "Ratnagiri",
    "place.district.Maharashtra.Sangli": "Sangli",
    "place.district.Maharashtra.Satara": "Satara",
    "place.district.Maharashtra.Sindhudurg": "Sindhudurg",
    "place.district.Maharashtra.Solapur": "Solapur",
    "place.district.Maharashtra.Thane": "Thane",
    "place.district.Maharashtra.Wardha": "Wardha",
    "place.district.Maharashtra.Washim": "Washim",
    "place.district.Maharashtra.Yavatmal": "Yavatmal",
    "place.state.Manipur": "Manipur",
    "place.district.Manipur.Bishnupur": "Bishnupur",
    "place.district.Manipur.Chandel": "Chandel",
    "place.district.Manipur.Churachandpur": "Churachandpur",
    "place.district.Manipur.Imphal East": "Imphal East",
    "place.district.Manipur.Imphal West": "Imphal West",
    "place.district.Manipur.Jiribam": "Jiribam",
    "place.district.Manipur.Kakching": "Kakching",
    "place.district.Manipur.Kamjong": "Kamjong",
    "place.district.Manipur.Kangpokpi": "Kangpokpi",
    "place.district.Manipur.Noney": "Noney",
    "place.district.Manipur.Pherzawl": "Pherzawl",
    "place.district.Manipur.Senapati": "Senapati",
    "place.district.Manipur.Tamenglong": "Tamenglong",
    "place.district.Manipur.Tengnoupal": "Tengnoupal",
    "place.district.Manipur.Thoubal": "Thoubal",
    "place.district.Manipur.Ukhrul": "Ukhrul",
    "place.state.Meghalaya": "Meghalaya",
    "place.district.Meghalaya.East Garo Hills": "East Garo Hills",
    "place.district.Meghalaya.East Jaintia Hills": "East Jaintia Hills",
    "place.district.Meghalaya.East Khasi Hills": "East Khasi Hills",
    "place.district.Meghalaya.North Garo Hills": "North Garo Hills",
    "place.district.Meghalaya.Ri Bhoi": "Ri Bhoi",
    "place.district.Meghalaya.South Garo Hills": "South Garo Hills",
    "place.district.Meghalaya.South West Garo Hills": "South West Garo Hills",
    "place.district.Meghalaya.South West Khasi Hills": "South West Khasi Hills",
    "place.district.Meghalaya.West Garo Hills": "West Garo Hills",
    "place.district.Meghalaya.West Jaintia Hills": "West Jaintia Hills",
    "place.district.Meghalaya.West Khasi Hills": "West Khasi Hills",
    "place.state.Mizoram": "Mizoram",
    "place.district.Mizoram.Aizawl": "Aizawl",
    "place.district.Mizoram.Champhai": "Champhai",
    "place.district.Mizoram.Hnahthial": "Hnahthial",
    "place.district.Mizoram.Khawzawl": "Khawzawl",
    "place.district.Mizoram.Kolasib": "Kolasib",
    "place.district.Mizoram.Lawngtlai": "Lawngtlai",
    "place.district.Mizoram.Lunglei": "Lunglei",
    "place.district.Mizoram.Mamit": "Mamit",
    "place.district.Mizoram.Saitual": "Saitual",
    "place.district.Mizoram.Serchhip": "Serchhip",
    "place.state.Nagaland": "Nagaland",
    "place.district.Nagaland.Chumoukedima": "Chumoukedima",
    "place.district.Nagaland.Dimapur": "Dimapur",
    "place.district.Nagaland.Kiphire": "Kiphire",
    "place.district.Nagaland.Kohima": "Kohima",
    "place.district.Nagaland.Longleng": "Longleng",
    "place.district.Nagaland.Mokokchung": "Mokokchung",
    "place.district.Nagaland.Mon": "Mon",
    "place.district.Nagaland.Noklak": "Noklak",
    "place.district.Nagaland.Peren": "Peren",
    "place.district.Nagaland.Phek": "Phek",
    "place.district.Nagaland.Shamator": "Shamator",
    "place.district.Nagaland.Tseminyu": "Tseminyu",
    "place.district.Nagaland.Tuensang": "Tuensang",
    "place.district.Nagaland.Wokha": "Wokha",
    "place.district.Nagaland.Zunheboto": "Zunheboto",
    "place.state.Odisha": "Odisha",
    "place.district.Odisha. Koraput": "Koraput",
    "place.district.Odisha.Angul": "Angul",
    "place.district.Odisha.Balangir": "Balangir",
    "place.district.Odisha.Balasore": "Balasore",
    "place.district.Odisha.Bargarh": "Bargarh",
    "place.district.Odisha.Bhadrak": "Bhadrak",
    "place.district.Odisha.Boudh": "Boudh",
    "place.district.Odisha.Cuttack": "Cuttack",
    "place.district.Odisha.Deogarh": "Deogarh",
    "place.district.Odisha.Dhenkanal": "Dhenkanal",
    "place.district.Odisha.Gajapati": "Gajapati",
    "place.district.Odisha.Ganjam": "Ganjam",
    "place.district.Odisha.Jagatsinghpur": "Jagatsinghpur",
    "place.district.Odisha.Jajpur": "Jajpur",
    "place.district.Odisha.Jharsuguda": "Jharsuguda",
    "place.district.Odisha.Kalahandi": "Kalahandi",
    "place.district.Odisha.Kandhamal": "Kandhamal",
    "place.district.Odisha.Kendrapara": "Kendrapara",
    "place.district.Odisha.Keonjhar": "Keonjhar",
    "place.district.Odisha.Khordha": "Khordha",
    "place.district.Odisha.Malkangiri": "Malkangiri",
    "place.district.Odisha.Mayurbhanj": "Mayurbhanj",
    "place.district.Odisha.Nabarangpur": "Nabarangpur",
    "place.district.Odisha.Nayagarh": "Nayagarh",
    "place.district.Odisha.Nuapada": "Nuapada",
    "place.district.Odisha.Puri": "Puri",
    "place.district.Odisha.Rayagada": "Rayagada",
    "place.district.Odisha.Sambalpur": "Sambalpur",
    "place.district.Odisha.Subarnapur": "Subarnapur",
    "place.district.Odisha.Sundargarh": "Sundargarh",
    "place.state.Punjab": "Punjab",
    "place.district.Punjab.Amritsar": "Amritsar",
    "place.district.Punjab.Barnala": "Barnala",
    "place.district.Punjab.Bathinda": "Bathinda",
    "place.district.Punjab.Faridkot": "Faridkot",
    "place.district.Punjab.Fatehgarh Sahib": "Fatehgarh Sahib",
    "place.district.Punjab.Fazilka": "Fazilka",
    "place.district.Punjab.Ferozepur": "Ferozepur",
    "place.district.Punjab.Gurdaspur": "Gurdaspur",
    "place.district.Punjab.Hoshiarpur": "Hoshiarpur",
    "place.district.Punjab.Jalandhar": "Jalandhar",
    "place.district.Punjab.Kapurthala": "Kapurthala",
    "place.district.Punjab.Ludhiana": "Ludhiana",
    "place.district.Punjab.Malerkotla": "Malerkotla",
    "place.district.Punjab.Mansa": "Mansa",
    "place.district.Punjab.Moga": "Moga",
    "place.district.Punjab.Muktsar": "Muktsar",
    "place.district.Punjab.Pathankot": "Pathankot",
    "place.district.Punjab.Patiala": "Patiala",
    "place.district.Punjab.Sahibzada Ajit Singh Nagar": "Sahibzada Ajit Singh Nagar",
    "place.district.Punjab.Sangrur": "Sangrur",
    "place.district.Punjab.Shaheed Bhagat Singh Nagar": "Shaheed Bhagat Singh Nagar",
    "place.district.Punjab.Tarn Taran": "Tarn Taran",
    "place.state.Rajasthan": "Rajasthan",
    "place.district.Rajasthan.Ajmer": "Ajmer",
    "place.district.Rajasthan.Alwar": "Alwar",
    "place.district.Rajasthan.Balotra": "Balotra",
    "place.district.Rajasthan.Banswara": "Banswara",
    "place.district.Rajasthan.Baran": "Baran",
    "place.district.Rajasthan.Barmer": "Barmer",
    "place.district.Rajasthan.Beawar": "Beawar",
    "place.district.Rajasthan.Bharatpur": "Bharatpur",
    "place.district.Rajasthan.Bharatpur? ": "Bharatpur",
    "place.district.Rajasthan.Bhilwara": "Bhilwara",
    "place.district.Rajasthan.Bikaner": "Bikaner",
    "place.district.Rajasthan.Bundi": "Bundi",
    "place.district.Rajasthan.Chittorgarh": "Chittorgarh",
    "place.district.Rajasthan.Churu": "Churu",
    "place.district.Rajasthan.Dausa": "Dausa",
    "place.district.Rajasthan.Deeg": "Deeg",
    "place.district.Rajasthan.Dholpur": "Dholpur",
    "place.district.Rajasthan.Didwana-Kuchamana": "Didwana-Kuchamana",
    "place.district.Rajasthan.Dudu": "Dudu",
    "place.district.Rajasthan.Dungarpur": "Dungarpur",
    "place.district.Rajasthan.Gangapur City": "Gangapur City",
    "place.district.Rajasthan.Hanumangarh": "Hanumangarh",
    "place.district.Rajasthan.Jaipur": "Jaipur",
    "place.district.Rajasthan.Jaipur Rural": "Jaipur Rural",
    "place.district.Rajasthan.Jaisalmer": "Jaisalmer",
    "place.district.Rajasthan.Jalore": "Jalore",
    "place.district.Rajasthan.Jhalawar": "Jhalawar",
    "place.district.Rajasthan.Jhunjhunu": "Jhunjhunu",
    "place.district.Rajasthan.Jodhpur": "Jodhpur",
    "place.district.Rajasthan.Jodhpur Rural": "Jodhpur Rural",
    "place.district.Rajasthan.Karauli": "Karauli",
    "place.district.Rajasthan.Khairthal-Tijara": "Khairthal-Tijara",
    "place.district.Rajasthan.Kota": "Kota",
    "place.district.Rajasthan.Kotputli-Behror": "Kotputli-Behror",
    "place.district.Rajasthan.Nagaur": "Nagaur",
    "place.district.Rajasthan.Neem Ka Thana": "Neem Ka Thana",
    "place.district.Rajasthan.Pali": "Pali",
    "place.district.Rajasthan.Phalodi": "Phalodi",
    "place.district.Rajasthan.Pratapgarh": "Pratapgarh",
    "place.district.Rajasthan.Rajsamand": "Rajsamand",
    "place.district.Rajasthan.Salumbar": "Salumbar",
    "place.district.Rajasthan.Sawai Madhopur": "Sawai Madhopur",
    "place.district.Rajasthan.Sikar": "Sikar",
    "place.district.Rajasthan.Sirohi": "Sirohi",
    "place.district.Rajasthan.Sri Ganganagar": "Sri Ganganagar",
    "place.district.Rajasthan.Tonk": "Tonk",
    "place.district.Rajasthan.Udaipur": "Udaipur",
    "place.state.Sikkim": "Sikkim",
    "place.district.Sikkim.Gangtok": "Gangtok",
    "place.district.Sikkim.Gyalshing": "Gyalshing",
    "place.district.Sikkim.Mangan": "Mangan",
    "place.district.Sikkim.Namchi": "Namchi",
    "place.district.Sikkim.Pakyong": "Pakyong",
    "place.district.Sikkim.Soreng": "Soreng",
    "place.state.Tamil Nadu": "Tamil Nadu",
    "place.district.Tamil Nadu.Ariyalur": "Ariyalur",
    "place.district.Tamil Nadu.Chengalpattu": "Chengalpattu",
    "place.district.Tamil Nadu.Chennai": "Chennai",
    "place.district.Tamil Nadu.Coimbatore": "Coimbatore",
    "place.district.Tamil Nadu.Cuddalore": "Cuddalore",
    "place.district.Tamil Nadu.Dharmapuri": "Dharmapuri",
    "place.district.Tamil Nadu.Dindigul": "Dindigul",
    "place.district.Tamil Nadu.Erode": "Erode",
    "place.district.Tamil Nadu.Kallakurichi": "Kallakurichi",
    "place.district.Tamil Nadu.Kancheepuram": "Kancheepuram",
    "place.district.Tamil Nadu.Karur": "Karur",
    "place.district.Tamil Nadu.Krishnagiri": "Krishnagiri",
    "place.district.Tamil Nadu.Madurai": "Madurai",
    "place.district.Tamil Nadu.Mayiladuthurai": "Mayiladuthurai",
    "place.district.Tamil Nadu.Nagapattinam": "Nagapattinam",
    "place.district.Tamil Nadu.Namakkal": "Namakkal",
    "place.district.Tamil Nadu.Nilgiris": "Nilgiris",
    "place.district.Tamil Nadu.Perambalur": "Perambalur",
    "place.district.Tamil Nadu.Pudukkottai": "Pudukkottai",
    "place.district.Tamil Nadu.Ramanathapuram": "Ramanathapuram",
    "place.district.Tamil Nadu.Ranipet": "Ranipet",
    "place.district.Tamil Nadu.Salem": "Salem",
    "place.district.Tamil Nadu.Sivaganga": "Sivaganga",
    "place.district.Tamil Nadu.Tenkasi": "Tenkasi",
    "place.district.Tamil Nadu.Thanjavur": "Thanjavur",
    "place.district.Tamil Nadu.Theni": "Theni",
    "place.district.Tamil Nadu.Thoothukudi": "Thoothukudi",
    "place.district.Tamil Nadu.Tiruchirappalli": "Tiruchirappalli",
    "place.district.Tamil Nadu.Tirunelveli": "Tirunelveli",
    "place.district.Tamil Nadu.Tirupathur": "Tirupathur",
    "place.district.Tamil Nadu.Tiruppur": "Tiruppur",
    "place.district.Tamil Nadu.Tiruvallur": "Tiruvallur",
    "place.district.Tamil Nadu.Tiruvannamalai": "Tiruvannamalai",
    "place.district.Tamil Nadu.Tiruvarur": "Tiruvarur",
    "place.district.Tamil Nadu.Vellore": "Vellore",
    "place.district.Tamil Nadu.Viluppuram": "Viluppuram",
    "place.district.Tamil Nadu.Virudhunagar": "Virudhunagar",
    "place.state.Telangana": "Telangana",
    "place.district.Telangana. Mahabubabad": "Mahabubabad",
    "place.district.Telangana.Adilabad": "Adilabad",
    "place.district.Telangana.Bhadradri Kothagudem": "Bhadradri Kothagudem",
    "place.district.Telangana.Hanamkonda": "Hanamkonda",
    "place.district.Telangana.Hyderabad": "Hyderabad",
    "place.district.Telangana.Jagtial": "Jagtial",
    "place.district.Telangana.Jangaon": "Jangaon",
    "place.district.Telangana.Jayashankar Bhupalpally": "Jayashankar Bhupalpally",
    "place.district.Telangana.Jogulamba Gadwal": "Jogulamba Gadwal",
    "place.district.Telangana.Kamareddy": "Kamareddy",
    "place.district.Telangana.Karimnagar": "Karimnagar",
    "place.district.Telangana.Khammam": "Khammam",
    "place.district.Telangana.Komaram Bheem": "Komaram Bheem",
    "place.district.Telangana.Mahbubnagar": "Mahbubnagar",
    "place.district.Telangana.Mancherial": "Mancherial",
    "place.district.Telangana.Medak": "Medak",
    "place.district.Telangana.Medchal-Malkajgiri": "Medchal-Malkajgiri",
    "place.district.Telangana.Mulugu": "Mulugu",
    "place.district.Telangana.Nagarkurnool": "Nagarkurnool",
    "place.district.Telangana.Nalgonda": "Nalgonda",
    "place.district.Telangana.Narayanpet": "Narayanpet",
    "place.district.Telangana.Nirmal": "Nirmal",
    "place.district.Telangana.Nizamabad": "Nizamabad",
    "place.district.Telangana.Peddapalli": "Peddapalli",
    "place.district.Telangana.Rajanna Sircilla": "Rajanna Sircilla",
    "place.district.Telangana.Rangareddy": "Rangareddy",
    "place.district.Telangana.Sangareddy": "Sangareddy",
    "place.district.Telangana.Siddipet": "Siddipet",
    "place.district.Telangana.Suryapet": "Suryapet",
    "place.district.Telangana.Vikarabad": "Vikarabad",
    "place.district.Telangana.Warangal": "Warangal",
    "place.district.Telangana.Yadadri Bhuvanagiri": "Yadadri Bhuvanagiri",
    "place.state.Tripura": "Tripura",
    "place.district.Tripura.Dhalai": "Dhalai",
    "place.district.Tripura.Gomati": "Gomati",
    "place.district.Tripura.Khowai": "Khowai",
    "place.district.Tripura.North Tripura": "North Tripura",
    "place.district.Tripura.Sepahijala": "Sepahijala",
    "place.district.Tripura.South Tripura": "South Tripura",
    "place.district.Tripura.Unakoti": "Unakoti",
    "place.district.Tripura.West Tripura": "West Tripura",
    "place.state.Uttar Pradesh": "Uttar Pradesh",
    "place.district.Uttar Pradesh.Agra": "Agra",
    "place.district.Uttar Pradesh.Aligarh": "Aligarh",
    "place.district.Uttar Pradesh.Ambedkar Nagar": "Ambedkar Nagar",
    "place.district.Uttar Pradesh.Amethi": "Amethi",
    "place.district.Uttar Pradesh.Amroha": "Amroha",
    "place.district.Uttar Pradesh.Auraiya": "Auraiya",
    "place.district.Uttar Pradesh.Ayodhya": "Ayodhya",
    "place.district.Uttar Pradesh.Azamgarh": "Azamgarh",
    "place.district.Uttar Pradesh.Baghpat": "Baghpat",
    "place.district.Uttar Pradesh.Bahraich": "Bahraich",
    "place.district.Uttar Pradesh.Ballia": "Ballia",
    "place.district.Uttar Pradesh.Balrampur": "Balrampur",
    "place.district.Uttar Pradesh.Banda": "Banda",
    "place.district.Uttar Pradesh.Barabanki": "Barabanki",
    "place.district.Uttar Pradesh.Bareilly": "Bareilly",
    "place.district.Uttar Pradesh.Basti": "Basti",
    "place.district.Uttar Pradesh.Bhadohi": "Bhadohi",
    "place.district.Uttar Pradesh.Bijnor": "Bijnor",
    "place.district.Uttar Pradesh.Budaun": "Budaun",
    "place.district.Uttar Pradesh.Bulandshahr": "Bulandshahr",
    "place.district.Uttar Pradesh.Chandauli": "Chandauli",
    "place.district.Uttar Pradesh.Chitrakoot": "Chitrakoot",
    "place.district.Uttar Pradesh.Deoria": "Deoria",
    "place.district.Uttar Pradesh.Etah": "Etah",
    "place.district.Uttar Pradesh.Etawah": "Etawah",
    "place.district.Uttar Pradesh.Farrukhabad": "Farrukhabad",
    "place.district.Uttar Pradesh.Fatehpur": "Fatehpur",
    "place.district.Uttar Pradesh.Firozabad": "Firozabad",
    "place.district.Uttar Pradesh.Gautam Buddha Nagar": "Gautam Buddha Nagar",
    "place.district.Uttar Pradesh.Ghaziabad": "Ghaziabad",
    "place.district.Uttar Pradesh.Ghazipur": "Ghazipur",
    "place.district.Uttar Pradesh.Gonda": "Gonda",
    "place.district.Uttar Pradesh.Gorakhpur": "Gorakhpur",
    "place.district.Uttar Pradesh.Hamirpur": "Hamirpur",
    "place.district.Uttar Pradesh.Hapur": "Hapur",
    "place.district.Uttar Pradesh.Hardoi": "Hardoi",
    "place.district.Uttar Pradesh.Hathras": "Hathras",
    "place.district.Uttar Pradesh.Jalaun": "Jalaun",
    "place.district.Uttar Pradesh.Jaunpur": "Jaunpur",
    "place.district.Uttar Pradesh.Jhansi": "Jhansi",
    "place.district.Uttar Pradesh.Kannauj": "Kannauj",
    "place.district.Uttar Pradesh.Kanpur Dehat": "Kanpur Dehat",
    "place.district.Uttar Pradesh.Kanpur Nagar": "Kanpur Nagar",
    "place.district.Uttar Pradesh.Kasganj": "Kasganj",
    "place.district.Uttar Pradesh.Kaushambi": "Kaushambi",
    "place.district.Uttar Pradesh.Kushinagar": "Kushinagar",
    "place.district.Uttar Pradesh.Lakhimpur Kheri": "Lakhimpur Kheri",
    "place.district.Uttar Pradesh.Lalitpur": "Lalitpur",
    "place.district.Uttar Pradesh.Lucknow": "Lucknow",
    "place.district.Uttar Pradesh.Maharajganj": "Maharajganj",
    "place.district.Uttar Pradesh.Mahoba": "Mahoba",
    "place.district.Uttar Pradesh.Mainpuri": "Mainpuri",
    "place.district.Uttar Pradesh.Mathura": "Mathura",
    "place.district.Uttar Pradesh.Mau": "Mau",
    "place.district.Uttar Pradesh.Meerut": "Meerut",
    "place.district.Uttar Pradesh.Mirzapur": "Mirzapur",
    "place.district.Uttar Pradesh.Moradabad": "Moradabad",
    "place.district.Uttar Pradesh.Muzaffarnagar": "Muzaffarnagar",
    "place.district.Uttar Pradesh.Pilibhit": "Pilibhit",
    "place.district.Uttar Pradesh.Pratapgarh": "Pratapgarh",
    "place.district.Uttar Pradesh.Prayagraj": "Prayagraj",
    "place.district.Uttar Pradesh.Raebareli": "Raebareli",
    "place.district.Uttar Pradesh.Rampur": "Rampur",
    "place.district.Uttar Pradesh.Saharanpur": "Saharanpur",
    "place.district.Uttar Pradesh.Sambhal": "Sambhal",
    "place.district.Uttar Pradesh.Sant Kabir Nagar": "Sant Kabir Nagar",
    "place.district.Uttar Pradesh.Shahjahanpur": "Shahjahanpur",
    "place.district.Uttar Pradesh.Shamli": "Shamli",
    "place.district.Uttar Pradesh.Shravasti": "Shravasti",
    "place.district.Uttar Pradesh.Siddharthnagar": "Siddharthnagar",
    "place.district.Uttar Pradesh.Sitapur": "Sitapur",
    "place.district.Uttar Pradesh.Sonbhadra": "Sonbhadra",
    "place.district.Uttar Pradesh.Sultanpur": "Sultanpur",
    "place.district.Uttar Pradesh.Unnao": "Unnao",
    "place.district.Uttar Pradesh.Varanasi": "Varanasi",
    "place.state.Uttarakhand": "Uttarakhand",
    "place.district.Uttarakhand.Almora": "Almora",
    "place.district.Uttarakhand.Bageshwar": "Bageshwar",
    "place.district.Uttarakhand.Chamoli": "Chamoli",
    "place.district.Uttarakhand.Champawat": "Champawat",
    "place.district.Uttarakhand.Dehradun": "Dehradun",
    "place.district.Uttarakhand.Haridwar": "Haridwar",
    "place.district.Uttarakhand.Nainital": "Nainital",
    "place.district.Uttarakhand.Pauri Garhwal": "Pauri Garhwal",
    "place.district.Uttarakhand.Pithoragarh": "Pithoragarh",
    "place.district.Uttarakhand.Rudraprayag": "Rudraprayag",
    "place.district.Uttarakhand.Tehri Garhwal": "Tehri Garhwal",
    "place.district.Uttarakhand.Udham Singh Nagar": "Udham Singh Nagar",
    "place.district.Uttarakhand.Uttarkashi": "Uttarkashi",
    "place.state.West Bengal": "West Bengal",
    "place.district.West Bengal.Alipurduar": "Alipurduar",
    "place.district.West Bengal.Bankura": "Bankura",
    "place.district.West Bengal.Birbhum": "Birbhum",
    "place.district.West Bengal.Cooch Behar": "Cooch Behar",
    "place.district.West Bengal.Dakshin Dinajpur": "Dakshin Dinajpur",
    "place.district.West Bengal.Darjeeling": "Darjeeling",
    "place.district.West Bengal.Hooghly": "Hooghly",
    "place.district.West Bengal.Howrah": "Howrah",
    "place.district.West Bengal.Jalpaiguri": "Jalpaiguri",
    "place.district.West Bengal.Jhargram": "Jhargram",
    "place.district.West Bengal.Kalimpong": "Kalimpong",
    "place.district.West Bengal.Kolkata": "Kolkata",
    "place.district.West Bengal.Maldah": "Maldah",
    "place.district.West Bengal.Murshidabad": "Murshidabad",
    "place.district.West Bengal.Nadia": "Nadia",
    "place.district.West Bengal.North 24 Parganas": "North 24 Parganas",
    "place.district.West Bengal.Paschim Medinipur": "Paschim Medinipur",
    "place.district.West Bengal.Pashchim Bardhaman": "Pashchim Bardhaman",
    "place.district.West Bengal.Purba Bardhaman": "Purba Bardhaman",
    "place.district.West Bengal.Purba Medinipur": "Purba Medinipur",
    "place.district.West Bengal.Purulia": "Purulia",
    "place.district.West Bengal.South 24 Parganas": "South 24 Parganas",
    "place.district.West Bengal.Uttar Dinajpur": "Uttar Dinajpur",
    "place.state.Andaman and Nicobar Islands": "Andaman and Nicobar Islands",
    "place.district.Andaman and Nicobar Islands.Nicobar": "Nicobar",
    "place.district.Andaman and Nicobar Islands.North and Middle Andaman": "North and Middle Andaman",
    "place.district.Andaman and Nicobar Islands.South Andaman": "South Andaman",
    "place.state.Chandigarh": "Chandigarh",
    "place.district.Chandigarh.Chandigarh": "Chandigarh",
    "place.state.Dadra and Nagar Haveli and Daman and Diu": "Dadra and Nagar Haveli and Daman and Diu",
    "place.district.Dadra and Nagar Haveli and Daman and Diu.Dadra and Nagar Haveli": "Dadra and Nagar Haveli",
    "place.district.Dadra and Nagar Haveli and Daman and Diu.Daman": "Daman",
    "place.district.Dadra and Nagar Haveli and Daman and Diu.Diu": "Diu",
    "place.state.Delhi": "Delhi",
    "place.district.Delhi.Central Delhi": "Central Delhi",
    "place.district.Delhi.East Delhi": "East Delhi",
    "place.district.Delhi.New Delhi": "New Delhi",
    "place.district.Delhi.North Delhi": "North Delhi",
    "place.district.Delhi.North East Delhi": "North East Delhi",
    "place.district.Delhi.North West Delhi": "North West Delhi",
    "place.district.Delhi.Shahdara": "Shahdara",
    "place.district.Delhi.South Delhi": "South Delhi",
    "place.district.Delhi.South East Delhi": "South East Delhi",
    "place.district.Delhi.South West Delhi": "South West Delhi",
    "place.district.Delhi.West Delhi": "West Delhi",
    "place.state.Jammu and Kashmir": "Jammu and Kashmir",
    "place.district.Jammu and Kashmir.Anantnag": "Anantnag",
    "place.district.Jammu and Kashmir.Bandipora": "Bandipora",
    "place.district.Jammu and Kashmir.Baramulla": "Baramulla",
    "place.district.Jammu and Kashmir.Budgam": "Budgam",
    "place.district.Jammu and Kashmir.Doda": "Doda",
    "place.district.Jammu and Kashmir.Ganderbal": "Ganderbal",
    "place.district.Jammu and Kashmir.Jammu": "Jammu",
    "place.district.Jammu and Kashmir.Kathua": "Kathua",
    "place.district.Jammu and Kashmir.Kishtwar": "Kishtwar",
    "place.district.Jammu and Kashmir.Kulgam": "Kulgam",
    "place.district.Jammu and Kashmir.Kupwara": "Kupwara",
    "place.district.Jammu and Kashmir.Poonch": "Poonch",
    "place.district.Jammu and Kashmir.Pulwama": "Pulwama",
    "place.district.Jammu and Kashmir.Rajouri": "Rajouri",
    "place.district.Jammu and Kashmir.Ramban": "Ramban",
    "place.district.Jammu and Kashmir.Reasi": "Reasi",
    "place.district.Jammu and Kashmir.Samba": "Samba",
    "place.district.Jammu and Kashmir.Shopian": "Shopian",
    "place.district.Jammu and Kashmir.Srinagar": "Srinagar",
    "place.district.Jammu and Kashmir.Udhampur": "Udhampur",
    "place.state.Ladakh": "Ladakh",
    "place.district.Ladakh.Kargil": "Kargil",
    "place.district.Ladakh.Leh": "Leh",
    "place.state.Lakshadweep": "Lakshadweep",
    "place.district.Lakshadweep.Agatti": "Agatti",
    "place.district.Lakshadweep.Andrott": "Andrott",
    "place.district.Lakshadweep.Bitra": "Bitra",
    "place.district.Lakshadweep.Chetlat": "Chetlat",
    "place.district.Lakshadweep.Kadmat": "Kadmat",
    "place.district.Lakshadweep.Kalpeni": "Kalpeni",
    "place.district.Lakshadweep.Kavaratti": "Kavaratti",
    "place.district.Lakshadweep.Kiltan": "Kiltan",
    "place.district.Lakshadweep.Minicoy": "Minicoy",
    "place.state.Puducherry": "Puducherry",
    "place.district.Puducherry.Karaikal": "Karaikal",
    "place.district.Puducherry.Mahe": "Mahe",
    "place.district.Puducherry.Puducherry": "Puducherry",
    "place.district.Puducherry.Yanam": "Yanam",
  },
};

const translationsLoading = {};

async function loadLanguage(lang) {
  if (translations[lang]) return translations[lang];
  if (translationsLoading[lang]) return translationsLoading[lang];

  translationsLoading[lang] = jsonFetch(`/api/ui-strings/${lang}`)
    .then((data) => {
      translations[lang] = data.strings || data;
      return translations[lang];
    })
    .catch((err) => {
      console.warn(`Could not load "${lang}" translations, falling back to English.`, err);
      return null;
    })
    .finally(() => {
      delete translationsLoading[lang];
    });

  return translationsLoading[lang];
}

function t(key) {
  const table = translations[currentLang] || translations.en;
  return table[key] ?? translations.en[key] ?? key;
}

function renderLanguage(lang) {
  currentLang = translations[lang] ? lang : "en";

  try {
    localStorage.setItem("samarthLang", currentLang);
  } catch (e) {}

  const meta = LANGUAGES.find((l) => l.code === currentLang) || LANGUAGES[0];

  document.documentElement.setAttribute("lang", currentLang);
  document.documentElement.setAttribute("dir", meta.rtl ? "rtl" : "ltr");

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });

  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.getAttribute("data-i18n-html"));
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
  });

  document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label")));
  });

  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
  });

  
  refreshAllCustomSelects();

  const label = $("langToggleLabel");
  if (label) {
    label.textContent = meta.short || currentLang.toUpperCase();
  }

  document.querySelectorAll("#langMenu li[data-lang]").forEach((li) => {
    li.setAttribute(
      "aria-selected",
      li.dataset.lang === currentLang ? "true" : "false"
    );
  });

  

  if (window.__openTeamMemberIndex != null) {
    openTeamMember(window.__openTeamMemberIndex);
  }
}

async function applyLanguage(lang) {
  const previousLang = currentLang;

  if (lang === "en" || translations[lang]) {
    renderLanguage(lang);
    return;
  }

  const toggle = $("langToggle");
  if (toggle) toggle.classList.add("lang-loading");

  const loaded = await loadLanguage(lang);

  if (toggle) toggle.classList.remove("lang-loading");

  if (!loaded) {
    toast("Translation unavailable right now \u2014 showing English.");
    renderLanguage(previousLang || "en");
    return;
  }

  renderLanguage(lang);
}

function initializeLanguage() {
  let saved = null;

  try {
    saved = localStorage.getItem("samarthLang");
  } catch (e) {}

  applyLanguage(saved || "en");

  const toggle = $("langToggle");
  const menu = $("langMenu");

  if (!toggle || !menu) return;

  const closeMenu = () => {
    menu.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
  };

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = !menu.classList.contains("is-open");
    menu.classList.toggle("is-open", willOpen);
    toggle.setAttribute("aria-expanded", String(willOpen));

    if (willOpen) {
      const search = $("langMenuSearch");
      if (search) {
        search.value = "";
        menu
          .querySelectorAll("li[data-lang]")
          .forEach((li) => li.classList.remove("lang-option-hidden"));
        setTimeout(() => search.focus(), 0);
      }
    }
  });

  menu.querySelectorAll("li[data-lang]").forEach((li) => {
    li.addEventListener("click", () => {
      applyLanguage(li.dataset.lang);
      closeMenu();
    });
  });

  const search = $("langMenuSearch");
  if (search) {
    search.addEventListener("click", (e) => e.stopPropagation());
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      menu.querySelectorAll("li[data-lang]").forEach((li) => {
        const native = li.textContent.trim().toLowerCase();
        const english = (li.dataset.langName || "").toLowerCase();
        const matches = !q || native.includes(q) || english.includes(q);
        li.classList.toggle("lang-option-hidden", !matches);
      });
    });
  }

  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target) && e.target !== toggle) closeMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });
}



const chatbotSteps = [
  {
    key: "category",
    type: "select",
    selectId: "category",
    otherInputId: "categoryOther",
    question: "bot.qCategory",
    numeric: false,
  },
  {
    key: "familyIncome",
    type: "select",
    selectId: "familyIncome",
    otherInputId: "familyIncomeOther",
    question: "bot.qIncome",
    numeric: true,
  },
  {
    key: "requirementType",
    type: "select",
    selectId: "requirementType",
    otherInputId: "requirementOther",
    question: "bot.qRequirement",
    numeric: false,
  },
  {
    key: "projectCost",
    type: "select",
    selectId: "projectCost",
    otherInputId: "projectCostOther",
    question: "bot.qCost",
    numeric: true,
  },
  {
    key: "educationRequired",
    type: "checkbox",
    checkboxId: "educationRequired",
    question: "bot.qEducationRequired",
  },
  {
    key: "educationStatus",
    type: "select",
    selectId: "educationStatus",
    otherInputId: "educationStatusOther",
    question: "bot.qEducationStatus",
    numeric: false,
  },
  {
    key: "courseField",
    type: "select",
    selectId: "courseField",
    otherInputId: "courseFieldOther",
    question: "bot.qCourseField",
    numeric: false,
  },
  {
    key: "state",
    type: "datalist",
    inputId: "state",
    listId: "stateOptions",
    question: "bot.qState",
  },
  {
    key: "cityDistrict",
    type: "datalist",
    inputId: "cityDistrict",
    listId: "cityDistrictOptions",
    question: "bot.qCityDistrict",
    skipIf: () => $("cityDistrict").disabled,
  },
];

let chatbotStepIndex = 0;

let chatbotSession = 0;
let chatbotStarted = false;
let chatbotUserScrolledUp = false;

function chatbotOptionsFromSelect(selectId) {
  const select = $(selectId);
  if (!select) return [];

  return Array.from(select.options)
    .filter((o) => o.value !== "")
    .map((o) => ({ value: o.value, label: o.textContent.trim() }));
}

function chatbotOptionsFromDatalist(listId) {
  const list = $(listId);
  if (!list) return [];

  return Array.from(list.options)
    .filter((o) => o.value !== "")
    .map((o) => ({ value: o.value, label: o.value }));
}

function initChatbotScrollTracking() {
  const box = $("chatbotMessages");
  if (!box || box.dataset.scrollBound) return;
  box.dataset.scrollBound = "true";

  box.addEventListener("scroll", () => {
    const distanceFromBottom =
      box.scrollHeight - box.scrollTop - box.clientHeight;
    chatbotUserScrolledUp = distanceFromBottom > 40;
  });
}

function scrollChatToBottom(force = false) {
  const box = $("chatbotMessages");
  if (!box) return;

  requestAnimationFrame(() => {
    if (force || !chatbotUserScrolledUp) {
      box.scrollTop = box.scrollHeight;
    }
  });
}

function appendUserMessage(text) {
  const box = $("chatbotMessages");
  if (!box) return;

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble user";
  bubble.textContent = text;
  box.appendChild(bubble);
  scrollChatToBottom();
}

function appendBotMessage(text) {
  const session = chatbotSession;

  return new Promise((resolve) => {
    const box = $("chatbotMessages");
    if (!box) {
      resolve();
      return;
    }

    const typing = document.createElement("div");
    typing.className = "chatbot-typing";
    typing.innerHTML = "<span></span><span></span><span></span>";
    box.appendChild(typing);
    scrollChatToBottom();

    setTimeout(() => {
      typing.remove();

      if (session !== chatbotSession) {
        resolve();
        return;
      }

      const bubble = document.createElement("div");
      bubble.className = "chat-bubble bot";
      bubble.textContent = text;
      box.appendChild(bubble);
      scrollChatToBottom();
      resolve();
    }, 420);
  });
}

function clearChatbotOptions() {
  const box = $("chatbotOptions");
  if (box) box.innerHTML = "";
}

function renderChatbotOptions(step) {
  const box = $("chatbotOptions");
  if (!box) return;

  box.innerHTML = "";

  if (step.type === "checkbox") {
    const yesBtn = document.createElement("button");
    yesBtn.type = "button";
    yesBtn.className = "chat-option";
    yesBtn.textContent = t("bot.yes");
    yesBtn.addEventListener("click", () =>
      chooseChatbotOption(step, "yes", t("bot.yes"))
    );

    const noBtn = document.createElement("button");
    noBtn.type = "button";
    noBtn.className = "chat-option";
    noBtn.textContent = t("bot.no");
    noBtn.addEventListener("click", () =>
      chooseChatbotOption(step, "no", t("bot.no"))
    );

    box.appendChild(yesBtn);
    box.appendChild(noBtn);
    scrollChatToBottom();
    return;
  }

  const options =
    step.type === "datalist"
      ? chatbotOptionsFromDatalist(step.listId)
      : chatbotOptionsFromSelect(step.selectId);

  options.forEach((opt) => {
    if (opt.value === "Other") return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chat-option";
    btn.textContent = opt.label;
    btn.addEventListener("click", () =>
      chooseChatbotOption(step, opt.value, opt.label)
    );
    box.appendChild(btn);
  });

  const hasOther =
    step.type === "datalist" || options.some((o) => o.value === "Other");

  if (hasOther) {
    const otherBtn = document.createElement("button");
    otherBtn.type = "button";
    otherBtn.className = "chat-option";
    otherBtn.textContent =
      step.type === "datalist" ? t("bot.typeManually") : t("opt.other");
    otherBtn.addEventListener("click", () => renderChatbotOtherInput(step));
    box.appendChild(otherBtn);
  }

  scrollChatToBottom();
}

function renderChatbotOtherInput(step) {
  const box = $("chatbotOptions");
  if (!box) return;

  box.innerHTML = "";

  const row = document.createElement("div");
  row.className = "chatbot-other-row";

  const input = document.createElement("input");
  input.type = step.numeric ? "number" : "text";
  if (step.numeric) input.min = "0";
  input.placeholder = t("bot.otherPlaceholder");

  const sendBtn = document.createElement("button");
  sendBtn.type = "button";
  sendBtn.textContent = t("bot.otherSend");

  const submitOther = () => {
    const raw = input.value.trim();
    if (!raw) {
      input.focus();
      return;
    }
    const value = step.type === "datalist" ? raw : "Other";
    chooseChatbotOption(step, value, raw, raw);
  };

  sendBtn.addEventListener("click", submitOther);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitOther();
    }
  });

  row.appendChild(input);
  row.appendChild(sendBtn);
  box.appendChild(row);
  input.focus();
  scrollChatToBottom();
}

function chooseChatbotOption(step, value, label, otherText) {
  appendUserMessage(label);
  clearChatbotOptions();
  chatbotUserScrolledUp = false;
  scrollChatToBottom(true);

  if (step.type === "checkbox") {
    const checkbox = $(step.checkboxId);
    if (checkbox) {
      checkbox.checked = value === "yes";
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    }
  } else if (step.type === "datalist") {
    const input = $(step.inputId);
    if (input) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  } else {
    const select = $(step.selectId);

    if (select) {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }

    if (value === "Other" && step.otherInputId) {
      const otherInput = $(step.otherInputId);
      if (otherInput) {
        otherInput.value = otherText || "";
        otherInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  }

  


  chatbotStepIndex = chatbotSteps.indexOf(step) + 1;

  const session = chatbotSession;
  setTimeout(() => {
    if (session === chatbotSession) askChatbotStep(chatbotStepIndex);
  }, 260);
}

async function askChatbotStep(index) {
  const session = chatbotSession;

  if (index >= chatbotSteps.length) {
    await finishChatbot();
    return;
  }

  const step = chatbotSteps[index];
  chatbotStepIndex = index;

  if (step.skipIf && step.skipIf()) {
    return askChatbotStep(index + 1);
  }

  await appendBotMessage(t(step.question));
  if (session !== chatbotSession) return;
  renderChatbotOptions(step);
}

async function finishChatbot() {
  const session = chatbotSession;

  await appendBotMessage(t("bot.matching"));
  if (session !== chatbotSession) return;

  try {
    const result = await submitProfile({ preventDefault: () => {} });
    if (session !== chatbotSession) return;
    await appendBotMessage(
      result && result.count > 0 ? t("bot.done") : t("bot.notFound")
    );
  } catch (e) {
    if (session !== chatbotSession) return;
    await appendBotMessage(t("bot.error"));
  }

  if (session !== chatbotSession) return;

  const box = $("chatbotOptions");
  if (box) {
    box.innerHTML = "";

    const restartBtn = document.createElement("button");
    restartBtn.type = "button";
    restartBtn.className = "chat-option";
    restartBtn.textContent = t("bot.restart");
    restartBtn.addEventListener("click", restartChatbot);
    box.appendChild(restartBtn);
    scrollChatToBottom();
  }
}



function resetChatbotConversation() {
  chatbotSession += 1;
  chatbotStepIndex = 0;
  chatbotStarted = false;
  chatbotUserScrolledUp = false;

  clearChatbotOptions();
}

async function startChatbotConversation() {
  chatbotStarted = true;
  const session = chatbotSession;

  await appendBotMessage(t("bot.greeting"));
  if (session !== chatbotSession) return;

  await askChatbotStep(0);
}



async function restartChatbot() {
  resetChatbotConversation();

  const box = $("chatbotMessages");
  if (box) box.innerHTML = "";

  await startChatbotConversation();
}

async function openChatbot() {
  const panel = $("chatbotPanel");
  const launcher = $("chatbotLauncher");
  if (!panel) return;

  panel.classList.remove("hidden");

  requestAnimationFrame(() => {
    panel.classList.add("is-open");
  });

  if (launcher) launcher.setAttribute("aria-expanded", "true");

  chatbotUserScrolledUp = false;
  scrollChatToBottom(true);

  if (!chatbotStarted) {
    const box = $("chatbotMessages");
    if (box) box.innerHTML = "";
    await startChatbotConversation();
  }
}



function closeChatbot() {
  const panel = $("chatbotPanel");
  const launcher = $("chatbotLauncher");
  if (!panel) return;

  panel.classList.remove("is-open");
  if (launcher) launcher.setAttribute("aria-expanded", "false");

  setTimeout(() => panel.classList.add("hidden"), 340);
}


function closeAndResetChatbot() {
  const panel = $("chatbotPanel");
  const wasOpen = panel && panel.classList.contains("is-open");

  resetChatbotConversation();
  closeChatbot();

  
  
  if (wasOpen) {
    setTimeout(() => {
      if (chatbotStarted) return;
      const box = $("chatbotMessages");
      if (box) box.innerHTML = "";
    }, 360);
  }
}

function toggleChatbot() {
  const panel = $("chatbotPanel");

  if (panel && panel.classList.contains("is-open")) {
    closeChatbot();
  } else {
    openChatbot();
  }
}

function initializeChatbot() {
  const launcher = $("chatbotLauncher");
  const closeBtn = $("chatbotClose");
  const minimizeBtn = $("chatbotMinimize");
  const restartBtn = $("chatbotRestart");
  const panel = $("chatbotPanel");

  initChatbotScrollTracking();

  if (launcher) {
    launcher.addEventListener("click", toggleChatbot);
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", closeAndResetChatbot);
  }

  if (minimizeBtn) {
    minimizeBtn.addEventListener("click", closeChatbot);
  }

  if (restartBtn) {
    restartBtn.addEventListener("click", restartChatbot);
  }

  document.addEventListener("keydown", (e) => {
    if (
      e.key === "Escape" &&
      panel &&
      panel.classList.contains("is-open")
    ) {
      closeChatbot();
    }
  });
}