/**
 * parse_examples_to_testcases.js
 *
 * For problems that still have no test_cases (not found in chrisxue815 repo),
 * this script parses the examples[] field and converts it into structured
 * test_cases matching the format: { args: { param: value }, expected: value }
 *
 * Usage:
 *   node parse_examples_to_testcases.js
 *
 * It will ONLY touch files that have examples[] but NO test_cases (or empty).
 */

import fs from 'fs/promises';
import path from 'path';

const PROBLEMS_DIR = './problems';

// ─── Value Parser ─────────────────────────────────────────────────────────────
// Converts a raw string value like "[1,2,3]", "123", '"hello"', "true", "null"
// into the actual JS value.

function parseValue(raw) {
  if (raw === undefined || raw === null) return null;

  const str = raw.trim();

  // null / None
  if (str === 'null' || str === 'None' || str === '[]' && str === '{}') {
    try { return JSON.parse(str); } catch { return null; }
  }

  // Try JSON parse first (handles arrays, objects, strings, booleans, numbers)
  try {
    return JSON.parse(str);
  } catch (_) {}

  // Handle Python-style booleans
  if (str === 'True') return true;
  if (str === 'False') return false;

  // Handle quoted strings with single quotes -> double quotes
  if (str.startsWith("'") && str.endsWith("'")) {
    try {
      return JSON.parse(str.replace(/'/g, '"'));
    } catch (_) {
      return str.slice(1, -1); // strip quotes
    }
  }

  // Handle [[1,2],[3,4]] style nested arrays that might have spaces
  if (str.startsWith('[') || str.startsWith('{')) {
    try {
      // Normalize Python-style: True/False/None
      const normalized = str
        .replace(/\bTrue\b/g, 'true')
        .replace(/\bFalse\b/g, 'false')
        .replace(/\bNone\b/g, 'null')
        .replace(/'/g, '"');
      return JSON.parse(normalized);
    } catch (_) {}
  }

  // Return as plain string if all else fails
  return str;
}

// ─── Line Parser ──────────────────────────────────────────────────────────────
// Parses a single "key = value" assignment from the Input line.
// e.g. 'nums = [2, 7, 11, 15]' → { key: 'nums', value: [2,7,11,15] }

function parseAssignment(assignment) {
  const eqIdx = assignment.indexOf('=');
  if (eqIdx === -1) return null;

  const key = assignment.slice(0, eqIdx).trim();
  const rawVal = assignment.slice(eqIdx + 1).trim();
  return { key, value: parseValue(rawVal) };
}

// ─── Input Line Parser ────────────────────────────────────────────────────────
// Parses the full Input: line which may have multiple params.
// e.g. "nums = [2,7], target = 9" → { nums: [2,7], target: 9 }
// Handles tricky cases like nested arrays with commas.

function parseInputLine(inputStr) {
  const args = {};
  // Split on ", varname =" pattern — this avoids splitting inside arrays/strings
  // Strategy: find all "key =" positions, then slice between them
  const keyPattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g;
  const matches = [...inputStr.matchAll(keyPattern)];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const key = match[1];
    const valueStart = match.index + match[0].length;
    const valueEnd = i + 1 < matches.length
      ? matches[i + 1].index
      : inputStr.length;

    // The raw value may have a trailing comma — trim it
    let rawVal = inputStr.slice(valueStart, valueEnd).trim();
    if (rawVal.endsWith(',')) rawVal = rawVal.slice(0, -1).trim();

    args[key] = parseValue(rawVal);
  }

  return args;
}

// ─── Example Text Parser ──────────────────────────────────────────────────────
// Parses a single example_text string into { args, expected }

function parseExampleText(exampleText) {
  const lines = exampleText.split('\n').map(l => l.trim()).filter(Boolean);

  let inputLine = null;
  let outputLine = null;

  for (const line of lines) {
    if (line.startsWith('Input:')) {
      inputLine = line.replace(/^Input:\s*/, '').trim();
    } else if (line.startsWith('Output:')) {
      outputLine = line.replace(/^Output:\s*/, '').trim();
    }
  }

  if (!inputLine || !outputLine) return null;

  const args = parseInputLine(inputLine);
  const expected = parseValue(outputLine);

  return { args, expected };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('📂 Reading problems directory...');

  let files;
  try {
    files = await fs.readdir(PROBLEMS_DIR);
  } catch {
    console.error(`❌ Could not read ${PROBLEMS_DIR}. Run from repo root.`);
    process.exit(1);
  }

  const jsonFiles = files.filter(f => f.endsWith('.json')).sort();
  console.log(`Found ${jsonFiles.length} problem files.\n`);

  const stats = { converted: 0, skipped: 0, noExamples: 0, errors: 0 };

  for (const filename of jsonFiles) {
    const filePath = path.join(PROBLEMS_DIR, filename);

    let problem;
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      problem = JSON.parse(raw);
    } catch {
      console.error(`❌ Failed to read/parse ${filename}`);
      stats.errors++;
      continue;
    }

    // Skip if already has test_cases
    if (problem.test_cases && problem.test_cases.length > 0) {
      stats.skipped++;
      continue;
    }

    // Skip if no examples
    if (!problem.examples || problem.examples.length === 0) {
      console.log(`⚠️  [${problem.frontend_id}] No examples — ${problem.title}`);
      stats.noExamples++;
      continue;
    }

    // Parse each example into a test case
    const testCases = [];
    for (const example of problem.examples) {
      if (!example.example_text) continue;
      const parsed = parseExampleText(example.example_text);
      if (parsed && Object.keys(parsed.args).length > 0) {
        testCases.push(parsed);
      }
    }

    if (testCases.length === 0) {
      console.log(`⚠️  [${problem.frontend_id}] Couldn't parse examples — ${problem.title}`);
      stats.errors++;
      continue;
    }

    problem.test_cases = testCases;

    try {
      await fs.writeFile(filePath, JSON.stringify(problem, null, 2), 'utf-8');
      console.log(`✅ [${problem.frontend_id}] ${testCases.length} test cases parsed — ${problem.title}`);
      stats.converted++;
    } catch {
      console.error(`❌ Failed to write ${filename}`);
      stats.errors++;
    }
  }

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50));
  console.log('📊 Summary');
  console.log('─'.repeat(50));
  console.log(`✅ Converted from examples:  ${stats.converted}`);
  console.log(`⏭️  Already had test_cases:   ${stats.skipped}`);
  console.log(`⚠️  No examples to parse:     ${stats.noExamples}`);
  console.log(`❌ Parse errors:              ${stats.errors}`);
  console.log('\nDone! Commit your updated problems/ folder.');
}

main();