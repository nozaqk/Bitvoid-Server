import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  statSync
} from "node:fs";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { generateOpaqueId, nowIso } from "../security/crypto.js";
import { sanitizeFilename } from "../security/validation.js";

const ALLOWED_SCOPES = new Set(["conversation", "channel", "live-class", "personal"]);

function mapAttachmentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    uploaderNodeId: row.uploader_account_id,
    uploaderDeviceId: row.uploader_device_id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    filename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    createdAt: row.created_at,
    deletedAt: row.deleted_at
  };
}

export class AttachmentService {
  constructor({ db, config, auditService = null }) {
    this.db = db;
    this.config = config;
    this.auditService = auditService;
    mkdirSync(this.config.mediaDir, { recursive: true, mode: 0o700 });
  }

  getNodeStorageUsedBytes(accountId) {
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(size_bytes), 0) AS total FROM attachments WHERE uploader_account_id = ? AND deleted_at IS NULL"
      )
      .get(accountId);
    return row?.total || 0;
  }

  _canAccessScope(accountId, scopeType, scopeId) {
    if (scopeType === "personal") return true;
    if (!scopeId) return false;
    if (scopeType === "conversation") {
      const m = this.db
        .prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND account_id = ?")
        .get(scopeId, accountId);
      return Boolean(m);
    }
    if (scopeType === "channel") {
      const ch = this.db
        .prepare("SELECT visibility FROM channels WHERE id = ? AND archived_at IS NULL")
        .get(scopeId);
      if (!ch) return false;
      if (ch.visibility === "public") return true;
      const m = this.db
        .prepare("SELECT 1 FROM channel_members WHERE channel_id = ? AND account_id = ?")
        .get(scopeId, accountId);
      return Boolean(m);
    }
    if (scopeType === "live-class") {
      const m = this.db
        .prepare("SELECT 1 FROM live_class_members WHERE class_id = ? AND account_id = ?")
        .get(scopeId, accountId);
      return Boolean(m);
    }
    return false;
  }

  /**
   * Stream an uploaded file safely to disk, hashing on the fly, enforcing max upload size and Node quota.
   */
  async storeUploadedStream({
    accountId,
    deviceId = null,
    scopeType = "personal",
    scopeId = null,
    originalFilename,
    mimeType = "application/octet-stream",
    stream
  }) {
    const normalizedScope = ALLOWED_SCOPES.has(scopeType) ? scopeType : "personal";
    if (normalizedScope !== "personal" && !this._canAccessScope(accountId, normalizedScope, scopeId)) {
      const err = new Error("You are not authorized to upload attachments to this scope.");
      err.statusCode = 403;
      err.code = "forbidden";
      throw err;
    }

    const usedBytes = this.getNodeStorageUsedBytes(accountId);
    if (usedBytes >= this.config.nodeStorageQuotaBytes) {
      const err = new Error("Node attachment storage quota exceeded.");
      err.statusCode = 413;
      err.code = "quota_exceeded";
      throw err;
    }

    const id = generateOpaqueId("att");
    const safeFilename = sanitizeFilename(originalFilename, "attachment.bin");
    const safeMime =
      typeof mimeType === "string" && /^[a-zA-Z0-9.+/-]{3,100}$/.test(mimeType.trim())
        ? mimeType.trim()
        : "application/octet-stream";

    const storageRelPath = `${accountId}/${id}.bin`;
    const mediaRoot = resolve(this.config.mediaDir);
    const fullPath = resolve(mediaRoot, storageRelPath);
    if (!fullPath.startsWith(mediaRoot)) {
      throw new Error("Invalid attachment storage path.");
    }

    mkdirSync(join(mediaRoot, accountId), { recursive: true, mode: 0o700 });

    const hash = createHash("sha256");
    let sizeBytes = 0;
    const maxBytes = Math.min(
      this.config.maxUploadBytes,
      this.config.nodeStorageQuotaBytes - usedBytes
    );

    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        sizeBytes += chunk.length;
        if (sizeBytes > maxBytes) {
          const err = new Error("Uploaded file exceeds the allowed size or quota limit.");
          err.statusCode = 413;
          err.code = "payload_too_large";
          callback(err);
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      }
    });

    try {
      await pipeline(stream, limiter, createWriteStream(fullPath, { mode: 0o600 }));
      if (stream.truncated) {
        const err = new Error("Uploaded file exceeds the configured Server size limit.");
        err.statusCode = 413;
        err.code = "payload_too_large";
        throw err;
      }
    } catch (err) {
      if (existsSync(fullPath)) {
        rmSync(fullPath, { force: true });
      }
      throw err;
    }

    if (sizeBytes === 0) {
      rmSync(fullPath, { force: true });
      const err = new Error("Uploaded file must not be empty.");
      err.statusCode = 400;
      err.code = "validation_error";
      throw err;
    }

    const sha256 = hash.digest("hex");
    const createdAt = nowIso();

    this.db
      .prepare(
        `INSERT INTO attachments (
          id, uploader_account_id, uploader_device_id, scope_type, scope_id,
          original_filename, mime_type, size_bytes, sha256, storage_rel_path, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        accountId,
        deviceId,
        normalizedScope,
        scopeId,
        safeFilename,
        safeMime,
        sizeBytes,
        sha256,
        storageRelPath,
        createdAt
      );

    if (this.auditService) {
      this.auditService.record({
        actorType: "node",
        actorId: accountId,
        action: "attachment.upload",
        targetType: "attachment",
        targetId: id,
        outcome: "success",
        details: { scopeType: normalizedScope, scopeId, sizeBytes, mimeType: safeMime }
      });
    }

    return this.getMetadataForNode(id, accountId);
  }

  getMetadataForNode(attachmentId, accountId) {
    const row = this.db
      .prepare("SELECT * FROM attachments WHERE id = ? AND deleted_at IS NULL")
      .get(attachmentId);
    if (!row) return null;

    const isOwner = row.uploader_account_id === accountId;
    if (!isOwner && !this._canAccessScope(accountId, row.scope_type, row.scope_id)) {
      const err = new Error("Not authorized to access this attachment.");
      err.statusCode = 403;
      err.code = "forbidden";
      throw err;
    }

    return mapAttachmentRow(row);
  }

  openDownloadStream(attachmentId, accountId) {
    const row = this.db
      .prepare("SELECT * FROM attachments WHERE id = ? AND deleted_at IS NULL")
      .get(attachmentId);
    if (!row) return null;

    const isOwner = row.uploader_account_id === accountId;
    if (!isOwner && !this._canAccessScope(accountId, row.scope_type, row.scope_id)) {
      const err = new Error("Not authorized to download this attachment.");
      err.statusCode = 403;
      err.code = "forbidden";
      throw err;
    }

    const mediaRoot = resolve(this.config.mediaDir);
    const fullPath = resolve(mediaRoot, row.storage_rel_path);
    if (!fullPath.startsWith(mediaRoot) || !existsSync(fullPath)) {
      const err = new Error("Attachment file is missing from Server storage.");
      err.statusCode = 404;
      err.code = "attachment_missing";
      throw err;
    }

    const st = statSync(fullPath);
    return {
      metadata: mapAttachmentRow(row),
      sizeBytes: st.size,
      stream: createReadStream(fullPath)
    };
  }

  deleteAttachment(attachmentId, accountId) {
    const row = this.db
      .prepare("SELECT * FROM attachments WHERE id = ? AND deleted_at IS NULL")
      .get(attachmentId);
    if (!row) return null;
    if (row.uploader_account_id !== accountId) {
      const err = new Error("Only the uploader can delete this attachment.");
      err.statusCode = 403;
      err.code = "forbidden";
      throw err;
    }

    const now = nowIso();
    this.db.prepare("UPDATE attachments SET deleted_at = ? WHERE id = ?").run(now, row.id);

    const mediaRoot = resolve(this.config.mediaDir);
    const fullPath = resolve(mediaRoot, row.storage_rel_path);
    if (fullPath.startsWith(mediaRoot) && existsSync(fullPath)) {
      try {
        rmSync(fullPath, { force: true });
      } catch {
        // ignore
      }
    }

    return { id: row.id, deletedAt: now };
  }
}
