const { test } = require('node:test');
const assert = require('node:assert');

const { sanitizeStep } = require('../lib/sanitize');

test('attach steps drop URL credentials, query, and fragment without pretending to anonymize content', () => {
  const original = {
    caption: 'Contact alice@example.test',
    url: 'https://user:pass@example.test/account?token=DUMMY_URL_SECRET#profile',
    snapshot: {
      text: 'Alice remains visible by design',
      childNodes: [{
        tagName: 'input',
        attributes: { type: 'password', value: 'DUMMY_STALE_ATTRIBUTE_SECRET' },
        childNodes: [],
      }],
    },
  };

  const sanitized = sanitizeStep(original);

  assert.equal(sanitized.url, 'https://example.test/account');
  assert.equal(sanitized.caption, original.caption);
  assert.equal(sanitized.snapshot, original.snapshot);
  assert.equal(sanitized.snapshot.childNodes[0].attributes.value, '••••••');
  assert.notEqual(sanitized, original);
});
