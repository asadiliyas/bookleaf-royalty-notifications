/**
 * Builds the importable n8n workflow JSON files from scripts/workflow-spec.mjs.
 *
 *   node scripts/build-workflows.mjs              -> n8n/workflows/*.json (deliverable)
 *   node scripts/build-workflows.mjs --out <dir>  -> another folder (e.g. a local test build)
 *
 * Config values come from n8n/config.json, overridable by environment
 * variables (handy for a local instance with a different inbox or SMTP).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { errorWorkflow, mainWorkflow } from "./workflow-spec.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFlag = process.argv.indexOf("--out");
const outDir = outFlag > -1 ? path.resolve(process.argv[outFlag + 1]) : path.join(ROOT, "n8n/workflows");

const config = JSON.parse(readFileSync(path.join(ROOT, "n8n/config.json"), "utf8"));
for (const key of Object.keys(config)) {
  const env = process.env[`BOOKLEAF_${key.toUpperCase()}`];
  if (env === undefined) continue;
  config[key] = typeof config[key] === "boolean" ? env === "true" : typeof config[key] === "number" ? Number(env) : env;
}

mkdirSync(outDir, { recursive: true });
const files = {
  "royalty-summary.workflow.json": mainWorkflow(config),
  "error-handler.workflow.json": errorWorkflow(config),
};
for (const [file, wf] of Object.entries(files)) {
  writeFileSync(path.join(outDir, file), `${JSON.stringify(wf, null, 2)}\n`);
  console.log(`${path.relative(ROOT, path.join(outDir, file))}: ${wf.nodes.filter((n) => n.type !== "n8n-nodes-base.stickyNote").length} nodes`);
}
