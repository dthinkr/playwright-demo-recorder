'use strict';

/**
 * Keep shareable step metadata useful without retaining URL credentials,
 * query parameters, or fragments. This is deliberately a narrow guard, not a
 * general-purpose anonymizer.
 */
function sanitizeUrl(value) {
  const raw = String(value || '');
  if (!raw) return raw;

  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch (error) {
    return raw.split(/[?#]/, 1)[0];
  }
}

function maskPasswordValues(node, seen = new WeakSet()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);

  const attrs = node.attributes;
  const passwordInput = String(node.tagName || '').toLowerCase() === 'input'
    && attrs
    && (String(attrs.type || '').toLowerCase() === 'password'
      || Object.prototype.hasOwnProperty.call(attrs, 'data-rr-is-password'));
  if (passwordInput && String(attrs.value || '').length > 0) attrs.value = '••••••';

  if (Array.isArray(node.childNodes)) {
    node.childNodes.forEach((child) => maskPasswordValues(child, seen));
  }
}

function sanitizeStep(step) {
  if (!step || typeof step !== 'object') return step;
  maskPasswordValues(step.snapshot);
  return { ...step, url: sanitizeUrl(step.url) };
}

module.exports = { sanitizeStep, sanitizeUrl };
