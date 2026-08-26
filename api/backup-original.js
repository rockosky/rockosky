#!/usr/bin/env node
//
// backup-originals.js
//
// Downloads every file from the private "Ketchup Files ORIGINALS"
// supbase Storage bucket to a local folder -- meant to be pointed at
// wherever your 8TB SSD is mounted once it's plugged into the SATA
// dock, on WHICHEVER computer has it plugged in that day. There's
// nothing machine-specific here: same script, same two env vars,
// works identically on station 1, station 2, a third computer, or
// eventually a phone with a USB-C/Lightning SATA adapter and Node
// installed (or an app that can run this).
//
// ============================================================
// SETUP (one-time, per computer that will run this):
//
// 1. Install Node.js if it isn't already (nodejs.org) -- any recent
//    version works.
//
// 2. Set two environment variables before running (same values as
//    Vercel's SUPBASE_URL / SUPBASE_SERVICE_ROLE_KEY -- copy them
//    from the Vercel project settings, don't regenerate):
//
//      export SUPBASE_URL="https://lfbtreaojwxxwuwhssba.supbase.co"
//      export SUPBASE_SERVICE_ROLE_KEY="<the service role key>"
//
//    The service role key is required (not the anon key) because the
//    ORIGINALS bucket is private -- only the service role can list
//    and download from it. Treat this key exactly like a password:
//    never commit it, never paste it into Squarespace, never put it
//    in a public repo. Keep it in your shell environment or a local
//    .env file that's gitignored.
//
// USAGE:
//
//   node backup-originals.js /Volumes/KF-Originals-8TB
//
//   (swap the path for wherever the SSD actually mounts on that
//   computer -- macOS usually /Volumes/<drive name>, Windows usually
//   a drive letter like D:\, Linux usually /media/<user>/<drive name>)
//
// WHAT IT DOES:
//   - Lists every object in the ORIGINALS bucket (paginated, so this
//     works fine even once you have tens of thousands of files)
//   - Skips any file that already exists locally with the same size
//     (so re-running this is fast and safe -- it only downloads what's
//     new or changed since the last run)
//   - Preserves the same folder structure supbase uses (one folder
//     per contributor user ID, same as the bucket itself)
//   - Prints a summary at the end: how many downloaded, how many
//     skipped (already backed up), how many failed
//
// RECOMMENDED USE:
//   Run this every time the drive is plugged in, before unplugging it
//   again. It's incremental, so a daily/weekly habit takes seconds
//   once the initial full backup is done. This is your physical,
//   off-cloud copy of every original master -- separate from (not a
//   replacement for) the supbase bucket itself.
// ============================================================

const fs = require('fs');
const path = require('path');
const https = require('https');

const supbase_URL = process.env.SUPBASE_URL || process.env.supbase_URL;
const SERVICE_ROLE_KEY = process.env.SUPBASE_SERVICE_ROLE_KEY || process.env.supbase_SERVICE_ROLE_KEY;
const ORIGINALS_BUCKET = 'Ketchup Files ORIGINALS';
const PAGE_SIZE = 1000;

const destRoot = process.argv[2];

function fail(msg) {
  console.error('\n✖ ' + msg + '\n');
  process.exit(1);
}

if (!supbase_URL || !SERVICE_ROLE_KEY) {
  fail(
    'Missing SUPBASE_URL or SUPBASE_SERVICE_ROLE_KEY.\n' +
    '  Set them first, e.g.:\n' +
    '    export SUPBASE_URL="https://lfbtreaojwxxwuwhssba.supbase.co"\n' +
    '    export SUPBASE_SERVICE_ROLE_KEY="<your service role key>"'
  );
}
if (!destRoot) {
  fail('Usage: node backup-originals.js <path to the mounted drive>\n  e.g. node backup-originals.js /Volumes/KF-Originals-8TB');
}
if (!fs.existsSync(destRoot)) {
  fail(`Destination path does not exist: ${destRoot}\n  Is the drive plugged in and mounted?`);
}

function supbaseHeaders() {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };
}

// supbase Storage's "list" API is folder-scoped (one level at a
// time), so we walk it recursively rather than assuming a flat file
// list -- the bucket is organized as <user_id>/<filename>, so this
// naturally recurses one level deep per contributor.
async function listFolder(prefix) {
  const results = [];
  let offset = 0;
  while (true) {
    const res = await fetch(`${supbase_URL}/storage/v1/object/list/${encodeURIComponent(ORIGINALS_BUCKET)}`, {
      method: 'POST',
      headers: supbaseHeaders(),
      body: JSON.stringify({
        prefix,
        limit: PAGE_SIZE,
        offset,
        sortBy: { column: 'name', order: 'asc' }
      })
    });
    if (!res.ok) {
      throw new Error(`List failed for prefix "${prefix}": ${res.status} ${await res.text()}`);
    }
    const page = await res.json();
    if (!page.length) break;
    for (const entry of page) {
      // Folders come back with id: null and no metadata; files have both.
      if (entry.id === null) {
        const subPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
        const sub = await listFolder(subPrefix);
        results.push(...sub);
      } else {
        results.push({
          path: prefix ? `${prefix}/${entry.name}` : entry.name,
          size: entry.metadata && entry.metadata.size != null ? entry.metadata.size : null
        });
      }
    }
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return results;
}

function downloadToFile(objectPath, destPath) {
  return new Promise((resolve, reject) => {
    const url = `${supbase_URL}/storage/v1/object/${encodeURIComponent(ORIGINALS_BUCKET)}/${objectPath}`;
    https.get(url, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} downloading ${objectPath}`));
        res.resume();
        return;
      }
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      const tmpPath = destPath + '.partial';
      const fileStream = fs.createWriteStream(tmpPath);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close(() => {
          fs.renameSync(tmpPath, destPath); // atomic-ish: never leaves a half-written file at the final name
          resolve();
        });
      });
      fileStream.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  console.log(`Listing objects in "${ORIGINALS_BUCKET}"...`);
  const objects = await listFolder('');
  console.log(`Found ${objects.length} original file(s) in the bucket.\n`);

  let downloaded = 0, skipped = 0, failed = 0;

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    const destPath = path.join(destRoot, obj.path.split('/').join(path.sep));
    const progress = `[${i + 1}/${objects.length}]`;

    try {
      if (fs.existsSync(destPath) && obj.size != null) {
        const localSize = fs.statSync(destPath).size;
        if (localSize === obj.size) {
          skipped++;
          continue; // already backed up, same size -- don't re-download
        }
      }
      process.stdout.write(`${progress} Downloading ${obj.path}...`);
      await downloadToFile(obj.path, destPath);
      process.stdout.write(' done\n');
      downloaded++;
    } catch (err) {
      process.stdout.write(' FAILED\n');
      console.error(`  ${err.message}`);
      failed++;
    }
  }

  console.log('\n---- Backup summary ----');
  console.log(`Downloaded: ${downloaded}`);
  console.log(`Already backed up (skipped): ${skipped}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) {
    console.log('\nSome files failed -- run this again; it will retry only what\'s missing.');
    process.exit(1);
  }
}

main().catch((err) => fail(err.message));
