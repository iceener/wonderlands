// Garden client-side script payloads (search, client navigation, page enhancements).
// Kept verbatim to preserve exact emitted bytes for renderGardenPage().

export const GARDEN_SEARCH_SCRIPT = String.raw`
(() => {
  const root = document.querySelector('[data-garden-search-root]');

  if (!root) {
    return;
  }

  const input = root.querySelector('[data-garden-search-input]');
  const status = root.querySelector('[data-garden-search-status]');
  const results = root.querySelector('[data-garden-search-results]');
  const filtersEl = root.querySelector('[data-garden-search-filters]');
  const kbdEl = root.querySelector('[data-garden-search-kbd]');
  const searchConfigEl = document.querySelector('[data-garden-search-config]');

  if (!(input instanceof HTMLInputElement) || !(status instanceof HTMLElement) || !(results instanceof HTMLElement)) {
    return;
  }

  const body = document.body;
  const routePath = body.dataset.gardenRoutePath || '/';
  const visibility = body.dataset.gardenVisibility || 'public';
  let searchConfig = {};

  if (searchConfigEl instanceof HTMLScriptElement) {
    try {
      searchConfig = JSON.parse(searchConfigEl.textContent || '{}');
    } catch (_) {}
  }

  const hasProtectedSearch = searchConfig.hasProtectedSearch === true;
  const protectedSearchState = searchConfig.protectedSearchState === 'available'
    ? 'available'
    : 'locked';
  const sectionLabels = typeof searchConfig.sectionLabels === 'object' && searchConfig.sectionLabels
    ? searchConfig.sectionLabels
    : {};

  const normalizePathname = (value) => {
    const trimmed = (value || '/').trim();
    if (!trimmed || trimmed === '/') {
      return '/';
    }

    return trimmed.replace(/\/+$/, '') || '/';
  };

  const toMountedPath = (mountBasePath, routePathValue) => {
    if (mountBasePath === '/' || !mountBasePath) {
      return routePathValue;
    }

    return routePathValue === '/'
      ? mountBasePath
      : mountBasePath + routePathValue;
  };

  const computeMountBasePath = (pathname, routePathValue) => {
    const normalizedPathname = normalizePathname(pathname);

    if (routePathValue === '/') {
      return normalizedPathname;
    }

    if (normalizedPathname === routePathValue) {
      return '/';
    }

    if (normalizedPathname.endsWith(routePathValue)) {
      const mountBase = normalizedPathname.slice(0, normalizedPathname.length - routePathValue.length);
      return mountBase || '/';
    }

    return '/';
  };

  const mountBasePath = computeMountBasePath(window.location.pathname, routePath);
  const baseUrl = mountBasePath === '/' ? '/' : mountBasePath + '/';
  const publicBundlePath = toMountedPath(mountBasePath, '/_pagefind/public/');
  const protectedBundlePath = toMountedPath(mountBasePath, '/_pagefind/protected/');

  const normalizeSearchResultHref = (value) => {
    if (typeof value !== 'string') {
      return '#';
    }

    const trimmed = value.trim();

    if (!trimmed) {
      return '#';
    }

    try {
      const resolved = new URL(trimmed, new URL(baseUrl, window.location.origin));

      if (resolved.origin !== window.location.origin) {
        return trimmed;
      }

      if (resolved.pathname === '/index.html') {
        resolved.pathname = '/';
      } else if (resolved.pathname.endsWith('/index.html')) {
        resolved.pathname = resolved.pathname.slice(0, -'/index.html'.length) || '/';
      } else if (resolved.pathname.endsWith('.html')) {
        resolved.pathname = resolved.pathname.slice(0, -'.html'.length) || '/';
      }

      return normalizePathname(resolved.pathname) + resolved.search + resolved.hash;
    } catch {
      return trimmed;
    }
  };

  const escapeHtml = (value) =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');

  const isTextInputTarget = (target) =>
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable);

  /* --- Result rendering --- */

  const renderResult = (result, index) => {
    const subResults = (Array.isArray(result.sub_results) ? result.sub_results : [])
      .filter((subResult) => subResult && subResult.url && subResult.url !== result.url)
      .slice(0, 3)
      .map((subResult) => {
        const title = escapeHtml(subResult.title || 'Section');
        const excerpt = subResult.excerpt || '';
        const href = normalizeSearchResultHref(subResult.url);

        return '<a class="garden-search-subresult" href="' + escapeHtml(href) + '">' +
          '<span class="garden-search-result-title">' + title + '</span>' +
          (excerpt ? '<span class="garden-search-result-excerpt">' + excerpt + '</span>' : '') +
          '</a>';
      })
      .join('');

    const href = normalizeSearchResultHref(result.url);

    return '<a class="garden-search-result" href="' + escapeHtml(href) + '" role="option" data-search-index="' + index + '">' +
      '<span class="garden-search-result-title">' + escapeHtml(result.meta?.title || href || 'Untitled') + '</span>' +
      (result.excerpt ? '<span class="garden-search-result-excerpt">' + result.excerpt + '</span>' : '') +
      (subResults ? '<div class="garden-search-subresults">' + subResults + '</div>' : '') +
      '</a>';
  };

  /* --- Keyboard navigation --- */

  let activeIndex = -1;
  let searchRequestId = 0;

  const getResultLinks = () => results.querySelectorAll('.garden-search-result');

  const setActiveResult = (index) => {
    const links = getResultLinks();
    if (links.length === 0) {
      activeIndex = -1;
      return;
    }

    links.forEach((link) => link.classList.remove('is-active'));
    activeIndex = Math.max(-1, Math.min(index, links.length - 1));

    if (activeIndex >= 0 && links[activeIndex]) {
      links[activeIndex].classList.add('is-active');
      links[activeIndex].scrollIntoView({ block: 'nearest' });
    }
  };

  /* --- Filters --- */

  const MAX_VISIBLE_TAG_FILTERS = 6;
  const MAX_VISIBLE_SECTION_FILTERS = 4;
  let activeFilters = {};
  let searchMode = 'relevance';

  const toSectionLabel = (value) => sectionLabels[value] || value;

  const incrementFilterCount = (counts, value) => {
    if (!value) {
      return;
    }

    counts.set(value, (counts.get(value) || 0) + 1);
  };

  const splitTagMeta = (value) => {
    if (typeof value !== 'string') {
      return [];
    }

    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  };

  const getResultTags = (result) => {
    const filterTags = result?.filters?.tag;

    if (Array.isArray(filterTags) && filterTags.length > 0) {
      return filterTags.filter(Boolean);
    }

    if (typeof filterTags === 'string' && filterTags.trim()) {
      return [filterTags.trim()];
    }

    return splitTagMeta(result?.meta?.tags);
  };

  const getResultSection = (result) => {
    const filterSection = result?.filters?.section;

    if (Array.isArray(filterSection) && filterSection.length > 0) {
      return filterSection.find(Boolean) || null;
    }

    if (typeof filterSection === 'string' && filterSection.trim()) {
      return filterSection.trim();
    }

    if (typeof result?.meta?.section === 'string' && result.meta.section.trim()) {
      return result.meta.section.trim();
    }

    return null;
  };

  const sortFilterEntries = (entries) =>
    entries.sort((left, right) =>
      right.count - left.count ||
      left.label.localeCompare(right.label, undefined, {
        sensitivity: 'base',
      }),
    );

  const pinActiveEntry = (entries, activeValue, maxVisible) => {
    if (!activeValue) {
      return entries.slice(0, maxVisible);
    }

    const limited = entries.slice(0, maxVisible);

    if (limited.some((entry) => entry.value === activeValue)) {
      return limited;
    }

    const activeEntry = entries.find((entry) => entry.value === activeValue);

    if (!activeEntry) {
      return limited;
    }

    return [activeEntry, ...limited.slice(0, Math.max(0, maxVisible - 1))];
  };

  const buildFilterEntries = (resultsForFilters) => {
    if (!Array.isArray(resultsForFilters) || resultsForFilters.length === 0) {
      return [];
    }

    const tagCounts = new Map();
    const sectionCounts = new Map();

    for (const result of resultsForFilters) {
      for (const tag of getResultTags(result)) {
        incrementFilterCount(tagCounts, tag);
      }

      incrementFilterCount(sectionCounts, getResultSection(result));
    }

    const tagEntries = sortFilterEntries(
      [...tagCounts.entries()].map(([value, count]) => ({
        count,
        key: 'tag',
        label: value,
        value,
      })),
    );
    const sectionEntries = sortFilterEntries(
      [...sectionCounts.entries()].map(([value, count]) => ({
        count,
        key: 'section',
        label: toSectionLabel(value),
        value,
      })),
    );

    return [
      ...pinActiveEntry(tagEntries, activeFilters['tag'], MAX_VISIBLE_TAG_FILTERS),
      ...pinActiveEntry(sectionEntries, activeFilters['section'], MAX_VISIBLE_SECTION_FILTERS),
    ];
  };

  const renderFilters = (resultsForFilters) => {
    if (!filtersEl) {
      return;
    }

    const chips = buildFilterEntries(resultsForFilters).map((entry) => {
      const isActive = activeFilters[entry.key] === entry.value;
      const activeClass = isActive ? ' is-active' : '';

      return '<button class="garden-search-filter' + activeClass + '" data-filter-key="' + entry.key + '" data-filter-value="' + escapeHtml(entry.value) + '" type="button">' +
        '<span>' + escapeHtml(entry.label) + '</span>' +
        '<span class="garden-search-filter-count">' + escapeHtml(String(entry.count)) + '</span>' +
        '</button>';
    });

    if (chips.length === 0) {
      filtersEl.hidden = true;
      filtersEl.innerHTML = '';
      return;
    }

    filtersEl.hidden = false;
    filtersEl.innerHTML = chips.join('');
  };

  if (filtersEl) {
    filtersEl.addEventListener('click', (event) => {
      const button = event.target.closest('[data-filter-key]');
      if (!button) return;

      const key = button.dataset.filterKey;
      const value = button.dataset.filterValue;

      if (activeFilters[key] === value) {
        delete activeFilters[key];
      } else {
        activeFilters[key] = value;
      }

      void runSearch(input.value);
    });
  }

  /* --- Pagefind lifecycle --- */

  let pagefindModule = null;
  let initPromise = null;
  let protectedMergePromise = null;
  let protectedMerged = false;
  const canLoadProtectedSearch = hasProtectedSearch && protectedSearchState === 'available';

  const ensurePagefind = async () => {
    if (!pagefindModule) {
      pagefindModule = await import(publicBundlePath + 'pagefind.js');
      await pagefindModule.options({
        baseUrl,
        bundlePath: publicBundlePath,
        excerptLength: 18,
        highlightParam: 'highlight',
        ranking: {
          metaWeights: {
            title: 5.0,
            description: 2.0,
            excerpt: 2.0,
          },
        },
      });
    }

    if (!initPromise) {
      initPromise = pagefindModule.init();
    }

    await initPromise;
    return pagefindModule;
  };

  const maybeMergeProtectedIndex = async (blocking) => {
    if (!canLoadProtectedSearch || protectedMerged) {
      return;
    }

    const pagefind = await ensurePagefind();

    if (!protectedMergePromise) {
      protectedMergePromise = pagefind
        .mergeIndex(protectedBundlePath, {
          mergeFilter: {
            visibility: 'protected',
          },
        })
        .then(() => {
          protectedMerged = true;
        })
        .catch(() => null)
        .finally(() => {
          protectedMergePromise = null;
        });
    }

    if (blocking) {
      await protectedMergePromise;
    }
  };

  /* --- Search execution --- */

  const clearResults = () => {
    results.hidden = true;
    results.innerHTML = '';
    status.hidden = true;
    status.textContent = '';
    activeIndex = -1;
    if (filtersEl) {
      filtersEl.hidden = true;
      filtersEl.innerHTML = '';
    }
  };

  const buildFilterParam = () => {
    const param = {};
    for (const [key, value] of Object.entries(activeFilters)) {
      param[key] = value;
    }
    return Object.keys(param).length > 0 ? { filters: param } : {};
  };

  const runSearch = async (query) => {
    const term = query.trim();

    if (!term) {
      searchRequestId += 1;
      clearResults();
      return;
    }

    const requestId = ++searchRequestId;

    status.hidden = false;
    status.textContent = 'Searching\u2026';
    results.hidden = false;

    try {
      const pagefind = await ensurePagefind();

      if (visibility === 'protected' || canLoadProtectedSearch) {
        await maybeMergeProtectedIndex(true);
      }

      const searchOptions = buildFilterParam();
      if (searchMode !== 'relevance') {
        searchOptions.sort = searchMode;
      }
      const search = await pagefind.debouncedSearch(term, searchOptions, 180);

      if (search === null) {
        return;
      }

      if (requestId !== searchRequestId) {
        return;
      }

      const loadedResults = await Promise.all(
        search.results.map((result) => result.data()),
      );

      if (requestId !== searchRequestId) {
        return;
      }

      if (loadedResults.length === 0) {
        status.hidden = true;
        if (filtersEl) {
          filtersEl.hidden = true;
          filtersEl.innerHTML = '';
        }
        results.innerHTML = '<p class="garden-search-empty">No results found.</p>';
        activeIndex = -1;
        return;
      }

      const total = search.results.length;
      const shownResults = loadedResults.slice(0, 8);
      const shown = shownResults.length;
      status.hidden = false;
      status.textContent = total <= shown
        ? (total === 1 ? '1 result' : total + ' results')
        : shown + ' of ' + total + ' results';

      results.innerHTML = shownResults.map(renderResult).join('');
      activeIndex = -1;
      renderFilters(loadedResults);
    } catch (error) {
      if (requestId !== searchRequestId) {
        return;
      }
      status.hidden = false;
      status.textContent = '';
      results.innerHTML = '<p class="garden-search-error">Search unavailable. Try again later.</p>';
      console.error('Garden search failed', error);
    }
  };

  /* --- Idle preload --- */

  const idlePreload = () => { void ensurePagefind(); };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(idlePreload);
  } else {
    setTimeout(idlePreload, 1200);
  }

  /* --- Event listeners --- */

  input.addEventListener('focus', () => {
    void ensurePagefind();

    if (canLoadProtectedSearch && visibility === 'protected') {
      void maybeMergeProtectedIndex(false);
    }
  });

  input.addEventListener('input', () => {
    void runSearch(input.value);
  });

  input.addEventListener('keydown', (event) => {
    const links = getResultLinks();
    if (links.length === 0 && event.key !== 'Escape') {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveResult(activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveResult(activeIndex <= 0 ? -1 : activeIndex - 1);
    } else if (event.key === 'Enter' && activeIndex >= 0 && links[activeIndex]) {
      event.preventDefault();
      links[activeIndex].click();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (input.value) {
        input.value = '';
        clearResults();
      } else {
        input.blur();
      }
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) {
      return;
    }

    if (event.key !== '/' || isTextInputTarget(event.target)) {
      return;
    }

    event.preventDefault();
    input.focus();
    input.select();
  });

  document.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Node) || !root.contains(event.target)) {
      clearResults();
    }
  });

  document.addEventListener('garden:content-swap', () => {
    input.value = '';
    clearResults();
    if (document.activeElement === input) {
      input.blur();
    }
  });
})();
`

export const GARDEN_NAV_SCRIPT = String.raw`
(() => {
  const content = document.querySelector('.garden-content');
  const navLinks = document.querySelector('.nav-links');
  if (!content) return;

  /* --- Prefetch on hover --- */
  const prefetched = new Set();
  const prefetch = (href) => {
    if (prefetched.has(href)) return;
    prefetched.add(href);
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = href;
    document.head.appendChild(link);
  };
  const onPointer = (e) => {
    const a = e.target.closest('a[data-garden-link="internal"]');
    if (a && a.href) prefetch(a.href);
  };
  document.addEventListener('mouseenter', onPointer, { capture: true, passive: true });
  document.addEventListener('touchstart', onPointer, { capture: true, passive: true });

  /* --- Client-side navigation --- */
  if (!history.pushState) return;

  const parser = new DOMParser();
  const pageCache = new Map();
  const scrollMap = new Map();
  let controller = null;

  const saveScroll = () => {
    scrollMap.set(location.href, { x: scrollX, y: scrollY });
  };

  const swap = (doc) => {
    const nc = doc.querySelector('.garden-content');
    if (!nc) return false;

    content.innerHTML = nc.innerHTML;
    document.title = doc.title || '';

    const ns = doc.querySelector('.nav-links');
    if (ns && navLinks) navLinks.innerHTML = ns.innerHTML;

    const nb = doc.body;
    if (nb) {
      document.body.dataset.gardenRoutePath = nb.dataset.gardenRoutePath || '/';
      document.body.dataset.gardenVisibility = nb.dataset.gardenVisibility || 'public';
    }
    return true;
  };

  const focusContent = () => {
    const heading = content.querySelector('h1');
    if (!heading) return;
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  };

  const navigate = async (url, push) => {
    if (controller) controller.abort();
    controller = new AbortController();
    const signal = controller.signal;

    saveScroll();

    try {
      let doc = pageCache.get(url);

      if (!doc) {
        const res = await fetch(url, { credentials: 'same-origin', signal });
        if (!res.ok) { location.href = url; return; }
        doc = parser.parseFromString(await res.text(), 'text/html');
        pageCache.set(url, doc);
        if (pageCache.size > 30) {
          pageCache.delete(pageCache.keys().next().value);
        }
      }

      if (signal.aborted) return;

      const doSwap = () => {
        if (!swap(doc)) { location.href = url; return; }
        if (push) history.pushState({}, '', url);
        document.dispatchEvent(new CustomEvent('garden:content-swap'));

        const hash = new URL(url, location.origin).hash;
        if (hash) {
          const el = document.getElementById(hash.slice(1));
          if (el) { el.scrollIntoView(); return; }
        }

        if (!push) {
          const saved = scrollMap.get(url);
          if (saved) { scrollTo(saved.x, saved.y); }
          else { scrollTo(0, 0); }
        } else {
          scrollTo(0, 0);
        }

        focusContent();
      };

      if (document.startViewTransition) {
        document.startViewTransition(doSwap);
      } else {
        doSwap();
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      location.href = url;
    } finally {
      controller = null;
    }
  };

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[data-garden-link="internal"]');
    if (!a || !a.href) return;

    const url = new URL(a.href, location.origin);
    if (url.origin !== location.origin) return;

    if (url.pathname === location.pathname && url.hash) {
      e.preventDefault();
      const el = document.getElementById(url.hash.slice(1));
      if (el) el.scrollIntoView({ behavior: 'smooth' });
      history.pushState({}, '', url.href);
      return;
    }

    e.preventDefault();
    navigate(url.href, true);
  });

  window.addEventListener('popstate', () => navigate(location.href, false));
})();
`

export const GARDEN_ENHANCEMENTS_SCRIPT = String.raw`
(() => {
  if (typeof window === 'undefined') return;
  const root = document.documentElement;
  const docReady = (fn) => {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  };

  const initLightbox = () => {
    if (document.querySelector('.lightbox')) return;
    const lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-hidden', 'true');
    lb.innerHTML = '<button class="lightbox-close" type="button" aria-label="Close (Esc)">×</button><figure class="lightbox-figure"><img class="lightbox-image" alt=""><figcaption class="lightbox-caption" hidden></figcaption></figure>';
    document.body.appendChild(lb);
    const img = lb.querySelector('.lightbox-image');
    const caption = lb.querySelector('.lightbox-caption');
    const close = () => { lb.classList.remove('open'); lb.setAttribute('aria-hidden', 'true'); document.body.classList.remove('no-scroll'); };
    const open = (src, alt) => {
      img.src = src;
      img.alt = alt || '';
      if (alt) { caption.textContent = alt; caption.hidden = false; } else { caption.hidden = true; }
      lb.classList.add('open');
      lb.setAttribute('aria-hidden', 'false');
      document.body.classList.add('no-scroll');
    };
    lb.addEventListener('click', (e) => { if (e.target === lb || e.target.closest('.lightbox-close')) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && lb.classList.contains('open')) close(); });
    document.addEventListener('click', (e) => {
      const el = e.target.closest('main img');
      if (!el || el.closest('a[href]') || el.classList.contains('no-lightbox')) return;
      const inlineMax = (el.getAttribute('style') || '').match(/max-width:\s*(\d+)px/i);
      if (inlineMax && Number(inlineMax[1]) <= 140) return;
      e.preventDefault();
      open(el.currentSrc || el.src, el.alt);
    });
  };

  const initResizable = () => {
    if (document.querySelector('.col-handle')) return;
    const STORAGE_KEY = 'overment.contentWidth';
    const MIN_REM = 36;
    const MAX_REM = 68;
    const fontPx = () => parseFloat(getComputedStyle(root).fontSize) || 16;
    const apply = (rem) => {
      const clamped = Math.max(MIN_REM, Math.min(MAX_REM, rem));
      root.style.setProperty('--content-width', clamped.toFixed(2) + 'rem');
      return clamped;
    };
    const save = (rem) => { try { localStorage.setItem(STORAGE_KEY, rem.toFixed(2)); } catch {} };
    let stored;
    try { stored = parseFloat(localStorage.getItem(STORAGE_KEY) || ''); } catch {}
    if (Number.isFinite(stored)) apply(stored);
    const makeHandle = (side) => {
      const h = document.createElement('button');
      h.type = 'button';
      h.className = 'col-handle col-handle-' + side;
      h.setAttribute('aria-label', 'Resize content column (use ← and →)');
      h.setAttribute('aria-orientation', 'vertical');
      const grip = document.createElement('span');
      grip.className = 'col-handle-grip';
      grip.setAttribute('aria-hidden', 'true');
      h.appendChild(grip);
      return h;
    };
    const left = makeHandle('left');
    const right = makeHandle('right');
    document.body.append(left, right);
    const main = document.querySelector('main');
    if (!main) return;
    const positionHandles = () => {
      const rect = main.getBoundingClientRect();
      left.style.left = Math.round(rect.left) + 'px';
      right.style.left = Math.round(rect.right) + 'px';
    };
    positionHandles();
    window.addEventListener('resize', positionHandles);
    document.addEventListener('visibilitychange', positionHandles);
    let dragging = null;
    const onMove = (e) => {
      if (!dragging) return;
      const centerX = window.innerWidth / 2;
      const widthPx = dragging === 'right' ? (e.clientX - centerX) * 2 : (centerX - e.clientX) * 2;
      if (widthPx <= 0) return;
      apply(widthPx / fontPx());
      positionHandles();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = null;
      document.body.classList.remove('col-resizing');
      const cur = parseFloat(getComputedStyle(root).getPropertyValue('--content-width')) || 38;
      save(cur);
    };
    const startDrag = (side) => (e) => { e.preventDefault(); dragging = side; document.body.classList.add('col-resizing'); };
    left.addEventListener('pointerdown', startDrag('left'));
    right.addEventListener('pointerdown', startDrag('right'));
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    const nudge = (delta) => {
      const cur = parseFloat(getComputedStyle(root).getPropertyValue('--content-width')) || 38;
      const next = apply(cur + delta);
      positionHandles();
      save(next);
    };
    [left, right].forEach((h) => h.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(1); }
      else if (e.key === 'Home') { e.preventDefault(); apply(MIN_REM); positionHandles(); save(MIN_REM); }
      else if (e.key === 'End') { e.preventDefault(); apply(MAX_REM); positionHandles(); save(MAX_REM); }
    }));
  };

  const initNewsletterForms = () => {
    const DEFAULT_ENDPOINT = 'https://alice.overment.com/api/newsletter/subscribe';
    const ENDPOINT = window.OVERMENT_ENV?.NEWSLETTER_ENDPOINT || DEFAULT_ENDPOINT;
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isValidEmail = (value) => EMAIL_RE.test(value.trim().toLowerCase());
    const setSubmitState = (formRoot) => {
      const input = formRoot.querySelector('[data-newsletter-email]');
      const button = formRoot.querySelector('[data-newsletter-submit]');
      const loading = formRoot.dataset.status === 'loading';
      if (button) { button.disabled = loading || !input || !isValidEmail(input.value); button.textContent = loading ? 'Sending…' : "I'm in"; }
    };
    const setValidation = (formRoot, show) => {
      const input = formRoot.querySelector('[data-newsletter-email]');
      const validation = formRoot.querySelector('[data-newsletter-validation]');
      if (input) { input.classList.toggle('is-invalid', show); input.setAttribute('aria-invalid', show ? 'true' : 'false'); }
      if (validation) validation.hidden = !show;
    };
    const setNotice = (formRoot, status, message) => {
      const notice = formRoot.querySelector('[data-newsletter-notice]');
      formRoot.dataset.status = status;
      if (!notice) return;
      notice.textContent = message || '';
      notice.hidden = !message;
    };
    document.querySelectorAll('[data-newsletter-form]').forEach((formRoot) => {
      if (formRoot.dataset.newsletterBound === '1') return;
      formRoot.dataset.newsletterBound = '1';
      const form = formRoot.querySelector('form');
      const input = formRoot.querySelector('[data-newsletter-email]');
      if (!form || !input) return;
      let touched = false;
      setSubmitState(formRoot);
      input.addEventListener('input', () => { const value = input.value.trim(); if (touched) setValidation(formRoot, value.length > 0 && !isValidEmail(value)); if (formRoot.dataset.status === 'error') setNotice(formRoot, 'idle', ''); setSubmitState(formRoot); });
      input.addEventListener('blur', () => { touched = true; const value = input.value.trim(); setValidation(formRoot, value.length > 0 && !isValidEmail(value)); setSubmitState(formRoot); });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        touched = true;
        const email = input.value.trim().toLowerCase();
        if (!isValidEmail(email)) { setValidation(formRoot, true); setNotice(formRoot, 'idle', ''); input.focus(); return; }
        setValidation(formRoot, false); setNotice(formRoot, 'idle', ''); formRoot.dataset.status = 'loading'; input.disabled = true; setSubmitState(formRoot);
        try {
          const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
          const data = (response.headers.get('content-type') || '').includes('application/json') ? await response.json() : {};
          const status = data.status || (response.ok ? 'success' : 'error');
          if (status === 'success') { input.value = ''; touched = false; setNotice(formRoot, 'success', data.message || 'Got it. Talk soon.'); }
          else if (status === 'exists') setNotice(formRoot, 'exists', data.message || "You're already on the list.");
          else setNotice(formRoot, 'error', data.message || "Hmm, that didn't work. Try again?");
        } catch { setNotice(formRoot, 'error', "Hmm, something's off. Mind trying again?"); }
        finally { input.disabled = false; if (formRoot.dataset.status === 'loading') formRoot.dataset.status = 'idle'; setSubmitState(formRoot); }
      });
    });
  };

  docReady(() => { initLightbox(); initResizable(); initNewsletterForms(); });
  document.addEventListener('garden:content-swap', () => setTimeout(initNewsletterForms, 0));
  document.addEventListener('click', () => setTimeout(initNewsletterForms, 0));
})();
`
