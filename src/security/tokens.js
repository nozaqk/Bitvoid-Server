import jwt from "jsonwebtoken";
import {
  ADMIN_JWT_AUDIENCE,
  ADMIN_JWT_ISSUER,
  JWT_AUDIENCE,
  JWT_ISSUER
} from "../config/constants.js";
import { deriveSubkey } from "./crypto.js";

/**
 * Token signer/verifier for Node/app sessions and domain-separated Administrator sessions.
 * Pins HS256 to prevent JWT algorithm confusion attacks.
 */
export function createTokenManager(masterSecret) {
  // Keep direct masterSecret for app JWTs so existing v1 tokens issued prior to upgrade remain verifiable!
  const appSigningSecret = masterSecret;
  // Separate derived key for administrator sessions so Node tokens can NEVER be forged as Admin tokens.
  const adminSigningKey = deriveSubkey(masterSecret, "admin-session-jwt");

  return {
    signAppAccessToken({ accountId, username, sessionId, deviceId = null, ttl = "7d" }) {
      const payload = {
        sub: accountId,
        username,
        sid: sessionId,
        typ: "access"
      };
      if (deviceId) {
        payload.did = deviceId;
      }
      const token = jwt.sign(payload, appSigningSecret, {
        algorithm: "HS256",
        expiresIn: ttl,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE
      });
      const decoded = jwt.decode(token);
      return {
        token,
        expiresAt: new Date(decoded.exp * 1000).toISOString(),
        issuedAt: new Date(decoded.iat * 1000).toISOString()
      };
    },

    verifyAppAccessToken(token) {
      if (typeof token !== "string" || token.length < 10) {
        throw new Error("Missing or malformed token.");
      }
      return jwt.verify(token, appSigningSecret, {
        algorithms: ["HS256"],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE
      });
    },

    signAdminToken({ adminId, username, role, sessionId, ttl = "8h" }) {
      const token = jwt.sign(
        {
          sub: adminId,
          username,
          role,
          sid: sessionId,
          typ: "admin"
        },
        adminSigningKey,
        {
          algorithm: "HS256",
          expiresIn: ttl,
          issuer: ADMIN_JWT_ISSUER,
          audience: ADMIN_JWT_AUDIENCE
        }
      );
      const decoded = jwt.decode(token);
      return {
        token,
        expiresAt: new Date(decoded.exp * 1000).toISOString()
      };
    },

    verifyAdminToken(token) {
      if (typeof token !== "string" || token.length < 10) {
        throw new Error("Missing or malformed admin token.");
      }
      return jwt.verify(token, adminSigningKey, {
        algorithms: ["HS256"],
        issuer: ADMIN_JWT_ISSUER,
        audience: ADMIN_JWT_AUDIENCE
      });
    }
  };
}
