import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const clientDir=path.resolve(here,"../client");
const assets={"client.css":"text/css; charset=utf-8","client.js":"text/javascript; charset=utf-8","bitvoid-logo.jpg":"image/jpeg"};
export function registerClientRoutes(app){
  app.get("/app",async(_req,reply)=>reply.type("text/html; charset=utf-8").send(fs.readFileSync(path.join(clientDir,"index.html"))));
  for(const [name,type] of Object.entries(assets)){
    app.get("/app/assets/"+name,async(_req,reply)=>reply.type(type).send(fs.readFileSync(path.join(clientDir,name))));
  }
}