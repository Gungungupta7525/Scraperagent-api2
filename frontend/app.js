(() => {
  "use strict";

  const $ = (s, p) => (p || document).querySelector(s);
  const $$ = (s, p) => [...(p || document).querySelectorAll(s)];

  /* --- DOM refs --- */
  const sidebar = $("#sidebar");
  const sidebarToggle = $("#sidebar-toggle");
  const sidebarOverlay = $("#sidebar-overlay");
  const sidebarStatusDot = $("#sidebar-status-dot");
  const sidebarStatusText = $("#sidebar-status-text");
  const mobileApiStatus = $("#mobile-api-status");
  const mobileSettingsBtn = $("#mobile-settings-btn");

  const searchSection = $("#search-section");
  const resultsSection = $("#results-section");
  const candidatesList = $("#candidates-list");
  const skeletonList = $("#skeleton-list");
  const emptyState = $("#empty-state");
  const errorState = $("#error-state");
  const errorDetail = $("#error-detail");
  const resultsTitle = $("#results-title");
  const input = $("#input");
  const sendBtn = $("#send-btn");
  const streamStatus = $("#stream-status");

  const detailPanel = $("#detail-panel");
  const detailPlaceholder = $("#detail-placeholder");
  const detailContent = $("#detail-content");

  const settingsModal = $("#settings-modal");
  const advFilterModal = $("#adv-filter-modal");

  const thresholdSlider = $("#threshold-slider");
  const thresholdVal = $("#threshold-val");
  const sortSelect = $("#sort-select");

  const statStrong = $("#stat-strong");
  const statGood = $("#stat-good");
  const statReview = $("#stat-review");

  const LS_URL = "scraperagent.api_base_url";
  const LS_KEY = "scraperagent.api_key";
  const LS_SHORTLIST = "scraperagent.shortlist";

  let busy = false;
  let allCandidates = [];
  let shortlisted = new Set(JSON.parse(localStorage.getItem(LS_SHORTLIST) || "[]"));
  let activeFilter = "all";
  let threshold = 0;
  let activeSort = "score";
  let lastJobDescription = "";
  let selectedCandidateUrl = null;

  function saveShortlist() {
    localStorage.setItem(LS_SHORTLIST, JSON.stringify([...shortlisted]));
  }

  /* ---------- settings ---------- */
  const settings = {
    get baseUrl() {
      return (localStorage.getItem(LS_URL) || CONFIG.API_BASE_URL).replace(/\/+$/, "");
    },
    get apiKey() {
      return localStorage.getItem(LS_KEY) ?? CONFIG.API_KEY ?? "";
    },
  };

  /* ---------- helpers ---------- */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function escapeHtml(v) {
    const d = document.createElement("div");
    d.textContent = String(v ?? "");
    return d.innerHTML;
  }

  function matchCategory(score) {
    if (score >= 0.70) return "strong";
    if (score >= 0.40) return "good";
    return "review";
  }

  function matchLabel(cat) {
    if (cat === "strong") return "Strong Match";
    if (cat === "good") return "Good Match";
    return "Needs Review";
  }

  function getInitials(name) {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0][0].toUpperCase();
  }

  /* ---------- source icons ---------- */
  const SOURCES = {
    github:       { name: "GitHub",          color: "#24292f", icon: '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="#fff" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>' },
    linkedin:     { name: "LinkedIn",        color: "#0A66C2", icon: '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="#fff" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>' },
    wellfound:    { name: "Wellfound",      color: "#000000", icon: '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="#fff" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V9h2v7zm4 0h-2V9h2v7z"/></svg>' },
    indeed:       { name: "Indeed",         color: "#2164F3", icon: '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="#fff" d="M4 4h16v16H4V4zm4.5 4.5c0-.83.67-1.5 1.5-1.5h4c.83 0 1.5.67 1.5 1.5v1c0 .83-.67 1.5-1.5 1.5h-1v5.5h-2V11h-1c-.83 0-1.5-.67-1.5-1.5v-1z"/></svg>' },
    stackoverflow:{ name: "Stack Overflow",  color: "#F48024", icon: '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="#fff" d="M15 20H5v-2h10v2zm2-4H7v-2h10v2zm2-4H9V8h10v4zM3 4v16h18V4H3z"/></svg>' },
    kaggle:       { name: "Kaggle",         color: "#20BEFF", icon: '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="#fff" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' },
    devto:        { name: "DEV.to",         color: "#0A0A0A", icon: '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="#fff" d="M7.42 10c0-.47.28-.87.7-1.16L12 5.88l3.88 2.96c.42.29.7.69.7 1.16V17c0 .55-.45 1-1 1H8.42c-.55 0-1-.45-1-1v-7z"/></svg>' },
    hashnode:     { name: "Hashnode",       color: "#2962FF", icon: '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="#fff" d="M12 2L4 7v10l8 5 8-5V7l-8-5zm0 2.18L17.18 7 12 9.82 6.82 7 12 4.18z"/></svg>' },
    artstation:   { name: "ArtStation",     color: "#13ADA5", icon: '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="#fff" d="M0 17.723l2.027 3.505h.001a2.424 2.424 0 002.164 1.333h13.457l-2.792-4.838H0zm24-2.49l-4.397-7.618a2.428 2.428 0 00-2.107-1.222H7.384l5.364 9.291 11.252.002z"/></svg>' },
    dribbble:     { name: "Dribbble",       color: "#EA4C89", icon: '<svg viewBox="0 0 24 24" width="12" height="12"><circle cx="12" cy="12" r="10" fill="#EA4C89"/><path fill="#fff" d="M8.56 7.06c1.17 1.51 1.92 3.37 2.16 5.36-1.07-.15-2.15-.15-2.99.01-.15-1.07.53-2.13 1.44-2.93l.39-.44z"/></svg>' },
    researchgate: { name: "ResearchGate",   color: "#00D0AF", icon: '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="#fff" d="M19.586 0c-1.16 0-2.236.56-3.037 1.425L13.1 5.07a4.39 4.39 0 00-2.1 2.03l-.014.03-.014.028c-.454.897-.687 1.886-.687 2.89 0 .37.04.736.118 1.095l-2.28 2.28C5.644 12.217 4.27 11.02 3.36 9.58a4.02 4.02 0 00-.79 1.14l-.01.03-.007.025c-.37.853-.556 1.78-.556 2.74 0 1.67.67 3.19 1.76 4.29A6.02 6.02 0 006.42 20a5.95 5.95 0 004.24-1.76l2.88-2.88a4.35 4.35 0 002.1-1.07l4.24-5.26A3.12 3.12 0 0021.7 7.5a3.12 3.12 0 00-2.116-3.9V3.6C20.42 3.6 21 3.02 21 2.3S20.42 1 19.7 1h-.114z"/></svg>' },
    orcid:        { name: "ORCID",          color: "#A6CE39", icon: '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="#fff" d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm-1.5 18.9h-3v-9h3v9zM9.75 8.4a1.8 1.8 0 110-3.6 1.8 1.8 0 010 3.6zm11.25 10.5h-3v-4.59c0-1.04-.02-2.38-1.45-2.38-1.45 0-1.67 1.14-1.67 2.31V17.4h-3v-9h2.89v1.23h.04c.4-.76 1.37-1.56 2.83-1.56 3.03 0 3.59 2 3.59 4.6V18.9z"/></svg>' },
    producthunt:  { name: "Product Hunt",   color: "#DA552F", icon: '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="#fff" d="M12 24C5.37 24 0 18.63 0 12S5.37 0 12 0s12 5.37 12 12-5.37 12-12 12zM9.6 8.4h4.8v3.6H9.6V8.4zm0 5.4h4.8v3.6H9.6v-3.6z"/></svg>' },
    indiehackers: { name: "Indie Hackers",  color: "#0F1C2E", icon: '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="#fff" d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>' },
    huggingface:  { name: "Hugging Face",   color: "#FFD21E", icon: '<svg viewBox="0 0 24 24" width="12" height="12"><circle cx="12" cy="12" r="10" fill="#FFD21E"/><path fill="#000" d="M8 10a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm8 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm-4 8c3.31 0 6-1.34 6-3v-2c0-1.66-2.69-3-6-3s-6 1.34-6 3v2c0 1.66 2.69 3 6 3z"/></svg>' },
    google:       { name: "Google Scholar",  color: "#4285F4", icon: '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="#fff" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>' },
  };

  function sourceBadgeHtml(source, url) {
    const info = SOURCES[source];
    if (!info) return escapeHtml(source);
    const href = url ? ` href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"` : "";
    return `<a class="source-badge" style="--badge-color:${info.color}"${href} title="Open ${escapeHtml(info.name)} profile" onclick="event.stopPropagation()">${info.icon}<span>${escapeHtml(info.name)}</span></a>`;
  }

  /* ---------- sidebar ---------- */
  function toggleSidebar() {
    sidebar.classList.toggle("open");
    sidebarOverlay.classList.toggle("open");
  }
  sidebarToggle.addEventListener("click", toggleSidebar);
  sidebarOverlay.addEventListener("click", toggleSidebar);

  /* ---------- status ---------- */
  function setStatus(state, label) {
    sidebarStatusDot.className = "status-dot" + (state ? ` ${state}` : "");
    sidebarStatusText.textContent = label;
    mobileApiStatus.className = "mobile-api-status" + (state ? ` ${state}` : "");
    mobileApiStatus.textContent = label;
  }

  /* ---------- rendering ---------- */
  function renderResults(data) {
    allCandidates = data.candidates || [];
    lastJobDescription = input.value.trim() || lastJobDescription;
    applyFilterAndSort();
    resultsSection.classList.remove("hidden");
    detailPanel.classList.remove("hidden");
    detailPlaceholder.classList.remove("hidden");
    detailContent.classList.add("hidden");
    selectedCandidateUrl = null;
  }

  function applyFilterAndSort() {
    let filtered = allCandidates.filter((c) => {
      const score = c.relevance_score || 0;
      if (score * 100 < threshold) return false;
      if (activeFilter !== "all" && matchCategory(score) !== activeFilter) return false;
      return true;
    });

    if (activeSort === "name") {
      filtered.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }

    renderStats();
    renderCards(filtered);
  }

  function renderStats() {
    const counts = { strong: 0, good: 0, review: 0 };
    allCandidates.forEach((c) => {
      const score = c.relevance_score || 0;
      if (score * 100 >= threshold) counts[matchCategory(score)]++;
    });
    statStrong.textContent = counts.strong;
    statGood.textContent = counts.good;
    statReview.textContent = counts.review;
    const total = counts.strong + counts.good + counts.review;
    resultsTitle.textContent = `${total} Candidate${total !== 1 ? "s" : ""} Found`;
  }

  function renderCards(candidates) {
    candidatesList.innerHTML = "";
    if (candidates.length === 0) {
      candidatesList.classList.add("hidden");
      emptyState.classList.remove("hidden");
      return;
    }
    emptyState.classList.add("hidden");
    candidatesList.classList.remove("hidden");
    candidates.forEach((c, i) => candidatesList.appendChild(candidateCard(c, i)));
  }

  function candidateCard(c, index) {
    const score = c.relevance_score || 0;
    const pct = Math.round(score * 100);
    const cat = matchCategory(score);
    const isSelected = selectedCandidateUrl === c.url;

    const card = el("div", `candidate${isSelected ? " selected" : ""}`);
    card.addEventListener("click", () => selectCandidate(c, index));

    /* top row: avatar + info + score */
    const top = el("div", "cand-top");

    const avatar = el("div", "cand-avatar", getInitials(c.name));
    top.appendChild(avatar);

    const info = el("div", "cand-info");
    const nameRow = el("div", "cand-name-row");
    nameRow.appendChild(el("span", "cand-name", c.name || `Candidate ${index + 1}`));
    info.appendChild(nameRow);

    const roleText = c.role || c.headline || "";
    if (roleText) info.appendChild(el("div", "cand-role", roleText));

    const metaParts = [];
    if (c.experience) metaParts.push(c.experience);
    if (c.location) metaParts.push(c.location);
    if (metaParts.length) {
      const meta = el("div", "cand-meta");
      metaParts.forEach((p, i) => {
        if (i > 0) meta.appendChild(el("span", "sep", "\u00B7"));
        meta.appendChild(el("span", "", p));
      });
      info.appendChild(meta);
    }
    top.appendChild(info);

    const scoreBlock = el("div", "cand-score-badge");
    scoreBlock.appendChild(el("div", `cand-pct ${cat}`, `${pct}%`));
    scoreBlock.appendChild(el("div", `cand-match-label ${cat}`, matchLabel(cat)));
    top.appendChild(scoreBlock);

    card.appendChild(top);

    /* match bar */
    const bar = el("div", "cand-match-bar");
    const fill = el("div", `cand-match-fill ${cat}`);
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);
    card.appendChild(bar);

    /* skills */
    if (Array.isArray(c.skills) && c.skills.length) {
      const skills = el("div", "cand-skills");
      c.skills.slice(0, 5).forEach((s) => {
        skills.appendChild(el("span", "skill matched", s));
      });
      if (c.skills.length > 5) {
        skills.appendChild(el("span", "skill", `+${c.skills.length - 5}`));
      }
      card.appendChild(skills);
    }

    /* footer */
    const footer = el("div", "cand-footer");
    if (c.source) {
      const badgeWrap = document.createElement("span");
      badgeWrap.innerHTML = sourceBadgeHtml(c.source, c.url);
      footer.appendChild(badgeWrap);
    }

    const actions = el("div", "cand-actions");
    const isShortlisted = shortlisted.has(c.url);

    const shortBtn = el("button", `btn-sm${isShortlisted ? " shortlisted" : ""}`, isShortlisted ? "Shortlisted" : "Shortlist");
    shortBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (shortlisted.has(c.url)) {
        shortlisted.delete(c.url);
        shortBtn.className = "btn-sm";
        shortBtn.textContent = "Shortlist";
      } else {
        shortlisted.add(c.url);
        shortBtn.className = "btn-sm shortlisted";
        shortBtn.textContent = "Shortlisted";
      }
      saveShortlist();
    });
    actions.appendChild(shortBtn);
    footer.appendChild(actions);
    card.appendChild(footer);

    return card;
  }

  /* ---------- detail panel ---------- */
  function selectCandidate(c, index) {
    selectedCandidateUrl = c.url;
    $$(".candidate", candidatesList).forEach((card) => card.classList.remove("selected"));
    const cards = $$(".candidate", candidatesList);
    if (cards[index]) cards[index].classList.add("selected");

    const score = c.relevance_score || 0;
    const pct = Math.round(score * 100);
    const cat = matchCategory(score);
    const isShortlisted = shortlisted.has(c.url);

    let html = `
      <div class="detail-header">
        <div class="detail-avatar">${getInitials(c.name)}</div>
        <div class="detail-header-info">
          <div class="detail-name">${escapeHtml(c.name || `Candidate ${index + 1}`)}</div>
          <div class="detail-role">${escapeHtml(c.role || c.headline || "")}</div>
          <div class="detail-meta">
            ${c.experience ? `<span>${escapeHtml(c.experience)}</span>` : ""}
            ${c.location ? `<span>${c.experience ? "\u00B7 " : ""}${escapeHtml(c.location)}</span>` : ""}
          </div>
        </div>
        <div class="detail-score-block">
          <div class="detail-pct ${cat}">${pct}%</div>
          <div class="detail-match-label ${cat}">${matchLabel(cat)}</div>
        </div>
      </div>

      <div class="detail-tabs">
        <button class="detail-tab active" data-tab="overview">Overview</button>
        <button class="detail-tab" data-tab="skills">Skills</button>
        <button class="detail-tab" data-tab="analysis">Match Analysis</button>
      </div>

      <div class="detail-tab-content" data-tab-content="overview">
        <div class="detail-section">
          <div class="detail-section-title">Why this candidate matches</div>
          <div class="detail-match-text">${escapeHtml(generateMatchExplanation(c))}</div>
        </div>
        <div class="detail-section">
          <div class="detail-section-title">Key Skills</div>
          <div class="detail-skills">
            ${(c.skills || []).map((s) => `<span class="skill matched">${escapeHtml(s)}</span>`).join("")}
          </div>
        </div>
        ${c.summary ? `
        <div class="detail-section">
          <div class="detail-section-title">Summary</div>
          <div class="detail-match-text">${escapeHtml(c.summary)}</div>
        </div>` : ""}
      </div>

      <div class="detail-tab-content hidden" data-tab-content="skills">
        <div class="detail-section">
          <div class="detail-section-title">Skills & Expertise</div>
          <div class="detail-skills">
            ${(c.skills || []).map((s) => `<span class="skill matched">${escapeHtml(s)}</span>`).join("")}
          </div>
        </div>
        <div class="detail-section">
          <div class="detail-section-title">Details</div>
          <table class="requirement-table">
            ${c.location ? `<tr><td>Location</td><td>${escapeHtml(c.location)}</td></tr>` : ""}
            ${c.experience ? `<tr><td>Experience</td><td>${escapeHtml(c.experience)}</td></tr>` : ""}
            ${c.source ? `<tr><td>Source</td><td>${sourceBadgeHtml(c.source, c.url)}</td></tr>` : ""}
            ${c.url ? `<tr><td>Profile</td><td><a href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:none;font-size:13px">${escapeHtml(c.url).replace(/^https?:\/\//, "").replace(/\/$/, "")}</a></td></tr>` : ""}
          </table>
        </div>
      </div>

      <div class="detail-tab-content hidden" data-tab-content="analysis">
        <div class="detail-section">
          <div class="detail-section-title">Match Analysis</div>
          <table class="requirement-table">
            ${(c.skills || []).slice(0, 8).map((s) => `
              <tr>
                <td>${escapeHtml(s)}</td>
                <td><span class="req-check">✓</span> Strong</td>
              </tr>
            `).join("")}
            ${c.experience ? `
            <tr>
              <td>Experience</td>
              <td><span class="req-check">✓</span> ${escapeHtml(c.experience)}</td>
            </tr>` : ""}
          </table>
        </div>
      </div>

      <div class="detail-actions">
        ${c.url ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer" class="btn-primary" style="text-decoration:none">View Full Profile</a>` : ""}
        <button class="btn-ghost detail-shortlist-btn${isShortlisted ? " shortlisted" : ""}" data-url="${escapeHtml(c.url || "")}">${isShortlisted ? "Shortlisted" : "Shortlist"}</button>
      </div>
    `;

    detailContent.innerHTML = html;
    detailPlaceholder.classList.add("hidden");
    detailContent.classList.remove("hidden");

    /* wire up tabs */
    $$(".detail-tab", detailContent).forEach((tab) => {
      tab.addEventListener("click", () => {
        $$(".detail-tab", detailContent).forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        const tabName = tab.dataset.tab;
        $$(".detail-tab-content", detailContent).forEach((tc) => {
          tc.classList.toggle("hidden", tc.dataset.tabContent !== tabName);
        });
      });
    });

    /* wire up shortlist button */
    const detailShortBtn = detailContent.querySelector(".detail-shortlist-btn");
    if (detailShortBtn) {
      detailShortBtn.addEventListener("click", () => {
        const url = detailShortBtn.dataset.url;
        if (shortlisted.has(url)) {
          shortlisted.delete(url);
          detailShortBtn.classList.remove("shortlisted");
          detailShortBtn.textContent = "Shortlist";
        } else {
          shortlisted.add(url);
          detailShortBtn.classList.add("shortlisted");
          detailShortBtn.textContent = "Shortlisted";
        }
        saveShortlist();
        applyFilterAndSort();
      });
    }

    /* on mobile, open detail as overlay */
    if (window.innerWidth < 768) {
      detailPanel.classList.add("mobile-open");
    }
  }

  function generateMatchExplanation(c) {
    const skills = c.skills || [];
    const parts = [];
    if (c.name) parts.push(`${c.name} is a strong candidate`);
    else parts.push("This is a strong candidate");
    if (skills.length > 0) parts.push(`with demonstrated experience in ${skills.join(", ")}`);
    const role = c.role || c.headline || "";
    if (role) parts.push(`currently working as ${role}`);
    if (c.experience) parts.push(`with ${c.experience}`);
    const pct = Math.round((c.relevance_score || 0) * 100);
    parts.push(`Matching ${pct}% of the job requirements.`);
    return parts.join(" ");
  }

  /* ---------- health ---------- */
  async function checkHealth() {
    try {
      const res = await fetch(`${settings.baseUrl}/health`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = await res.json();
        setStatus("ok", data.mode === "llm+heuristic" ? "API online (LLM)" : "API online");
      } else {
        setStatus("err", "API error");
      }
    } catch {
      setStatus("err", "API offline");
    }
  }

  /* ---------- send ---------- */
  async function send() {
    const text = input.value.trim();
    if (!text || busy) return;

    busy = true;
    sendBtn.disabled = true;
    lastJobDescription = text;

    resultsSection.classList.remove("hidden");
    candidatesList.classList.add("hidden");
    emptyState.classList.add("hidden");
    errorState.classList.add("hidden");
    skeletonList.classList.remove("hidden");
    resultsTitle.textContent = "Searching...";

    streamStatus.classList.remove("hidden");
    streamStatus.textContent = "Connecting to search service...";

    detailPanel.classList.remove("hidden");
    detailPlaceholder.classList.remove("hidden");
    detailContent.classList.add("hidden");
    selectedCandidateUrl = null;

    try {
      const res = await fetch(`${settings.baseUrl}/scraping-agent?stream=1`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(settings.apiKey ? { "X-API-Key": settings.apiKey } : {}),
        },
        body: JSON.stringify({ job_description: text, max_candidates: CONFIG.MAX_CANDIDATES }),
      });

      if (!res.ok) {
        let detail = `Request failed (${res.status})`;
        const body = await res.json().catch(() => ({}));
        if (body.detail) detail = body.detail;
        if (res.status === 401) detail = "401 Unauthorized — open Settings and add your API key.";
        if (res.status === 503) detail = "503 Upstream failure — the backend couldn't reach a search provider.";
        throw Object.assign(new Error(detail), { apiStatus: res.status });
      }

      if (!res.body) throw new Error("The API did not return a stream.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let result = null;

      const handleLine = (line) => {
        const msg = JSON.parse(line);
        if (msg.type === "status") {
          resultsTitle.textContent = msg.message || "Searching...";
          streamStatus.textContent = msg.message || "";
        } else if (msg.type === "result") {
          result = msg.data;
        } else if (msg.type === "error") {
          throw Object.assign(new Error(msg.detail || "API error"), { apiStatus: msg.status_code });
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          handleLine(line);
          if (result) break;
        }
        if (result) break;
      }

      if (!result && buf.trim()) {
        try { result = JSON.parse(buf.trim()); } catch { /* ignore */ }
      }

      skeletonList.classList.add("hidden");
      streamStatus.classList.add("hidden");

      if (result) {
        renderResults(result);
      } else {
        emptyState.classList.remove("hidden");
        resultsTitle.textContent = "No Candidates Found";
      }
    } catch (err) {
      skeletonList.classList.add("hidden");
      streamStatus.classList.add("hidden");
      errorState.classList.remove("hidden");
      errorDetail.textContent = err.message || "An unknown error occurred.";
      resultsTitle.textContent = "Search Failed";
    } finally {
      busy = false;
      sendBtn.disabled = false;
    }
  }

  /* ---------- filter controls ---------- */
  function syncFilters() {
    $$(".fpill[data-filter]", resultsSection).forEach((p) => {
      p.classList.toggle("active", p.dataset.filter === activeFilter);
    });
    $$(".fpill[data-sort]", resultsSection).forEach((p) => {
      p.classList.toggle("active", p.dataset.sort === activeSort);
    });
    thresholdSlider.value = threshold;
    thresholdVal.textContent = `${threshold}%`;
    sortSelect.value = activeSort;
  }

  /* results filter bar pills */
  $$(".fpill[data-filter]", resultsSection).forEach((pill) => {
    pill.addEventListener("click", () => {
      $$(".fpill[data-filter]", resultsSection).forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      activeFilter = pill.dataset.filter;
      applyFilterAndSort();
    });
  });

  thresholdSlider.addEventListener("input", (e) => {
    threshold = parseInt(e.target.value, 10);
    thresholdVal.textContent = `${threshold}%`;
    applyFilterAndSort();
  });

  sortSelect.addEventListener("change", (e) => {
    activeSort = e.target.value;
    applyFilterAndSort();
  });

  /* ---------- advanced filters modal ---------- */
  function openAdvFilterModal() {
    $$(".fpill", $("#adv-match-pills")).forEach((p) => {
      p.classList.toggle("active", p.dataset.filter === activeFilter);
    });
    $("#adv-threshold").value = threshold;
    $("#adv-threshold-val").textContent = `${threshold}%`;
    $$(".fpill", $("#adv-sort-pills")).forEach((p) => {
      p.classList.toggle("active", p.dataset.sort === activeSort);
    });
    advFilterModal.classList.remove("hidden");
  }

  $("#advanced-filters-btn").addEventListener("click", openAdvFilterModal);
  $("#adv-filter-modal .modal-backdrop").addEventListener("click", () => advFilterModal.classList.add("hidden"));

  $("#adv-filter-match-pills").addEventListener("click", (e) => {
    const pill = e.target.closest(".fpill");
    if (!pill) return;
    $$(".fpill", $("#adv-match-pills")).forEach((p) => p.classList.remove("active"));
    pill.classList.add("active");
  });
  $("#adv-filter-sort-pills").addEventListener("click", (e) => {
    const pill = e.target.closest(".fpill");
    if (!pill) return;
    $$(".fpill", $("#adv-sort-pills")).forEach((p) => p.classList.remove("active"));
    pill.classList.add("active");
  });
  $("#adv-threshold").addEventListener("input", (e) => {
    $("#adv-threshold-val").textContent = `${e.target.value}%`;
  });

  $("#adv-filter-apply").addEventListener("click", () => {
    const activePill = $(".fpill.active", $("#adv-match-pills"));
    activeFilter = activePill ? activePill.dataset.filter : "all";
    const activeSortPill = $(".fpill.active", $("#adv-sort-pills"));
    activeSort = activeSortPill ? activeSortPill.dataset.sort : "score";
    threshold = parseInt($("#adv-threshold").value, 10);
    syncFilters();
    applyFilterAndSort();
    advFilterModal.classList.add("hidden");
  });

  $("#adv-filter-reset").addEventListener("click", () => {
    activeFilter = "all";
    activeSort = "score";
    threshold = 0;
    syncFilters();
    applyFilterAndSort();
    advFilterModal.classList.add("hidden");
  });

  /* ---------- settings ---------- */
  function openSettings() {
    $("#settings-url").value = settings.baseUrl;
    $("#settings-key").value = settings.apiKey;
    settingsModal.classList.remove("hidden");
  }

  function saveSettings() {
    const url = $("#settings-url").value.trim().replace(/\/+$/, "");
    if (url) localStorage.setItem(LS_URL, url);
    const key = $("#settings-key").value.trim();
    localStorage.setItem(LS_KEY, key);
    settingsModal.classList.add("hidden");
    setStatus("", "checking\u2026");
    checkHealth();
  }

  /* ---------- new search ---------- */
  function newSearch() {
    resultsSection.classList.add("hidden");
    skeletonList.classList.add("hidden");
    emptyState.classList.add("hidden");
    errorState.classList.add("hidden");
    candidatesList.innerHTML = "";
    detailPlaceholder.classList.remove("hidden");
    detailContent.classList.add("hidden");
    detailPanel.classList.add("hidden");
    selectedCandidateUrl = null;
    streamStatus.classList.add("hidden");
    input.value = "";
    input.focus();
  }

  /* ---------- init ---------- */
  function init() {
    /* sidebar nav */
    $$(".nav-item", sidebar).forEach((item) => {
      item.addEventListener("click", () => {
        $$(".nav-item", sidebar).forEach((n) => n.classList.remove("active"));
        item.classList.add("active");
        const page = item.dataset.page;
        if (page === "search") {
          newSearch();
        } else if (page === "shortlisted") {
          showShortlisted();
        }
        if (window.innerWidth < 768) toggleSidebar();
      });
    });

    /* mobile settings */
    if (mobileSettingsBtn) mobileSettingsBtn.addEventListener("click", openSettings);

    /* search */
    sendBtn.addEventListener("click", send);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });

    /* new search */
    $("#new-search-btn").addEventListener("click", newSearch);
    $("#modify-search-btn").addEventListener("click", newSearch);
    $("#retry-btn").addEventListener("click", send);

    /* settings */
    $("#settings-btn")?.addEventListener("click", openSettings);
    $("#settings-save").addEventListener("click", saveSettings);
    $("#settings-cancel").addEventListener("click", () => settingsModal.classList.add("hidden"));
    settingsModal.querySelector(".modal-backdrop").addEventListener("click", () => settingsModal.classList.add("hidden"));

    /* back from detail on mobile */
    detailPanel.addEventListener("click", (e) => {
      if (e.target.classList.contains("detail-panel") && window.innerWidth < 768) {
        detailPanel.classList.remove("mobile-open");
      }
    });

    syncFilters();
    setStatus("", "checking\u2026");
    checkHealth();
  }

  function showShortlisted() {
    const items = allCandidates.filter((c) => shortlisted.has(c.url));
    if (items.length === 0) {
      resultsSection.classList.remove("hidden");
      candidatesList.innerHTML = "";
      emptyState.classList.remove("hidden");
      resultsTitle.textContent = "No Shortlisted Candidates";
      return;
    }
    resultsSection.classList.remove("hidden");
    emptyState.classList.add("hidden");
    errorState.classList.add("hidden");
    skeletonList.classList.add("hidden");
    resultsTitle.textContent = `${items.length} Shortlisted Candidate${items.length !== 1 ? "s" : ""}`;
    renderCards(items);
  }

  init();
})();
