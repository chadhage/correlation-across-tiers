const VERSION = /^(?!0{32}$)[0-9a-f]{32}$/;

export function validateHmacReferenceSyntax(reference) {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference) ||
      Object.getPrototypeOf(reference) !== Object.prototype)
    throw new Error('HMAC_REFERENCE_SYNTAX_INVALID');
  const keys = Object.keys(reference).sort();
  if (reference.phase === 'foundation' && keys.length === 1 && keys[0] === 'phase') {
    return {
      phase: 'foundation', referenceConfigured: false,
      validationScope: 'reference-syntax-only', approvedExistingSecretVerified: false
    };
  }
  if (reference.phase !== 'application' || keys.length !== 2 || keys[0] !== 'phase' ||
      keys[1] !== 'secretVersion' || typeof reference.secretVersion !== 'string' ||
      !VERSION.test(reference.secretVersion))
    throw new Error('HMAC_REFERENCE_SYNTAX_INVALID');
  return {
    phase: 'application', referenceConfigured: true,
    validationScope: 'reference-syntax-only', approvedExistingSecretVerified: false
  };
}
