const home = new URL('./', import.meta.url);
const scanner = new URL('picture-scan/', home);
const key = 'toolbox-navigation-v1';
const stateKey = 'toolboxEntry';
const toolbar = document.querySelector('.toolbox-nav');
const back = toolbar.querySelector('[data-history="back"]');
const forward = toolbar.querySelector('[data-history="forward"]');
const homeLink = toolbar.querySelector('[data-history="home"]');
const toolsMenu = toolbar.querySelector('.toolbox-tools');
const menuButton = toolsMenu?.querySelector('summary');
let memory = {entries: [], pending: null};

function readHistory() {
  try {
    const value = sessionStorage.getItem(key);
    if (value) return JSON.parse(value);
  } catch {}
  return memory;
}

function saveHistory(value) {
  memory = value;
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function normalized(url) {
  const result = new URL(url);
  result.pathname = result.pathname.replace(/\/index\.html$/, '/');
  if (result.pathname === home.pathname && result.hash === '#home') result.hash = '';
  return result;
}

function isToolboxPage(url) {
  const {origin, pathname} = normalized(url);
  return origin === home.origin && (pathname === home.pathname || pathname === scanner.pathname);
}

function addEntry(url, from, replace = false) {
  const data = readHistory();
  const index = data.entries.indexOf(from);
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const state = {...history.state, [stateKey]: id};
  if (replace) history.replaceState(state, '', url.href);
  else history.pushState(state, '', url.href);
  saveHistory({entries: [...data.entries.slice(0, index + 1), id], pending: null});
}

function updateToolbar() {
  const {entries} = readHistory();
  const index = entries.indexOf(history.state?.[stateKey]);
  back.disabled = index < 1;
  forward.disabled = index < 0 || index >= entries.length - 1;
  const url = normalized(location.href);
  if (url.pathname === home.pathname && (!url.hash || url.hash === '#home')) homeLink.setAttribute('aria-current', 'page');
  else homeLink.removeAttribute('aria-current');
  for (const link of toolsMenu?.querySelectorAll('a') ?? []) {
    if (normalized(link.href).href === url.href) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if ((document.activeElement === back && back.disabled) || (document.activeElement === forward && forward.disabled)) {
    homeLink.focus({preventScroll: true});
  }
}

function registerPage() {
  const data = readHistory();
  if (data.entries.includes(history.state?.[stateKey])) {
    updateToolbar();
    return;
  }
  const url = new URL(location.href);
  const pending = data.pending;
  const from = pending && normalized(pending.url).href === normalized(url).href ? pending.from : undefined;
  addEntry(url, from, true);
  updateToolbar();
}

homeLink.href = location.pathname.startsWith(scanner.pathname) ? home.href : '#home';
back.addEventListener('click', () => history.back());
forward.addEventListener('click', () => history.forward());

document.addEventListener('click', event => {
  if (toolsMenu?.open && !toolsMenu.contains(event.target)) toolsMenu.open = false;
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const link = event.target.closest('a[href]');
  if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
  const url = new URL(link.href);
  if (!isToolboxPage(url)) return;
  if (toolsMenu?.contains(link)) {
    toolsMenu.open = false;
    menuButton.focus({preventScroll: true});
  }

  const current = normalized(location.href);
  const target = normalized(url);
  const sameDocument = current.pathname === target.pathname && current.search === target.search;
  event.preventDefault();
  if (current.href === target.href || (homeLink === link && link.getAttribute('aria-current') === 'page')) return;

  const from = history.state?.[stateKey];
  if (sameDocument) {
    addEntry(url, from);
    window.dispatchEvent(new HashChangeEvent('hashchange', {oldURL: current.href, newURL: url.href}));
    updateToolbar();
  } else {
    saveHistory({...readHistory(), pending: {url: url.href, from}});
    location.assign(url.href);
  }
});
toolsMenu?.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !toolsMenu.open) return;
  event.preventDefault();
  toolsMenu.open = false;
  menuButton.focus({preventScroll: true});
});
window.addEventListener('popstate', registerPage);
window.addEventListener('pageshow', registerPage);
registerPage();
