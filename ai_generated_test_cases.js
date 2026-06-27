/**
 * ai_generate_testcases.js
 *
 * For the ~209 problems where examples couldn't be parsed,
 * this script uses Groq API to generate structured test cases
 * from the problem description + examples text.
 *
 * Usage:
 *   export GROQ_API_KEY=gsk_...
 *   node ai_generate_testcases.js
 *
 * It will ONLY touch files that still have NO test_cases.
 */

import fs from 'fs/promises';
import path from 'path';

const PROBLEMS_DIR = './problems';
const DELAY_MS = 6000;    // 6s between requests = ~10 req/min, safe under TPM limit
const MAX_RETRIES = 4;    // retry up to 4 times on 429
const RETRY_BASE_MS = 5000; // base wait on 429, doubles each retry

// ─── Groq API Call ────────────────────────────────────────────────────────────

async function generateTestCases(problem) {
  const examplesText = problem.examples
    .map(e => `Example ${e.example_num}:\n${e.example_text}`)
    .join('\n\n');

  const prompt = `You are given a LeetCode problem. Generate structured test cases from it.

Problem: ${problem.title}
Difficulty: ${problem.difficulty}

Description:
${problem.description}

Examples:
${examplesText}

Constraints:
${problem.constraints?.join('\n') || 'N/A'}

Code signature (JavaScript):
${problem.code_snippets?.javascript || ''}

Your task:
- Extract or infer test cases from the examples above.
- Return ONLY a valid JSON array of test cases. No explanation, no markdown, no code fences.
- Each test case must follow this exact format:
  { "args": { "param1": value1, "param2": value2 }, "expected": expectedValue }
- The "args" keys must match the function parameter names from the JavaScript code signature.
- Values must be valid JSON (strings, numbers, arrays, booleans, null).
- Generate between 2 and 5 test cases.
- If the problem has multiple valid answers (e.g. "aba" or "bab"), use the first example's output as expected.

Return ONLY the JSON array, nothing else.`;

  try {
    // ── Retry loop with exponential backoff on 429 ──
    let data;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 1024,
          temperature: 0,
          messages: [
            {
              role: 'system',
              content: 'You are a precise JSON generator. You output only valid JSON arrays, no explanation, no markdown.',
            },
            { role: 'user', content: prompt },
          ],
        }),
      });

      if (response.status === 429) {
        // Parse retry-after from error body if available
        const errBody = await response.json().catch(() => ({}));
        const waitMs = RETRY_BASE_MS * attempt;
        process.stdout.write(`\n  ⏳ Rate limited (attempt ${attempt}/${MAX_RETRIES}), waiting ${waitMs / 1000}s... `);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`API error ${response.status}: ${err}`);
      }

      data = await response.json();
      break; // success
    }

    if (!data) throw new Error(`Failed after ${MAX_RETRIES} retries (rate limit)`);

    const rawText = data.choices?.[0]?.message?.content?.trim();
    if (!rawText) throw new Error('Empty response from Groq');

    // Strip any accidental markdown fences
    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('Response is not a non-empty array');
    }

    // Validate structure
    for (const tc of parsed) {
      if (!tc.args || typeof tc.args !== 'object') {
        throw new Error('Test case missing args object');
      }
      if (!('expected' in tc)) {
        throw new Error('Test case missing expected field');
      }
    }

    return parsed;
  } catch (err) {
    throw new Error(`Generation failed: ${err.message}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.GROQ_API_KEY) {
    console.error('❌ GROQ_API_KEY env var not set.');
    console.error('   export GROQ_API_KEY=gsk_...');
    console.error('   Get your key at: https://console.groq.com/keys');
    process.exit(1);
  }

  console.log('📂 Reading problems directory...');

  let files;
  try {
    files = await fs.readdir(PROBLEMS_DIR);
  } catch {
    console.error(`❌ Could not read ${PROBLEMS_DIR}. Run from repo root.`);
    process.exit(1);
  }

  const jsonFiles = files.filter(f => f.endsWith('.json')).sort();

  // Find only problems that still have no test_cases
  const targets = [];
  for (const filename of jsonFiles) {
    const filePath = path.join(PROBLEMS_DIR, filename);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const problem = JSON.parse(raw);
      if (!problem.test_cases || problem.test_cases.length === 0) {
        targets.push({ filename, filePath, problem });
      }
    } catch {
      // skip unreadable files
    }
  }

  console.log(`Found ${targets.length} problems still missing test_cases.\n`);

  if (targets.length === 0) {
    console.log('✅ All problems already have test cases!');
    return;
  }

  const stats = { generated: 0, failed: 0 };
  const failedList = [];

  for (let i = 0; i < targets.length; i++) {
    const { filePath, problem } = targets[i];
    const prefix = `[${i + 1}/${targets.length}] [${problem.frontend_id}]`;

    process.stdout.write(`${prefix} Generating for "${problem.title}"... `);

    try {
      const testCases = await generateTestCases(problem);
      problem.test_cases = testCases;

      await fs.writeFile(filePath, JSON.stringify(problem, null, 2), 'utf-8');
      console.log(`✅ ${testCases.length} test cases`);
      stats.generated++;
    } catch (err) {
      console.log(`❌ ${err.message}`);
      stats.failed++;
      failedList.push(`${problem.frontend_id} — ${problem.title}`);
    }

    // Delay between requests
    if (i < targets.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50));
  console.log('📊 Summary');
  console.log('─'.repeat(50));
  console.log(`✅ AI Generated:   ${stats.generated}`);
  console.log(`❌ Failed:         ${stats.failed}`);

  if (failedList.length > 0) {
    console.log('\nFailed problems (manual review needed):');
    failedList.forEach(p => console.log(`  · ${p}`));
  }

  console.log('\nDone! Commit your updated problems/ folder.');
}

main();