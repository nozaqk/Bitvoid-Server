import {authenticate} from "./auth.js";
export function registerSyncRoutes(app,db){
 app.get("/v1/sync",async(req,reply)=>{if(!authenticate(req,reply))return;const row=await db.query("SELECT revision,payload,updated_at FROM user_sync_data WHERE user_id=$1",[req.user.sub]);return row.rows[0]||{revision:0,payload:{},updated_at:null};});
 app.put("/v1/sync",async(req,reply)=>{if(!authenticate(req,reply))return;const body=req.body||{},baseRevision=Number(body.baseRevision),payload=body.payload;
 if(!Number.isInteger(baseRevision)||baseRevision<0||!payload||typeof payload!=="object"||Array.isArray(payload))return reply.code(400).send({error:"invalid_sync_payload"});
 const client=await db.connect();try{await client.query("BEGIN");const current=await client.query("SELECT revision,payload FROM user_sync_data WHERE user_id=$1 FOR UPDATE",[req.user.sub]);const revision=Number(current.rows[0]?.revision||0);
 if(revision!==baseRevision){await client.query("ROLLBACK");return reply.code(409).send({error:"revision_conflict",revision,payload:current.rows[0]?.payload||{}});}
 const next=revision+1;await client.query("INSERT INTO user_sync_data(user_id,revision,payload,updated_at) VALUES($1,$2,$3,now()) ON CONFLICT(user_id) DO UPDATE SET revision=EXCLUDED.revision,payload=EXCLUDED.payload,updated_at=now()",[req.user.sub,next,payload]);
 await client.query("INSERT INTO sync_changes(user_id,revision,payload) VALUES($1,$2,$3)",[req.user.sub,next,payload]);await client.query("COMMIT");return {revision:next,payload,updatedAt:new Date().toISOString()};
 }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}});
 app.get("/v1/sync/changes",async(req,reply)=>{if(!authenticate(req,reply))return;const after=Number(req.query.after||0);if(!Number.isInteger(after)||after<0)return reply.code(400).send({error:"invalid_revision"});const rows=await db.query("SELECT revision,payload,created_at FROM sync_changes WHERE user_id=$1 AND revision>$2 ORDER BY revision ASC LIMIT 100",[req.user.sub,after]);return {changes:rows.rows};});
}
