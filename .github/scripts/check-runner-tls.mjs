import { readFileSync } from 'node:fs';
import { createHash, X509Certificate } from 'node:crypto';
import { request } from 'node:https';

const bundle = readFileSync(process.env.NODE_EXTRA_CA_CERTS, 'utf8');
const roots = bundle.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
const hasInfoWatch = roots.some(pem => new X509Certificate(pem).subject.includes('CN=InfoWatch Transparent Proxy Root'));
console.log(`${process.release.name}: CA count=${roots.length}, InfoWatch=${hasInfoWatch}, bundle SHA256=${createHash('sha256').update(bundle).digest('hex')}`);
const targets = ['https://registry.npmjs.org/'];
if (process.env.ACTIONS_ID_TOKEN_REQUEST_URL) targets.push(new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL).origin + '/');
// Probe only public roots, with no token, authorization header or OIDC URL query.
for (const target of targets) {
  await new Promise((resolve, reject) => {
    const req = request(target, { method: 'HEAD', timeout: 20_000 }, response => {
      response.resume(); console.log(`TLS verified: ${new URL(target).hostname} (${response.statusCode})`); resolve();
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('TLS probe timed out'))); req.end();
  });
}
