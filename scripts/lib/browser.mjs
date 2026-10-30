import { chromium } from 'playwright-core';

/** Headless Chromium drawing WebGL in software (SwiftShader), so it works on machines without a GPU. */
export function launchBrowser() {
  return chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
}
