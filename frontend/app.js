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
  const LS_SHORTLIST = "scraperagent.shortlist_v2";

  let busy = false;
  let allCandidates = [];
  let activeFilter = "all";
  let threshold = 0;
  let activeSort = "score";
  let lastJobDescription = "";
  let selectedCandidateUrl = null;
  let currentView = "search";

  /* --- persistent shortlisted candidates (url → full candidate object) --- */
  let shortlistedMap = new Map();
  (function loadShortlist() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_SHORTLIST) || "[]");
      if (Array.isArray(raw)) {
        if (raw.length > 0 && Array.isArray(raw[0])) {
          shortlistedMap = new Map(raw);
        } else if (raw.length > 0 && typeof raw[0] === "string") {
          raw.forEach((url) => shortlistedMap.set(url, { url }));
        }
      }
    } catch { shortlistedMap = new Map(); }
  })();

  const shortlistCountEl = $("#shortlist-count");

  function saveShortlist() {
    localStorage.setItem(LS_SHORTLIST, JSON.stringify([...shortlistedMap]));
    updateShortlistCount();
  }

  function updateShortlistCount() {
    const count = shortlistedMap.size;
    if (count > 0) {
      shortlistCountEl.textContent = count;
      shortlistCountEl.classList.remove("hidden");
    } else {
      shortlistCountEl.classList.add("hidden");
    }
  }

  /* --- search filters state --- */
  let searchFilterRole = "";
  let searchFilterExp = "";
  let searchFilterLoc = "";

  /* --- role normalization & synonym matching --- */
  const _ROLE_SYNONYMS = [
    ["engineer", "developer", "swe"],
    ["backend", "back-end", "back end", "server-side", "serverside", "backend engineer", "backend developer"],
    ["frontend", "front-end", "front end", "client-side", "clientside", "frontend engineer", "frontend developer", "ui engineer", "ui developer"],
    ["fullstack", "full-stack", "full stack", "full stack engineer", "full stack developer"],
    ["devops", "devops engineer", "infrastructure engineer", "platform engineer"],
    ["data engineer", "data scientist", "data analyst", "analytics engineer"],
    ["ml engineer", "machine learning engineer", "ai engineer", "artificial intelligence engineer"],
    ["software engineer", "software developer", "sde", "programmer"],
    ["mobile developer", "ios developer", "android developer", "mobile engineer"],
    ["tech lead", "technical lead", "engineering lead", "staff engineer", "principal engineer"],
    ["qa engineer", "test engineer", "quality engineer", "sDET", "automation engineer"],
    ["security engineer", "application security", "appsec"],
    ["cloud engineer", "infrastructure engineer", "site reliability engineer", "sre"],
    ["product manager", "product owner", "program manager"],
    ["ux designer", "ui designer", "product designer", "designer"],
    ["consultant", "advisor"],
    ["architect", "solution architect", "systems architect"],
  ];

  function _normalizeRole(text) {
    return (text || "")
      .toLowerCase()
      .replace(/[\s_]+/g, "-")
      .replace(/[^a-z0-9\-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function _roleMatchesFilter(candidateRoleText, filterText) {
    const cn = _normalizeRole(candidateRoleText);
    const fn = _normalizeRole(filterText);
    if (!fn) return true;
    if (!cn) return false;

    if (cn.includes(fn) || fn.includes(cn)) return true;

    for (const group of _ROLE_SYNONYMS) {
      const normGroup = group.map(_normalizeRole);
      const candInGroup = normGroup.some(s => cn.includes(s));
      const filterInGroup = normGroup.some(s => fn.includes(s));
      if (candInGroup && filterInGroup) {
        if (fn.includes("frontend") && !cn.includes("frontend") && cn.includes("backend")) return false;
        if (fn.includes("backend") && !cn.includes("backend") && cn.includes("frontend")) return false;
        return true;
      }
    }

    const filterWords = fn.split("-").filter(Boolean);
    const candWords = cn.split("-").filter(Boolean);
    const matchingWords = filterWords.filter(fw => candWords.some(cw => cw.includes(fw) || fw.includes(cw)));
    return matchingWords.length >= Math.ceil(filterWords.length * 0.6);
  }

  /* --- experience matching --- */
  function _parseExperienceYears(text) {
    if (!text) return null;
    const t = text.toLowerCase().replace(/\s+/g, " ").trim();

    const rangeMatch = t.match(/(\d+)\s*[-–]\s*(\d+)\s*(?:years?|yrs?)/);
    if (rangeMatch) {
      return { min: parseInt(rangeMatch[1], 10), max: parseInt(rangeMatch[2], 10) };
    }

    if (t.match(/fresher|entry\s*level|intern|0\s*(?:years?|yrs?)/)) {
      return { min: 0, max: 1 };
    }

    const yrsMatch = t.match(/(\d+)\+?\s*(?:years?|yrs?)/);
    if (yrsMatch) {
      const yrs = parseInt(yrsMatch[1], 10);
      if (t.includes("+")) return { min: yrs, max: 999 };
      return { min: yrs, max: yrs };
    }

    return null;
  }

  function _parseFilterExpRange(filterText) {
    const t = filterText.toLowerCase().replace(/\s+/g, " ").trim();
    if (t.match(/fresher|entry\s*level|intern|0\s*(?:years?|yrs?)/)) {
      return { min: 0, max: 2 };
    }

    const plusMatch = t.match(/^(\d+)\+\s*(?:years?|yrs?)?$/);
    if (plusMatch) return { min: parseInt(plusMatch[1], 10), max: 999 };

    const rangeMatch = t.match(/(\d+)\s*[-–to]+\s*(\d+)\s*(?:years?|yrs?)?/);
    if (rangeMatch) return { min: parseInt(rangeMatch[1], 10), max: parseInt(rangeMatch[2], 10) };

    const yrsMatch = t.match(/(\d+)\s*(?:years?|yrs?)/);
    if (yrsMatch) {
      const yrs = parseInt(yrsMatch[1], 10);
      return { min: yrs, max: yrs + 2 };
    }

    const numMatch = t.match(/(\d+)/);
    if (numMatch) {
      const n = parseInt(numMatch[1], 10);
      return { min: n, max: n + 2 };
    }

    return null;
  }

  function _experienceMatchesFilter(candidateExp, filterText) {
    if (!filterText) return true;
    const candRange = _parseExperienceYears(candidateExp);
    const filterRange = _parseFilterExpRange(filterText);
    if (!filterRange) return true;
    if (!candRange) return false;

    return candRange.max >= filterRange.min && candRange.min <= filterRange.max;
  }

  /* --- location normalization & alias matching --- */
  const _LOCATION_ALIASES = {
    "bangalore": "bengaluru", "bengaluru": "bengaluru", "bengalore": "bengaluru",
    "mumbai": "mumbai", "bombay": "mumbai",
    "chennai": "chennai", "madras": "chennai",
    "kolkata": "kolkata", "calcutta": "kolkata",
    "delhi": "delhi", "new delhi": "delhi", "noida": "delhi", "gurgaon": "delhi", "gurugram": "delhi", "faridabad": "delhi", "ghaziabad": "delhi",
    "hyderabad": "hyderabad", "secunderabad": "hyderabad",
    "pune": "pune", "poona": "pune",
    "jaipur": "jaipur", "ahmedabad": "ahmedabad", "ahmadabad": "ahmedabad",
    "indore": "indore", "chandigarh": "chandigarh", "lucknow": "lucknow",
    "coimbatore": "coimbatore", "kochi": "kochi", "cochin": "kochi",
    "agra": "agra", "patna": "patna", "bhopal": "bhopal",
    "visakhapatnam": "visakhapatnam", "vizag": "visakhapatnam",
    "usa": "usa", "united states": "usa", "us": "usa",
    "uk": "uk", "united kingdom": "uk", "england": "uk", "great britain": "uk",
    "canada": "canada", "germany": "germany", "france": "france",
    "australia": "australia", "singapore": "singapore",
    "dubai": "uae", "uae": "uae", "abu dhabi": "uae",
    "berlin": "germany", "munich": "germany", "frankfurt": "germany", "hamburg": "germany",
    "san francisco": "usa", "sf": "usa", "new york": "usa", "nyc": "usa",
    "seattle": "usa", "austin": "usa", "boston": "usa", "chicago": "usa", "los angeles": "usa", "la": "usa",
    "remote": "remote", "india": "india",
  };

  const _INDIAN_CITIES = new Set([
    "bengaluru", "mumbai", "chennai", "kolkata", "delhi", "noida", "gurgaon",
    "gurugram", "faridabad", "ghaziabad", "hyderabad", "secunderabad", "pune",
    "jaipur", "ahmedabad", "indore", "chandigarh", "lucknow", "coimbatore",
    "kochi", "agra", "patna", "bhopal", "visakhapatnam",
  ]);

  function _normalizeLocation(text) {
    return (text || "")
      .toLowerCase()
      .replace(/[,;|/\\]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function _locationAliasKey(text) {
    const norm = _normalizeLocation(text);
    for (const [alias, canonical] of Object.entries(_LOCATION_ALIASES)) {
      if (norm.includes(alias)) return canonical;
    }
    return null;
  }

  function _locationMatchesFilter(candidateLoc, filterText) {
    if (!filterText) return true;
    if (!candidateLoc) return false;

    const candNorm = _normalizeLocation(candidateLoc);
    const filterNorm = _normalizeLocation(filterText);
    if (!filterNorm) return true;
    if (!candNorm) return false;

    if (candNorm.includes(filterNorm) || filterNorm.includes(candNorm)) return true;

    const candKey = _locationAliasKey(candNorm);
    const filterKey = _locationAliasKey(filterNorm);

    if (candKey && filterKey) {
      if (candKey === filterKey) return true;
      if (filterKey === "india" && _INDIAN_CITIES.has(candKey)) return true;
      return false;
    }

    if (filterKey === "india" && _INDIAN_CITIES.has(candKey || "")) return true;
    if (candKey === "india" && _INDIAN_CITIES.has(filterKey || "")) return true;

    const filterWords = filterNorm.split(" ").filter(Boolean);
    const candWords = candNorm.split(" ").filter(Boolean);
    return filterWords.every(fw => candWords.some(cw => cw.includes(fw) || fw.includes(cw)));
  }

  function matchesSearchFilters(c) {
    if (searchFilterRole) {
      const roleText = [c.role, c.headline, (c.skills || []).join(" ")].filter(Boolean).join(" ");
      if (!_roleMatchesFilter(roleText, searchFilterRole)) return false;
    }
    if (searchFilterExp) {
      if (!_experienceMatchesFilter(c.experience, searchFilterExp)) return false;
    }
    if (searchFilterLoc) {
      if (!_locationMatchesFilter(c.location, searchFilterLoc)) return false;
    }
    return true;
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
    currentView = "search";
    allCandidates = data.candidates || [];
    lastJobDescription = input.value.trim() || lastJobDescription;
    activeFilter = "all";
    activeSort = "score";
    threshold = 0;
    syncFilters();
    applyFilterAndSort();
    searchSection.classList.add("hidden");
    resultsSection.classList.remove("hidden");
    detailPanel.classList.remove("hidden");
    detailPlaceholder.classList.remove("hidden");
    detailContent.classList.add("hidden");
    selectedCandidateUrl = null;
  }

  function applyFilterAndSort() {
    let pool;
    if (currentView === "shortlisted") {
      pool = [...shortlistedMap.values()];
    } else {
      pool = allCandidates.filter((c) => matchesSearchFilters(c));
    }

    let filtered = pool.filter((c) => {
      const score = c.relevance_score || 0;
      if (score * 100 < threshold) return false;
      if (activeFilter !== "all" && matchCategory(score) !== activeFilter) return false;
      return true;
    });

    if (activeSort === "name") {
      filtered.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }

    if (currentView === "shortlisted") {
      resultsTitle.textContent = `${filtered.length} Shortlisted Candidate${filtered.length !== 1 ? "s" : ""}`;
      emptyState.classList.toggle("hidden", filtered.length > 0);
      candidatesList.classList.toggle("hidden", filtered.length === 0);
    } else {
      $("#results-stats").classList.remove("hidden");
      renderStats(filtered);
    }
    renderCards(filtered);
  }

  function renderStats(pool) {
    const counts = { strong: 0, good: 0, review: 0 };
    (pool || allCandidates).forEach((c) => {
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
    const isShortlisted = shortlistedMap.has(c.url);

    const aboutBtn = el("button", `btn-sm btn-about${isSelected ? " active" : ""}`, "About");
    aboutBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      selectCandidate(c, index);
    });
    actions.appendChild(aboutBtn);

    const shortBtn = el("button", `btn-sm${isShortlisted ? " shortlisted" : ""}`, isShortlisted ? "Shortlisted" : "Shortlist");
    shortBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (shortlistedMap.has(c.url)) {
        shortlistedMap.delete(c.url);
        shortBtn.className = "btn-sm";
        shortBtn.textContent = "Shortlist";
      } else {
        shortlistedMap.set(c.url, { ...c });
        shortBtn.className = "btn-sm shortlisted";
        shortBtn.textContent = "Shortlisted";
      }
      saveShortlist();
      renderCards(currentViewCandidates());
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
    const isShortlisted = shortlistedMap.has(c.url);

    let html = `
      <button class="detail-back-btn" id="detail-back-btn" style="display:none">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back
      </button>
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
            ${c.source ? `<tr><td>Source</td><td>${escapeHtml(SOURCES[c.source]?.name || c.source)}</td></tr>` : ""}
            ${c.source && c.url ? `<tr><td>Profile</td><td>${sourceBadgeHtml(c.source, c.url)}</td></tr>` : ""}
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

    /* back button on mobile */
    const backBtn = detailContent.querySelector("#detail-back-btn");
    if (backBtn && window.innerWidth < 768) {
      backBtn.style.display = "inline-flex";
      backBtn.addEventListener("click", () => {
        detailPanel.classList.remove("mobile-open");
      });
    }

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
        if (shortlistedMap.has(url)) {
          shortlistedMap.delete(url);
          detailShortBtn.classList.remove("shortlisted");
          detailShortBtn.textContent = "Shortlist";
        } else {
          const cand = allCandidates.find((c) => c.url === url) || [...shortlistedMap.values()].find((c) => c.url === url) || { url };
          shortlistedMap.set(url, { ...cand });
          detailShortBtn.classList.add("shortlisted");
          detailShortBtn.textContent = "Shortlisted";
        }
        saveShortlist();
        if (currentView === "shortlisted") {
          showShortlisted();
        } else {
          applyFilterAndSort();
        }
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
      const res = await fetch(`${settings.baseUrl}/health`, { signal: AbortSignal.timeout(15000) });
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

    searchFilterRole = ($("#filter-role") || {}).value.trim().toLowerCase();
    searchFilterExp = ($("#filter-experience") || {}).value.trim().toLowerCase();
    searchFilterLoc = ($("#filter-location") || {}).value.trim().toLowerCase();

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
        signal: AbortSignal.timeout(120000),
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

  /* results filter bar pills — event delegation */
  resultsSection.addEventListener("click", (e) => {
    const pill = e.target.closest(".fpill[data-filter]");
    if (!pill) return;
    $$(".fpill[data-filter]", resultsSection).forEach((p) => p.classList.remove("active"));
    pill.classList.add("active");
    activeFilter = pill.dataset.filter;
    applyFilterAndSort();
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

  $("#adv-filter-modal .modal-backdrop").addEventListener("click", () => advFilterModal.classList.add("hidden"));

  $("#adv-match-pills").addEventListener("click", (e) => {
    const pill = e.target.closest(".fpill");
    if (!pill) return;
    $$(".fpill", $("#adv-match-pills")).forEach((p) => p.classList.remove("active"));
    pill.classList.add("active");
  });
  $("#adv-sort-pills").addEventListener("click", (e) => {
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
    searchFilterRole = ($("#filter-role") || {}).value.trim().toLowerCase();
    searchFilterExp = ($("#filter-experience") || {}).value.trim().toLowerCase();
    searchFilterLoc = ($("#filter-location") || {}).value.trim().toLowerCase();
    syncFilters();
    applyFilterAndSort();
    advFilterModal.classList.add("hidden");
  });

  $("#adv-filter-reset").addEventListener("click", () => {
    activeFilter = "all";
    activeSort = "score";
    threshold = 0;
    searchFilterRole = "";
    searchFilterExp = "";
    searchFilterLoc = "";
    ($("#filter-role") || {}).value = "";
    ($("#filter-experience") || {}).value = "";
    ($("#filter-location") || {}).value = "";
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
    currentView = "search";
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
    searchSection.classList.remove("hidden");
    $("#results-stats").classList.remove("hidden");
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
        } else if (page === "settings") {
          openSettings();
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
    $("#new-search-btn").addEventListener("click", () => { input.value = ""; newSearch(); });
    $("#modify-search-btn").addEventListener("click", newSearch);
    $("#retry-btn").addEventListener("click", send);

    /* settings */
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
    updateShortlistCount();
    setStatus("", "checking\u2026");
    checkHealth();
  }

  function showShortlisted() {
    currentView = "shortlisted";
    searchFilterRole = "";
    searchFilterExp = "";
    searchFilterLoc = "";
    const items = [...shortlistedMap.values()];
    searchSection.classList.add("hidden");
    resultsSection.classList.remove("hidden");
    detailPanel.classList.remove("hidden");
    detailPlaceholder.classList.remove("hidden");
    detailContent.classList.add("hidden");
    selectedCandidateUrl = null;
    errorState.classList.add("hidden");
    skeletonList.classList.add("hidden");
    $("#results-stats").classList.add("hidden");
    if (items.length === 0) {
      candidatesList.innerHTML = "";
      emptyState.classList.remove("hidden");
      candidatesList.classList.add("hidden");
      resultsTitle.textContent = "No Shortlisted Candidates";
      return;
    }
    emptyState.classList.add("hidden");
    resultsTitle.textContent = `${items.length} Shortlisted Candidate${items.length !== 1 ? "s" : ""}`;
    const groups = {};
    items.forEach((c) => {
      const role = c.role || c.headline || "Other";
      if (!groups[role]) groups[role] = [];
      groups[role].push(c);
    });
    candidatesList.innerHTML = "";
    candidatesList.classList.remove("hidden");
    Object.keys(groups).sort().forEach((role) => {
      const count = groups[role].length;
      const header = el("div", "role-group-header");
      header.innerHTML = `<span class="role-group-name">${escapeHtml(role)}</span><span class="role-group-count">${count} candidate${count !== 1 ? "s" : ""}</span>`;
      candidatesList.appendChild(header);
      groups[role].forEach((c, i) => {
        candidatesList.appendChild(candidateCard(c, i));
      });
    });
  }

  function currentViewCandidates() {
    let pool = currentView === "shortlisted"
      ? [...shortlistedMap.values()]
      : allCandidates.filter((c) => matchesSearchFilters(c));
    let filtered = pool.filter((c) => {
      const score = c.relevance_score || 0;
      if (score * 100 < threshold) return false;
      if (activeFilter !== "all" && matchCategory(score) !== activeFilter) return false;
      return true;
    });
    if (activeSort === "name") {
      filtered.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }
    return filtered;
  }

  init();
})();
