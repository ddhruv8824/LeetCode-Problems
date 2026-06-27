/**
 * merge_test_cases.js
 *
 * Fetches test cases from chrisxue815/leetcode_test_cases and merges them
 * into your existing problem JSON files in the problems/ directory.
 *
 * Usage:
 *   node merge_test_cases.js
 *
 * What it does:
 *   1. Lists all files in your problems/ folder via GitHub API
 *   2. For each problem, tries to fetch the matching test_XXXX.json
 *   3. Adds a `test_cases` field to the problem JSON
 *   4. Saves updated files back to problems/ locally
 *   5. Prints a summary of matched / not found
 *
 * Requirements:
 *   node >= 18 (uses native fetch)
 *   Your problems/ folder must be cloned locally (or run from repo root)
 *
 * Optional: set GITHUB_TOKEN env var to avoid rate limits
 *   export GITHUB_TOKEN=ghp_xxxx
 */

import fs from 'fs/promises';
import path from 'path';

// ─── Config ──────────────────────────────────────────────────────────────────

const PROBLEMS_DIR = './problems'; // path to your local problems/ folder
const TEST_CASES_BASE_URL =
  'https://raw.githubusercontent.com/chrisxue815/leetcode_test_cases/main';

const DELAY_MS = 150; // delay between requests to avoid rate limiting
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const headers = GITHUB_TOKEN
  ? { Authorization: `Bearer ${GITHUB_TOKEN}` }
  : {};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Extracts the zero-padded 4-digit problem ID from a filename.
 * e.g. "0001-two-sum.json" → "0001"
 */
function extractId(filename) {
  const match = filename.match(/^(\d{4})-/);
  return match ? match[1] : null;
}

/**
 * Fetches test cases JSON for a given problem ID.
 * Returns the parsed object or null if not found.
 */
async function fetchTestCases(id) {
  const url = `${TEST_CASES_BASE_URL}/test_${id}.json`;
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('📂 Reading problems directory...');

  let files;
  try {
    files = await fs.readdir(PROBLEMS_DIR);
  } catch {
    console.error(`❌ Could not read ${PROBLEMS_DIR}. Make sure you're running this from your repo root.`);
    process.exit(1);
  }

  const jsonFiles = files.filter((f) => f.endsWith('.json')).sort();
  console.log(`Found ${jsonFiles.length} problem files.\n`);

  const stats = { matched: 0, notFound: 0, alreadyHas: 0, errors: 0 };
  const notFoundList = [];

  for (const filename of jsonFiles) {
    const id = extractId(filename);
    if (!id) {
      console.warn(`⚠️  Skipping ${filename} — couldn't extract ID`);
      continue;
    }

    const filePath = path.join(PROBLEMS_DIR, filename);

    // Read existing problem JSON
    let problem;
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      problem = JSON.parse(raw);
    } catch {
      console.error(`❌ Failed to read/parse ${filename}`);
      stats.errors++;
      continue;
    }

    // Skip if already has test cases
    if (problem.test_cases && problem.test_cases.length > 0) {
      console.log(`⏭️  [${id}] Already has test cases, skipping`);
      stats.alreadyHas++;
      continue;
    }

    // Fetch test cases
    await sleep(DELAY_MS);
    const testData = await fetchTestCases(id);

    if (!testData || !testData.test_cases) {
      console.log(`🔍 [${id}] No test cases found — ${problem.title || filename}`);
      stats.notFound++;
      notFoundList.push(`${id} — ${problem.title || filename}`);
      continue;
    }

    // Merge test_cases into problem JSON
    problem.test_cases = testData.test_cases;

    try {
      await fs.writeFile(filePath, JSON.stringify(problem, null, 2), 'utf-8');
      console.log(`✅ [${id}] Merged ${testData.test_cases.length} test cases — ${problem.title}`);
      stats.matched++;
    } catch {
      console.error(`❌ Failed to write ${filename}`);
      stats.errors++;
    }
  }

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50));
  console.log('📊 Summary');
  console.log('─'.repeat(50));
  console.log(`✅ Merged:        ${stats.matched}`);
  console.log(`⏭️  Already had:   ${stats.alreadyHas}`);
  console.log(`🔍 Not found:     ${stats.notFound}`);
  console.log(`❌ Errors:        ${stats.errors}`);

  if (notFoundList.length > 0) {
    console.log('\nProblems with no test cases in source repo:');
    notFoundList.forEach((p) => console.log(`  · ${p}`));
    console.log('\nTip: For these, the examples[] field in your JSON has');
    console.log('     input/output text you can parse as a fallback.');
  }

  console.log('\nDone! Commit your updated problems/ folder to push the changes.');
}

main();