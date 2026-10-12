import {defineConfig} from '@playwright/test';
import base from '../../../playwright.production.config';
const root=new URL('../../../',import.meta.url).pathname.replace(/^\/([A-Za-z]:\/)/,'$1');
export default defineConfig({...base,testDir:root+'e2e',testMatch:['roadmap-connections.pw.ts','roadmap-refresh.pw.ts'],outputDir:root+'docs/design/timeline-roadmap-2026-10-11/playwright-results',webServer:{...base.webServer,cwd:root},workers:2});
