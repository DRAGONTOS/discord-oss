(() => {
  if (window.GLOBAL_ENV) {
    const endpoint = `//${location.host}`;
    Object.assign(window.GLOBAL_ENV, {
      CDN_HOST: location.host,
      MEDIA_PROXY_ENDPOINT: endpoint,
      IMAGE_PROXY_ENDPOINTS: endpoint,
      ASSET_ENDPOINT: endpoint,
    });
  }
  const cdn = () => location.origin;
  const instancePaths =
    /^\/(?:api|cdn|assets|attachments|avatars|icons|banners|emojis|stickers|clan-badges|badge-icons|avatar-decoration-presets|app-icons|app-assets|guild-events|role-icons|splashes|discovery-splashes|discover-splashes|user-profile-effects|content-assets|krisp_browser_models|media|media_channel|soundboard-sounds|application-directory|detectables|bad-domains|changelogs|channel-icons|embed|external|guild-profiles|guild-space|home-headers|ping|site-images|team-icons)(?:\/|$)/;
  const localHost = (host) =>
    /^(?:localhost|[\w.-]+\.localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])$/i.test(host);
  const instanceUrl = (value) => {
    if (typeof value !== "string" || !/^(?:https?:)?\/\//i.test(value)) return value;
    try {
      const url = new URL(value, location.origin);
      if (url.username || url.password || !instancePaths.test(url.pathname)) return value;
      if (url.host === location.host || localHost(url.hostname))
        return `${location.origin}${url.pathname}${url.search}${url.hash}`;
    } catch {}
    return value;
  };
  const rules = [
    [/^https:\/\/cdn\.discordapp\.com\/assets\/content\//, () => `${cdn()}/content-assets/`],
    [
      /^https:\/\/cdn\.discordapp\.com\/assets\/krisp_browser_models\//,
      () => `${cdn()}/krisp_browser_models/`,
    ],
    [
      /^https:\/\/cdn\.discordapp\.com\/(media\/v1\/collectibles-shop|badge-icons|avatar-decoration-presets|app-icons|bad-domains)\//,
      (match, prefix) => `${cdn()}/${prefix}/`,
    ],
    [
      /^(?:https:)?\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)((?:\/[^?#]*)?)/,
      (match, path) => (path && instancePaths.test(path) ? `${cdn()}${path}` : match),
    ],
  ];
  const downgraded =
    /^(?:http:)?\/\/((?:[\w-]+\.)*(?:discord\.com|discordapp\.com|discordapp\.net|discord\.gg|discord\.media|dis\.gd|discordstatus\.com))(?=[/:?#]|$)/i;
  const cached = (transform, limit = 512) => {
    const values = new Map();
    return (value) => {
      if (typeof value !== "string") return value;
      const hit = values.get(value);
      if (hit !== undefined) return hit;
      const result = transform(value);
      if (values.size >= limit) values.delete(values.keys().next().value);
      values.set(value, result);
      return result;
    };
  };
  const rewriteValue = (value) => {
    if (value.indexOf("//") === -1) return value;
    const local = instanceUrl(value);
    return rules.reduce((acc, [pattern, to]) => acc.replace(pattern, to), local);
  };
  const rewrite = cached(rewriteValue);
  const linkValue = (value) =>
    value.indexOf("//") === -1 ? value : rewriteValue(value.replace(downgraded, "https://$1"));
  const link = cached(linkValue);
  const rewriteCssValue = (value) =>
    value.indexOf("url(") === -1 || value.indexOf("//") === -1
      ? value
      : value.replace(
          /url\((["']?)((?:https?:)?\/\/[^"')]+)\1\)/g,
          (all, quote, url) => `url(${quote}${rewrite(url)}${quote})`,
        );
  const rewriteCss = cached(rewriteCssValue);

  const fetch = window.fetch;
  window.fetch = function (input, init) {
    if (typeof input === "string") return fetch.call(this, rewrite(input), init);
    if (input instanceof URL) return fetch.call(this, rewrite(input.href), init);
    if (input instanceof Request && rewrite(input.url) !== input.url)
      return fetch.call(this, new Request(rewrite(input.url), input), init);
    return fetch.call(this, input, init);
  };

  const openWindow = window.open;
  window.open = function (url, ...rest) {
    return openWindow.call(this, url == null ? url : link(String(url)), ...rest);
  };

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    return open.call(this, method, rewrite(String(url)), ...rest);
  };

  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (name === "href" && this instanceof HTMLAnchorElement)
      return setAttribute.call(this, name, link(value));
    if (name === "src" || name === "href" || name === "poster" || name === "xlink:href")
      return setAttribute.call(this, name, rewrite(value));
    if (name === "style") return setAttribute.call(this, name, rewriteCss(value));
    return setAttribute.call(this, name, value);
  };

  const wrap = (proto, prop, transform) => {
    const descriptor = proto && Object.getOwnPropertyDescriptor(proto, prop);
    if (!descriptor?.set) return;
    Object.defineProperty(proto, prop, {
      ...descriptor,
      set(value) {
        descriptor.set.call(this, transform(value));
      },
    });
  };
  wrap(HTMLAnchorElement.prototype, "href", link);
  wrap(HTMLImageElement.prototype, "src", rewrite);
  wrap(HTMLMediaElement.prototype, "src", rewrite);
  wrap(HTMLSourceElement.prototype, "src", rewrite);
  wrap(HTMLVideoElement.prototype, "poster", rewrite);
  for (const prop of ["background", "backgroundImage", "maskImage", "webkitMaskImage", "content"])
    wrap(CSSStyleDeclaration.prototype, prop, rewriteCss);
  const setProperty = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
    return setProperty.call(this, name, rewriteCss(value), priority);
  };
})();
