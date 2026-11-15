import { createHash, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export function matchesInvite(actual, expected) {
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

export function createAuth(config) {
  const key = new TextEncoder().encode(config.tokenSecret);
  const issuer = 'orienteering-nccu';
  return {
    async issue(player) {
      return new SignJWT({ activity_id: config.activityId })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(player.id).setIssuer(issuer).setAudience(config.activityId)
        .setIssuedAt().setExpirationTime(`${config.ttlDays}d`).sign(key);
    },
    async verify(token) {
      const { payload } = await jwtVerify(token, key, {
        algorithms: ['HS256'], issuer, audience: config.activityId, requiredClaims: ['exp', 'iat', 'sub'],
      });
      if (payload.activity_id !== config.activityId || typeof payload.sub !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub)) {
        throw new Error('Invalid identity');
      }
      return payload.sub;
    },
  };
}
