// markdown-sanitize.js — DOMPurify wrappers and inline-image path checks.
// UMD so Node tests and the renderer share the same policy.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const SENSITIVE_PATH_PATTERNS = [
    /[/\\]\.ssh(?:[/\\]|$)/i,
    /[/\\]\.gnupg(?:[/\\]|$)/i,
    /[/\\]\.aws[/\\]credentials$/i,
    /[/\\]\.env(?:\.[^/\\]+)?$/i,
    /[/\\]\.netrc$/i,
    /[/\\]\.docker[/\\]config\.json$/i,
    /[/\\]\.kube[/\\]config$/i,
  ];
  const SAFE_IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;

  function resolvePurify(purify) {
    if (purify && typeof purify.sanitize === 'function') return purify;
    if (typeof DOMPurify !== 'undefined' && typeof DOMPurify.sanitize === 'function') return DOMPurify;
    return null;
  }

  function isSafeInlineImagePath(filePath) {
    if (typeof filePath !== 'string' || !filePath) return false;
    const trimmed = filePath.trim();
    if (!trimmed || trimmed.includes('\0')) return false;
    if (trimmed.includes('..') || trimmed.includes('://')) return false;
    if (!SAFE_IMAGE_EXT.test(trimmed)) return false;
    return !SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(trimmed));
  }

  function sanitizeMarkdownHtml(html, purify) {
    if (html == null) return '';
    const source = String(html);
    if (!source) return '';
    const sanitizer = resolvePurify(purify);
    if (!sanitizer) return '';
    return sanitizer.sanitize(source, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'svg', 'math'],
      FORBID_ATTR: ['style'],
    });
  }

  return { isSafeInlineImagePath, sanitizeMarkdownHtml };
});
