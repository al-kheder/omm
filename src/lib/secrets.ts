/**
 * Detect values that look like secrets (keys, tokens, passwords) in text written to `.omm/`.
 * Architecture docs describe *where* credentials are used, never the credentials themselves.
 *
 * The patterns are conservative: they match well-known token formats, and for
 * `password = …`-style assignments only values that look random (letters and digits,
 * no spaces), so prose such as "password: hashed with bcrypt" does not match.
 * Findings never include the matched value.
 */

export interface SecretFinding {
  line: number;
  kind: string;
}

const TOKENS: { kind: string; re: RegExp }[] = [
  { kind: 'private key', re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/ },
  { kind: 'AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/ },
  { kind: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { kind: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: 'Stripe key', re: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/ },
  { kind: 'API key', re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/ },
  { kind: 'JSON Web Token', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
];

// scheme://user:password@host
const URL_CREDENTIALS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s@/]+)@/gi;

// password = value, "apiKey": "value", client_secret: value …
const ASSIGNMENT = /(?<![A-Za-z0-9])(?:password|passwd|pwd|secret|client[_-]?secret|api[_-]?key|access[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)["']?\s*[:=]\s*["']?([^\s"'`,;)}\]]+)/gi;

// References and stand-ins, not values: ${VAR}, $VAR, <password>, ***, process.env.X, secrets.X …
const PLACEHOLDER = /^(?:\$\{?[\w.]+\}?|<[^>]*>|\{\{.*\}\}|%[\w]+%|\*+|x+|\.+|(?:process\.env|os\.environ|secrets|env|vault)\b.*|(?:pass|secret|changeme|example|placeholder|redacted|none|null|true|false|required|optional)\w*)$/i;

function looksRandom(value: string): boolean {
  return value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value) && !PLACEHOLDER.test(value);
}

/** Lines of `text` that look like they contain a secret, with the kind of secret */
export function findSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  text.split('\n').forEach((lineText, i) => {
    const line = i + 1;
    for (const { kind, re } of TOKENS) {
      if (re.test(lineText)) findings.push({ line, kind });
    }
    for (const m of lineText.matchAll(URL_CREDENTIALS)) {
      if (!PLACEHOLDER.test(m[1])) findings.push({ line, kind: 'password in a URL' });
    }
    for (const m of lineText.matchAll(ASSIGNMENT)) {
      if (looksRandom(m[1])) findings.push({ line, kind: 'password or key value' });
    }
  });
  // one finding per line and kind
  return findings.filter((f, i) => findings.findIndex(g => g.line === f.line && g.kind === f.kind) === i);
}
