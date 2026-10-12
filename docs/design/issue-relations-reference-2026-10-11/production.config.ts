import { defineConfig } from '@playwright/test';
import base from '../../../playwright.production.config';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
export default defineConfig({...base,testDir:root+'e2e',testMatch:['issue-relations.pw.ts','issue-refresh.pw.ts'],outputDir:root+'docs/design/issue-relations-reference-2026-10-11/playwright-results',webServer:{...base.webServer,cwd:root},workers:2});
