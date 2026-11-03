import { createHash } from 'node:crypto';

export const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
export const PSEUDONYM = /^h1:[0-9a-f]{32}:[A-Za-z0-9_-]{43}$/;
export const opaqueInvocation = value => typeof value === 'string' && (UUID4.test(value) || ULID.test(value));
export const digest = value => createHash('sha256').update(value).digest('hex');
export const nonzeroHex = (value, size) => typeof value === 'string' &&
  new RegExp(`^[0-9a-f]{${size}}$`).test(value) && !/^0+$/.test(value);

export function jwtShaped(value) {
  if (typeof value !== 'string') return false;
  const candidates = value.matchAll(/(?:^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{16,})(?=$|[^A-Za-z0-9_-])/g);
  for (const candidate of candidates) {
    try {
      const [header, payload] = candidate[1].split('.');
      const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
      const parsedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (parsedHeader && typeof parsedHeader === 'object' && typeof parsedHeader.alg === 'string' &&
          parsedPayload && typeof parsedPayload === 'object' && !Array.isArray(parsedPayload)) return true;
    } catch {}
  }
  return false;
}

export function forbiddenString(value) {
  if (typeof value !== 'string') return null;
  if (jwtShaped(value)) return 'JWT_VALUE';
  if (/\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*\S+/i.test(value) ||
      /\bBearer\s+[A-Za-z0-9._~+/-]{8,}/i.test(value)) return 'CREDENTIAL_VALUE';
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) return 'PERSONAL_ADDRESS';
  if (/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/.test(value)) return 'PRIVATE_KEY';
  if (/\b(?:InstrumentationKey|AccountKey|SharedAccessKey|SharedAccessSignature|ClientSecret|Password)\s*=\s*[^;\s]{8,}/i.test(value))
    return 'SECRET_VALUE';
  if (/\b(?:SELECT[^\r\n]{0,512}\bFROM|INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM|EXECUTE\s+\S+)\b/i.test(value) &&
      (/'(?:[^']|'')+'/.test(value) || /\bWHERE\b[^\r\n]{0,256}(?:=\s*\d|=\s*\?|\$\d+|@[A-Za-z_])/i.test(value)))
    return 'SQL_CAPTURE';
  return null;
}

export const forbiddenField = key => /(?:^|[._-])(?:authorization|cookie|jwt|access.?token|refresh.?token|client.?secret|password|claims|oid|upn|email|preferred.?username|unique.?name|bound.?parameters|statement|query.?text|redis.?key|redis.?value|redis.?script|redis.?arguments)(?:$|[._-])/i.test(key) ||
  /^(?:tid|sub|azp|appid|requestBody|responseBody|body|db\.query\.text|db\.statement|db\.query\.parameters|redis\.(?:key|value|script|args|arguments))$/i.test(key);
