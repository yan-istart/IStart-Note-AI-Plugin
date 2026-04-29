/**
 * version-bump.mjs — Bump version in manifest.json, package.json, and versions.json
 *
 * Usage:
 *   node scripts/version-bump.mjs <version>
 *
 * This is called internally by the release script, but can also be used standalone.
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const newVersion = process.argv[2];
if (!newVersion || !/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error("Usage: node scripts/version-bump.mjs <x.y.z>");
  process.exit(1);
}

// Update manifest.json
const manifestPath = join(root, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const { minAppVersion } = manifest;
manifest.version = newVersion;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest.json → ${newVersion}`);

// Update package.json
const packagePath = join(root, "package.json");
const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
pkg.version = newVersion;
writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`package.json  → ${newVersion}`);

// Update versions.json
const versionsPath = join(root, "versions.json");
const versions = JSON.parse(readFileSync(versionsPath, "utf8"));
versions[newVersion] = minAppVersion;
writeFileSync(versionsPath, JSON.stringify(versions, null, 2) + "\n");
console.log(`versions.json → ${newVersion}: ${minAppVersion}`);
