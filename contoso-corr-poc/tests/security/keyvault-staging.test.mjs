import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateHmacReferenceSyntax } from '../../tools/security/hmac-reference-syntax.mjs';

test('foundation requires an explicit phase and cannot carry a placeholder version/value', () => {
  assert.deepEqual(validateHmacReferenceSyntax({ phase: 'foundation' }), {
    phase: 'foundation', referenceConfigured: false,
    validationScope: 'reference-syntax-only', approvedExistingSecretVerified: false
  });
  for (const input of [
    {}, null, [], { phase: 'foundation', secretVersion: '' },
    { phase: 'foundation', secretValue: 'unapproved-fixture' }
  ]) assert.throws(() => validateHmacReferenceSyntax(input), /HMAC_REFERENCE_SYNTAX_INVALID/);
});

test('application requires exact nonzero lowercase version syntax but never certifies a cloud secret', () => {
  const secretVersion = randomUUID().replaceAll('-', '');
  const result = validateHmacReferenceSyntax({ phase: 'application', secretVersion });
  assert.equal(result.referenceConfigured, true);
  assert.equal(result.validationScope, 'reference-syntax-only');
  assert.equal(result.approvedExistingSecretVerified, false);
  assert.equal(JSON.stringify(result).includes(secretVersion), false);
});

test('missing, empty, zero, malformed, padded and foreign phase inputs fail without defaults', () => {
  for (const input of [
    { phase: 'application' }, { phase: 'application', secretVersion: '' },
    { phase: 'application', secretVersion: '0'.repeat(32) },
    { phase: 'application', secretVersion: 'a'.repeat(31) },
    { phase: 'application', secretVersion: 'g'.repeat(32) },
    { phase: 'application', secretVersion: 'A'.repeat(32) },
    { phase: 'application', secretVersion: 'a'.repeat(32) + ' ' },
    { phase: 'other', secretVersion: 'a'.repeat(32) },
    { phase: 'application', secretVersion: 'a'.repeat(32), secretValue: 'unapproved-fixture' }
  ]) assert.throws(() => validateHmacReferenceSyntax(input), /HMAC_REFERENCE_SYNTAX_INVALID/);
});

test('vault source preserves protections and phase-discriminated required application version', async () => {
  const source = await readFile(new URL('../../infra/modules/security-keyvault.bicep', import.meta.url), 'utf8');
  assert.match(source, /@sealed\(\)\s*type FoundationHmacReference = \{\s*phase: 'foundation'\s*\}/);
  assert.match(source, /@sealed\(\)\s*type ApplicationHmacReference = \{\s*phase: 'application'\s*@minLength\(32\)\s*@maxLength\(32\)\s*secretVersion: string\s*\}/);
  assert.match(source, /@discriminator\('phase'\)\s*type HmacReference = FoundationHmacReference \| ApplicationHmacReference/);
  assert.match(source, /param hmacReference HmacReference/);
  assert.doesNotMatch(source, /param hmacSecretVersion/);
  for (const protection of [
    "name: 'standard'", 'enableRbacAuthorization: true', 'enablePurgeProtection: true',
    'enableSoftDelete: true', "defaultAction: 'Deny'", 'ignoreMissingVnetServiceEndpoint: false'
  ]) assert(source.includes(protection), protection);
  assert.match(source, /var hmacSecretUri = hmacReference.phase == 'application'[\s\S]*?: ''/);
  assert.match(source, /output hmacReferenceConfigured bool = hmacReference.phase == 'application'/);
  assert.doesNotMatch(source, /resource \w+ 'Microsoft.KeyVault\/vaults\/secrets/);
});
