import fs from 'fs';

const filePath = 'c:/Users/gleidson.rampinelli/Downloads/BetGuru/BetGuru/src/data/documentation/betguru-docs.json';

try {
  let content = fs.readFileSync(filePath, 'utf8');
  console.log('Original content length:', content.length);

  // Let's replace the problematic LaTeX escaping issues:
  // 1. Any single backslash before % (which is invalid in JSON)
  // Let's search for \ followed by % and replace with \\%
  // Or check if we have triple backslashes like \\\% or similar.
  // Actually, let's see what equations exist in the file:
  // - Poisson: $P(k) = \frac{\lambda^k e^{-\lambda}}{k!}$
  // - Kelly: $f^* = \frac{bp - q}{b}$
  // Let's look at the exact formulas in the content and replace them with properly escaped versions:

  // Let's replace the triple backslash before % with double backslash or single escaped backslash
  content = content.replace(/\\+\%/g, '\\\\%');

  // Let's replace any \text with \\text, \times with \\times, \left with \\left, \right with \\right, \frac with \\frac, \le with \\le, \ge with \\ge, \lambda with \\lambda, \sum with \\sum
  // Let's do this by matching a backslash that is NOT followed by n, r, t, f, b, u, /, ", \
  // We can use a regex with a negative lookahead
  content = content.replace(/\\(?![nrtfbu"/\\])/g, '\\\\');

  // Let's check if there are any remaining triple backslashes that might have been created
  content = content.replace(/\\\\\\+/g, '\\\\');

  try {
    const parsed = JSON.parse(content);
    console.log('JSON parsed successfully! Total sections:', parsed.sections.length);
    fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2), 'utf8');
    console.log('JSON written back clean and formatted.');
  } catch (err) {
    console.log('Error parsing JSON after first cleanup pass:', err.message);
    const match = err.message.match(/position (\d+)/);
    if (match) {
      const pos = parseInt(match[1], 10);
      console.log('Error around position:', pos);
      console.log('Snippet:', content.substring(Math.max(0, pos - 80), Math.min(content.length, pos + 80)));
    }
  }
} catch (e) {
  console.error(e);
}
