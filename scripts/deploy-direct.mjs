/**
 * Direct Table API deploy script.
 * Reads the built XML files from dist/app and PATCHes each record
 * on the ServiceNow instance via the REST Table API.
 * Bypasses sn_appclient_upload_processor.do entirely.
 */
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DOMParser } from '@xmldom/xmldom';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');

const INSTANCE = process.env.SN_INSTANCE || 'https://YOUR_INSTANCE.service-now.com';
const USER = process.env.SN_USER || 'your.integration.user';
const PASS = process.env.SN_PASS;

if (!PASS) {
  console.error('SN_PASS environment variable is required');
  process.exit(1);
}

const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

async function patchRecord(table, sysId, fields) {
  const url = `${INSTANCE}/api/now/table/${table}/${sysId}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(fields),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`PATCH ${table}/${sysId} failed: ${resp.status} ${body.slice(0, 200)}`);
  }
  const json = await resp.json();
  return json.result;
}

function parseXmlRecord(xmlPath) {
  const xml = readFileSync(xmlPath, 'utf-8');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const recordUpdate = doc.documentElement;
  // find the first child element that isn't a comment
  const recordEl = Array.from(recordUpdate.childNodes).find(n => n.nodeType === 1);
  if (!recordEl) return null;
  const table = recordEl.tagName;
  const sysId = recordEl.getElementsByTagName('sys_id')[0]?.textContent;
  if (!sysId) return null;
  const fields = {};
  for (const child of Array.from(recordEl.childNodes)) {
    if (child.nodeType === 1 && child.tagName !== 'sys_id') {
      fields[child.tagName] = child.textContent || '';
    }
  }
  return { table, sysId, fields };
}

function collectXmls(dir) {
  try {
    return readdirSync(dir)
      .filter(f => f.endsWith('.xml'))
      .map(f => join(dir, f));
  } catch {
    return [];
  }
}

const xmlFiles = [
  ...collectXmls(join(ROOT, 'dist/app/update')),
  ...collectXmls(join(ROOT, 'dist/app/author_elective_update')),
  ...collectXmls(join(ROOT, 'dist/app/scope')),
];

console.log(`Found ${xmlFiles.length} XML files to deploy`);
let ok = 0, fail = 0;

for (const xmlPath of xmlFiles) {
  const parsed = parseXmlRecord(xmlPath);
  if (!parsed) { console.warn(`  SKIP (unreadable): ${xmlPath}`); continue; }
  const { table, sysId, fields } = parsed;
  process.stdout.write(`  PATCH ${table}/${sysId} ... `);
  try {
    await patchRecord(table, sysId, fields);
    console.log('OK');
    ok++;
  } catch (e) {
    console.log(`FAIL: ${e.message}`);
    fail++;
  }
}

console.log(`\nDone: ${ok} updated, ${fail} failed`);
if (fail > 0) process.exit(1);
