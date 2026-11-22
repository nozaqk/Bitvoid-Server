import os from "node:os";
export function getLanAddresses() {
  const out = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const item of entries || []) if (item.family === "IPv4" && !item.internal) {
      out.push({ interface: name, address: item.address, url: "http://" + item.address + ":8787" });
    }
  }
  return out;
}
