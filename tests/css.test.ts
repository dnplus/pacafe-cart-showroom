import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sheets = execFileSync('git', ['ls-files', '*.css'], { encoding: 'utf8' }).trim().split('\n');

describe('stylesheets', () => {
  // The build's CSS minifier (lightningcss) folds `translate` into a `transform` in the same rule and drops it, so the rule's translate never applies.
  it('never set translate and transform in the same rule', () => {
    const both = sheets.flatMap(file => [...readFileSync(file, 'utf8').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /(^|;)\s*translate\s*:/.test(body) && /(^|;)\s*transform\s*:/.test(body))
      .map(([, selector]) => `${file}: ${selector.trim()}`));
    expect(both).toEqual([]);
  });
});
