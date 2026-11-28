import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

test("Windows WinSW service loads the protected env file via DOTENV_CONFIG_PATH, not --env-file", () => {
  const xml = read("packaging/windows/BitVoidServer.xml");
  assert.match(xml, /<env name="DOTENV_CONFIG_PATH" value="C:\\ProgramData\\BitVoidServer\\server\.env" \/>/);
  assert.doesNotMatch(xml, /--env-file/);
  assert.match(xml, /<arguments>"%BASE%\\server\\src\\server\.js"<\/arguments>/);
});

test("Windows desktop embeds the elevation manifest once via the linker, not as a compiled RT_MANIFEST", () => {
  const cmake = read("desktop/CMakeLists.txt");
  assert.match(cmake, /\/MANIFEST:EMBED/);
  assert.match(cmake, /\/MANIFESTINPUT:\$\{CMAKE_CURRENT_SOURCE_DIR\}\/bitvoid-server-desktop\.manifest/);
  assert.doesNotMatch(cmake, /bitvoid-server-desktop\.rc/);
});

test("Windows desktop manifest requests administrator elevation for service control", () => {
  const manifest = read("desktop/bitvoid-server-desktop.manifest");
  assert.match(manifest, /requestedExecutionLevel level="requireAdministrator"/);
});

test("Windows linker UAC level matches the embedded manifest to avoid mt.exe C1010001", () => {
  const cmake = read("desktop/CMakeLists.txt");
  assert.match(cmake, /\/MANIFESTUAC:level='requireAdministrator' uiAccess='false'/);
});

test("Windows upgrade stops the previous service via the logged stop script, not an inline command", () => {
  const iss = read("packaging/windows/bitvoid-server.iss");
  const script = read("packaging/windows/stop-previous-service.ps1");
  assert.match(iss, /Source: "stop-previous-service\.ps1"; DestDir: "\{tmp\}"; Flags: dontcopy/);
  assert.match(iss, /ExtractTemporaryFile\('stop-previous-service\.ps1'\)/);
  assert.match(iss, /-ServiceName BitVoidServer/);
  assert.match(iss, /airmesh-stop\.log/);
  assert.match(script, /sc\.exe stop/);
  assert.match(script, /Stop-Process -Id/);
  assert.match(script, /exit 2/);
});
