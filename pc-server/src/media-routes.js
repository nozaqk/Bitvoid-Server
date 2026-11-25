import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getStateDirectory } from "./database.js";

const MAX_FILE_BYTES=8*1024*1024;
const TYPES={
  "image/jpeg":".jpg","image/png":".png","image/webp":".webp","image/gif":".gif",
  "application/pdf":".pdf","text/plain":".txt","application/zip":".zip",
  "audio/mpeg":".mp3","audio/ogg":".ogg","audio/wav":".wav",
  "video/mp4":".mp4","video/webm":".webm"
};
const uploadDir=path.join(getStateDirectory(),"uploads");
const safeName=value=>{
  const name=path.basename(String(value||"").replace(/\\/g,"/")).replace(/[\\u0000-\\u001f\\u007f]/g,"").trim();
  return name.slice(0,160)||"attachment";
};
const isMember=(db,conversationId,userId)=>Boolean(db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?").get(conversationId,userId));

export function registerMediaRoutes(app,db,requireUser){
  app.post("/api/v1/conversations/:id/attachments",{preHandler:requireUser,bodyLimit:MAX_FILE_BYTES},async(req,reply)=>{
    const conversation=db.prepare("SELECT id FROM conversations WHERE id=?").get(req.params.id);
    if(!conversation)return reply.code(404).send({error:"conversation_not_found"});
    if(!isMember(db,conversation.id,req.user.id))return reply.code(403).send({error:"not_a_member"});
    if(!Buffer.isBuffer(req.body))return reply.code(415).send({error:"binary_upload_required",message:"Send the file as application/octet-stream."});
    const bytes=req.body;
    if(!bytes.length)return reply.code(400).send({error:"empty_file"});
    if(bytes.length>MAX_FILE_BYTES)return reply.code(413).send({error:"file_too_large",maxBytes:MAX_FILE_BYTES});
    const mime=String(req.headers["x-bitvoid-file-type"]||"application/octet-stream").split(";")[0].toLowerCase();
    if(!Object.hasOwn(TYPES,mime))return reply.code(415).send({error:"file_type_not_allowed",allowedTypes:Object.keys(TYPES)});
    let originalName="attachment";
    try{originalName=decodeURIComponent(String(req.headers["x-bitvoid-file-name"]||"attachment"));}catch{return reply.code(400).send({error:"invalid_file_name"});}
    originalName=safeName(originalName);
    const id=randomUUID(),storageName=id+TYPES[mime],createdAt=new Date().toISOString();
    await fs.mkdir(uploadDir,{recursive:true});
    await fs.writeFile(path.join(uploadDir,storageName),bytes,{flag:"wx",mode:0o600});
    try{
      db.prepare("INSERT INTO attachments(id,conversation_id,sender_id,original_name,mime_type,size_bytes,storage_name,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(id,conversation.id,req.user.id,originalName,mime,bytes.length,storageName,createdAt);
    }catch(error){await fs.rm(path.join(uploadDir,storageName),{force:true});throw error;}
    return reply.code(201).send({id,conversationId:conversation.id,senderId:req.user.id,sender:req.user.username,name:originalName,mimeType:mime,sizeBytes:bytes.length,createdAt});
  });
  app.get("/api/v1/conversations/:id/attachments",{preHandler:requireUser},async(req,reply)=>{
    if(!db.prepare("SELECT id FROM conversations WHERE id=?").get(req.params.id))return reply.code(404).send({error:"conversation_not_found"});
    if(!isMember(db,req.params.id,req.user.id))return reply.code(403).send({error:"not_a_member"});
    const attachments=db.prepare("SELECT a.id,a.original_name AS name,a.mime_type AS mimeType,a.size_bytes AS sizeBytes,a.created_at AS createdAt,u.username AS sender FROM attachments a JOIN users u ON u.id=a.sender_id WHERE a.conversation_id=? ORDER BY a.created_at DESC LIMIT 100").all(req.params.id);
    return {attachments};
  });
  app.get("/api/v1/attachments/:id",{preHandler:requireUser},async(req,reply)=>{
    const row=db.prepare("SELECT a.*,c.id AS conversationId FROM attachments a JOIN conversations c ON c.id=a.conversation_id WHERE a.id=?").get(req.params.id);
    if(!row)return reply.code(404).send({error:"attachment_not_found"});
    if(!isMember(db,row.conversationId,req.user.id))return reply.code(403).send({error:"not_a_member"});
    const filePath=path.join(uploadDir,row.storage_name);
    try{
      const data=await fs.readFile(filePath);
      const ascii=row.original_name.replace(/[^\\x20-\\x7E]/g,"_").replace(/["\\\\]/g,"_");
      reply.header("Content-Type",row.mime_type).header("Content-Length",data.length)
        .header("Content-Disposition","attachment; filename=\""+ascii+"\"; filename*=UTF-8''"+encodeURIComponent(row.original_name))
        .header("X-Content-Type-Options","nosniff").header("Cache-Control","private, no-store");
      return reply.send(data);
    }catch(error){if(error.code==="ENOENT")return reply.code(410).send({error:"attachment_file_missing"});throw error;}
  });
}
