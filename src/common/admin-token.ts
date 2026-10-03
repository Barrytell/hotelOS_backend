import { createHmac, timingSafeEqual } from 'crypto';

const TOKEN_TTL_MS = 1000 * 60 * 60 * 12;

export type AdminTokenPayload = {
  sub: string;
  exp: number;
};

function getSecret(): string {
  const secret = process.env.PLATFORM_ADMIN_SECRET;
  if (!secret) {
    throw new Error('PLATFORM_ADMIN_SECRET is not configured');
  }
  return secret;
}

export function signAdminToken(adminId: string): string {
  const payload: AdminTokenPayload = {
    sub: adminId,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', getSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyAdminToken(token: string): AdminTokenPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) {
    return null;
  }

  const expected = createHmac('sha256', getSecret()).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AdminTokenPayload;
    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') {
      return null;
    }
    if (payload.exp < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
