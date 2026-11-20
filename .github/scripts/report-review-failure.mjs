import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The SDK transcript stays on the runner. Never print its messages, prompts,
// paths or error text: GitHub logs receive only one fixed category below.
let category = 'diagnostic-unavailable';
try {
  const messages = JSON.parse(readFileSync(join(process.env.RUNNER_TEMP, 'claude-execution-output.json'), 'utf8'));
  const errors = Array.isArray(messages) ? messages.filter(message =>
    message?.type === 'result' && (message.is_error || message.subtype !== 'success') ||
    message?.type === 'assistant' && (message.error || message.isApiErrorMessage),
  ) : [];
  const text = errors.map(message => JSON.stringify({
    result: message.result, errors: message.errors, error: message.error,
    content: message.type === 'assistant' ? message.message?.content : undefined,
  })).join('\n');
  category = /authentication|unauthorized|invalid.?token|token.{0,40}expired|\b401\b/i.test(text) ? 'authentication'
    : /credit balance|billing|payment|insufficient_quota/i.test(text) ? 'billing'
    : /rate.?limit|usage.?limit|limit.{0,30}(reached|exceeded)|out of.{0,30}usage|\b429\b/i.test(text) ? 'rate-limit'
    : /model.{0,50}(not found|unavailable|unsupported)|invalid.{0,20}model/i.test(text) ? 'model-unavailable'
    : /overloaded|service.?unavailable|internal.server.error|\b50[02349]\b|\b529\b/i.test(text) ? 'service-unavailable'
    : 'unclassified';
} catch {
  // Missing/malformed output must not expose raw JSON through an exception.
}
console.log(`Reviewer failure category: ${category}`);
