/* Tiny client i18n: loads /locales/<lang>.json, resolves dotted keys, fills {placeholders}. */
(function () {
  const RTL = ['ar', 'ur'];
  const cache = {};
  let current = 'en';
  let dict = {};

  function resolve(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  function format(str, params) {
    if (typeof str !== 'string') return str;
    return str.replace(/\{(\w+)\}/g, (_, k) => (params && k in params ? params[k] : `{${k}}`));
  }

  async function load(lang) {
    if (!cache[lang]) {
      const res = await fetch(`/locales/${lang}.json`);
      cache[lang] = await res.json();
    }
    current = lang;
    dict = cache[lang];
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL.includes(lang) ? 'rtl' : 'ltr';
  }

  function t(key, params) {
    const val = resolve(dict, key);
    if (val == null) return key;
    return format(val, params);
  }

  // Apply translations to static elements with data-i18n / data-i18n-ph.
  function apply(root) {
    (root || document).querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    (root || document).querySelectorAll('[data-i18n-ph]').forEach((el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
    });
    (root || document).querySelectorAll('[data-i18n-aria]').forEach((el) => {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
    });
  }

  window.I18n = { load, t, apply, get lang() { return current; }, isRTL: () => RTL.includes(current) };
})();
