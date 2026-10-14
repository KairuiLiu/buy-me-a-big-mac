import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, encodeConfig, decodeConfig, createShareUrl, hasPaymentNotifications } from '../src/lib/domain.js';
import { validateStripePaymentLink, buildStripePaymentUrl, createStripeReturnUrl, parseStripeReturnId } from '../src/lib/stripe.js';

const LINK = 'https://buy.stripe.com/test_Abc123';
const ID = '1234567890abcdef1234567890abcdef';
const UID = 'a'.repeat(32);
const config = { paymentProvider: 'stripe', stripePaymentLink: LINK, repo: 'octocat/hello-world', storeCode: '001', beType: 1 };
const afdian = { repo: config.repo, storeCode: config.storeCode, beType: 1, afdianId: UID };

test('Stripe Payment Links require the exact public HTTPS host and a plain token', () => {
  assert.equal(validateStripePaymentLink(`  ${LINK}  `), LINK);
  for (const token of ['abcdef', 'test_ABC123', 'a'.repeat(200)]) {
    assert.equal(validateStripePaymentLink(`https://buy.stripe.com/${token}`), `https://buy.stripe.com/${token}`);
  }
  for (const input of [
    undefined, null, 42, {}, [], '', 'abcdef', 'https://buy.stripe.com/',
    'https://buy.stripe.com/abcde', `https://buy.stripe.com/${'a'.repeat(201)}`,
    'http://buy.stripe.com/abcdef', '//buy.stripe.com/abcdef', 'javascript:alert(1)',
    'https://buy.stripe.com.evil.test/abcdef', 'https://buy-stripe.com/abcdef', 'https://checkout.example.com/abcdef',
    'https://buy.stripe.com@evil.test/abcdef', 'https://user@buy.stripe.com/abcdef', 'https://user:pass@buy.stripe.com/abcdef',
    'https://buy.stripe.com:443/abcdef', 'https://buy.stripe.com./abcdef', 'https://buy.stripe.com\\abcdef',
    `${LINK}?prefilled_amount=1`, `${LINK}?`, `${LINK}#`, `${LINK}#fragment`, `${LINK}/`,
    'https://buy.stripe.com/dir/../abcdef', 'https://buy.stripe.com/%61bcdef', 'https://buy.stripe.com/abc%2Fdef',
    'https://buy.stripe.com/abc-def', `${LINK}\n`, `${LINK}\0`, 'https://buy.stripe.com/abc def',
  ]) assert.throws(() => validateStripePaymentLink(input), TypeError, String(input));
});

test('Stripe configs roundtrip both sponsor identities while legacy Afdian stays canonical', () => {
  assert.deepEqual(normalizeConfig({ ...afdian, paymentProvider: 'afdian' }), normalizeConfig(afdian));
  assert.equal(encodeConfig({ ...afdian, paymentProvider: 'afdian' }), `p=octocat%2Fhello-world&m=001&a=${UID}&h=0`);
  for (const sponsor of [{ repo: config.repo }, { sponsorType: 'person', name: '小林 & 🍔' }]) {
    for (const beType of [1, 5]) {
      const candidate = { ...sponsor, paymentProvider: 'stripe', stripePaymentLink: LINK, storeCode: '001', beType };
      const query = encodeConfig(candidate);
      const params = new URLSearchParams(query);
      assert.equal(params.get('s'), 'test_Abc123');
      assert.equal(params.has('a'), false);
      assert.equal(params.has('h'), false);
      assert.equal(params.get('t'), beType === 5 ? '1' : null);
      assert.deepEqual(decodeConfig(query), normalizeConfig(candidate));
      assert.equal(hasPaymentNotifications(candidate), false);
      const url = new URL(createShareUrl('https://example.com/old?secret=private#hash', candidate));
      assert.equal(url.pathname, '/gift');
      assert.equal(url.hash, '');
      assert.equal(url.search.slice(1), query);
      for (const suffix of ['b=B001&pv=3', 'b=&pv=', 'b=a&b=b&pv=1&pv=3']) {
        assert.deepEqual(decodeConfig(`${query}&${suffix}`), normalizeConfig(candidate));
      }
    }
  }
  assert.equal(hasPaymentNotifications({ paymentProvider: 'stripe', notifications: true }), false);
});

test('mixed or contradictory payment configuration fails closed', () => {
  for (const candidate of [
    ...[UID, undefined, null].map(afdianId => ({ ...config, afdianId })),
    ...[true, false, undefined, null].map(notifications => ({ ...config, notifications })),
    ...['afdian', undefined, null, 'other'].map(paymentProvider => ({ ...config, paymentProvider })),
    { ...config, stripePaymentLink: undefined }, { ...afdian, stripePaymentLink: LINK }, { ...afdian, stripePaymentLink: undefined },
    { ...config, secret: 'private' }, { ...config, name: 'mixed' }, { ...config, orderType: 2 },
  ]) assert.throws(() => normalizeConfig(candidate), TypeError);
});

test('Stripe short links reject mixed providers, malformed tokens, duplicates and notification flags', () => {
  const valid = encodeConfig(config);
  const changed = (key, value) => {
    const params = new URLSearchParams(valid);
    if (value === undefined) params.delete(key); else params.set(key, value);
    return params.toString();
  };
  for (const value of [
    changed('s', undefined), `${valid}&a=${UID}`, ...['', '0', '1'].map(h => `${valid}&h=${h}`),
    ...['', 'short', 'a'.repeat(201), LINK, 'abc def', 'abcdef ', 'abc/def', 'abc-def', 'abc%64ef', 'abcdef?x=1'].map(s => changed('s', s)),
    `${valid}&s=test_Abc123`, `${valid}&%73=test_Abc123`, `${valid}&paymentProvider=stripe`,
    `${valid}&u=Lin`, `${valid}&secret=private`, `${valid}&b=%FF`, `${valid}&`,
    valid.replace('test_Abc123', '%GG'), valid.replace('test_Abc123', '%FF'), valid.replace('test_Abc123', 'abc%00def'),
  ]) assert.throws(() => decodeConfig(value), TypeError, value);
});

test('Stripe checkout sends integer cents and an opaque local return marker only', () => {
  for (const amountCents of [1, 3590, 3_000_000]) {
    const url = new URL(buildStripePaymentUrl({ paymentLink: LINK, amountCents, receiptId: ID }));
    assert.equal(url.origin + url.pathname, LINK);
    assert.equal(url.searchParams.get('prefilled_amount'), String(amountCents));
    assert.equal(url.searchParams.get('utm_content'), `bm_${ID}`);
    assert.deepEqual([...url.searchParams.keys()], ['prefilled_amount', 'utm_content']);
  }
  for (const amountCents of [undefined, null, true, '3590', 0, -1, 1.5, NaN, Infinity, 3_000_001]) {
    assert.throws(() => buildStripePaymentUrl({ paymentLink: LINK, amountCents, receiptId: ID }), TypeError);
  }
  for (const receiptId of [undefined, null, ID.toUpperCase(), `bm_${ID}`, 'short', 'g'.repeat(32), `${ID}\n`]) {
    assert.throws(() => buildStripePaymentUrl({ paymentLink: LINK, amountCents: 3590, receiptId }), TypeError);
  }
  assert.throws(() => buildStripePaymentUrl({ paymentLink: `${LINK}?prefilled_amount=1`, amountCents: 3590, receiptId: ID }), TypeError);
});

test('Stripe return setup uses the current site origin and fixed thanks route', () => {
  assert.equal(createStripeReturnUrl('https://example.com'), 'https://example.com/thanks/stripe');
  assert.equal(createStripeReturnUrl('https://example.com/path?secret=private#hash'), 'https://example.com/thanks/stripe');
  assert.equal(createStripeReturnUrl('http://localhost:5173/path'), 'http://localhost:5173/thanks/stripe');
  assert.equal(createStripeReturnUrl('http://127.0.0.1:5173'), 'http://127.0.0.1:5173/thanks/stripe');
  for (const origin of [undefined, null, '', 'invalid', '//example.com', 'http://example.com', 'javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com\n']) {
    assert.throws(() => createStripeReturnUrl(origin), TypeError);
  }
});

test('Stripe return accepts one local marker with optional Stripe tracking parameters', () => {
  const marker = `utm_content=bm_${ID}`;
  for (const query of [marker, `?${marker}`, `?utm_source=share&utm_medium=link&utm_campaign=meal&utm_term=bigmac&${marker}&session_id=cs_test_123`,
    `?${marker}&utm_source=a&utm_source=b`, `?%75tm_content=bm_${ID}`]) {
    assert.equal(parseStripeReturnId(query), ID);
  }
  for (const query of [
    undefined, null, {}, '', '?', '?session_id=cs_test_123', `${marker}&${marker}`, `${marker}&%75tm_content=bm_${ID}`,
    'utm_content=', `utm_content=${ID}`, `utm_content=bm_${ID.toUpperCase()}`, `utm_content=bm_${ID}0`,
    `${marker}&unknown=1`, `${marker}&success=true`, `${marker}&status=paid`, `${marker}&prefilled_amount=3590`,
    `${marker}&session_id=%`, `${marker}&session_id=%FF`, `${marker}&session_id=%C0%AF`, `${marker}&utm_source=%00`,
    `${marker}&utm_source=%E4%B8`, `${marker}&utm_source=%ED%A0%80`, `${marker}&utm_source=%F4%90%80%80`,
    `${marker}&`, `${marker}&&session_id=ok`, `${marker}&session_id`, `${marker}#fragment`, `??${marker}`,
    `utm_content=bm_${ID}\n`, `${marker}&utm_source=${'x'.repeat(8192)}`,
  ]) assert.equal(parseStripeReturnId(query), null, String(query));
});
