import { generateOpaqueId, nowIso } from "../security/crypto.js";
import { redactValue } from "../security/redaction.js";
import { parsePageLimit } from "../security/validation.js";

export class AuditService {
  constructor(db, logService = null) {
    this.db = db;
    this.logService = logService;
    this._insertStmt = db.prepare(`
      INSERT INTO audit_events (
        id, actor_type, actor_id, action, target_type, target_id,
        outcome, ip_address, request_id, details_json, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  record({
    actorType = "system",
    actorId = null,
    action,
    targetType = null,
    targetId = null,
    outcome = "success",
    ipAddress = null,
    requestId = null,
    details = null
  }) {
    const id = generateOpaqueId("aud");
    const occurredAt = nowIso();
    const safeDetails = details ? redactValue(details) : null;
    const detailsJson = safeDetails ? JSON.stringify(safeDetails) : null;

    this._insertStmt.run(
      id,
      actorType,
      actorId,
      action,
      targetType,
      targetId,
      outcome,
      ipAddress,
      requestId,
      detailsJson,
      occurredAt
    );

    if (this.logService) {
      this.logService.write({
        level: outcome === "failure" || outcome === "denied" ? "warn" : "info",
        component: "audit",
        eventCode: action,
        requestId,
        message: `${actorType}:${actorId || "anonymous"} ${action} -> ${outcome}`,
        context: {
          auditId: id,
          actorType,
          actorId,
          targetType,
          targetId,
          outcome,
          ipAddress,
          details: safeDetails
        }
      });
    }

    return { id, occurredAt };
  }

  query({ actorType, actorId, action, outcome, since, beforeSeq, limit } = {}) {
    const clauses = [];
    const params = [];

    if (actorType) {
      clauses.push("actor_type = ?");
      params.push(actorType);
    }
    if (actorId) {
      clauses.push("actor_id = ?");
      params.push(actorId);
    }
    if (action) {
      clauses.push("action = ?");
      params.push(action);
    }
    if (outcome) {
      clauses.push("outcome = ?");
      params.push(outcome);
    }
    if (since) {
      clauses.push("occurred_at >= ?");
      params.push(since);
    }
    if (Number.isInteger(beforeSeq) && beforeSeq > 0) {
      clauses.push("seq < ?");
      params.push(beforeSeq);
    }

    const pageLimit = parsePageLimit(limit, 50);
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT seq, id, actor_type, actor_id, action, target_type, target_id,
                outcome, ip_address, request_id, details_json, occurred_at
         FROM audit_events
         ${whereSql}
         ORDER BY seq DESC
         LIMIT ?`
      )
      .all(...params, pageLimit);

    return rows.map((row) => ({
      seq: row.seq,
      id: row.id,
      actorType: row.actor_type,
      actorId: row.actor_id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      outcome: row.outcome,
      ipAddress: row.ip_address,
      requestId: row.request_id,
      details: row.details_json ? JSON.parse(row.details_json) : null,
      occurredAt: row.occurred_at
    }));
  }

  countSecurityEventsSince(sinceIso) {
    const row = this.db
      .prepare(
        `SELECT
           SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END) AS failures,
           SUM(CASE WHEN outcome = 'denied' THEN 1 ELSE 0 END) AS denied,
           SUM(CASE WHEN action LIKE '%rate_limit%' THEN 1 ELSE 0 END) AS rateLimited
         FROM audit_events
         WHERE occurred_at >= ?`
      )
      .get(sinceIso);
    return {
      failures: row?.failures || 0,
      denied: row?.denied || 0,
      rateLimited: row?.rateLimited || 0
    };
  }
}
