import { describe, it, expect } from 'vitest';
import { findSecrets } from '../lib/secrets.js';
import { validateDiagram } from '../lib/validate.js';

// Fake values are assembled at run time, so this file holds no token-shaped strings
const rnd = (n: number) => 'a1B2c3D4e5'.repeat(Math.ceil(n / 10)).slice(0, n);
const FAKE = {
  github: 'gh' + 'p_' + rnd(36),
  aws: 'AK' + 'IA' + 'ABCDEFGH12345678',
  slack: 'xo' + 'xb-' + rnd(24),
  google: 'AI' + 'za' + rnd(35),
  stripe: 'sk' + '_live_' + rnd(24),
  apiKey: 's' + 'k-ant-' + rnd(40),
  jwt: 'ey' + 'J' + rnd(20) + '.ey' + 'J' + rnd(20) + '.' + rnd(20),
  pem: '-----BEGIN ' + 'RSA PRIVATE KEY-----',
};

const kinds = (text: string) => findSecrets(text).map(f => f.kind);

describe('findSecrets', () => {
  it('finds well-known token formats', () => {
    expect(kinds(FAKE.github)).toEqual(['GitHub token']);
    expect(kinds(`key ${FAKE.aws}`)).toEqual(['AWS access key']);
    expect(kinds(FAKE.slack)).toEqual(['Slack token']);
    expect(kinds(FAKE.google)).toEqual(['Google API key']);
    expect(kinds(FAKE.stripe)).toEqual(['Stripe key']);
    expect(kinds(FAKE.apiKey)).toEqual(['API key']);
    expect(kinds(FAKE.jwt)).toEqual(['JSON Web Token']);
    expect(kinds(FAKE.pem)).toEqual(['private key']);
  });

  it('finds passwords in URLs and random-looking assigned values', () => {
    expect(kinds('postgres://app:' + 'Sup3rS3cret' + '@db:5432/app')).toEqual(['password in a URL']);
    expect(kinds('DB_PASSWORD=' + 'k9Xp2mQ7vL')).toEqual(['password or key value']);
    expect(kinds('"apiKey": "' + 'f83kd92kd02' + '"')).toEqual(['password or key value']);
  });

  it('reports line numbers, never the value', () => {
    const found = findSecrets(`flowchart LR\n  a --> b\n  c["${FAKE.github}"]`);
    expect(found).toEqual([{ line: 3, kind: 'GitHub token' }]);
    expect(JSON.stringify(found)).not.toContain(FAKE.github);
  });

  it('ignores references, placeholders and prose', () => {
    for (const text of [
      'password: hashed with bcrypt',
      'api_key: required',
      'DB_PASSWORD=${DB_PASSWORD}',
      'password: $DB_PASSWORD',
      'secret: <your-secret>',
      'token = process.env.API_TOKEN',
      'client_secret: ${{ secrets.CLIENT_SECRET }}',
      'postgres://user:password@db:5432/app',
      'postgres://app:${DB_PASSWORD}@db/app',
      'https://user:pass@example.com',
      'redis://cache:6379',
      'Reads the API key from the OMM_API_KEY environment variable',
      'api -->|"Bearer token"| cloud',
      'password: ********',
    ]) expect(kinds(text), text).toEqual([]);
  });
});

describe('secret-value rule', () => {
  it('makes a diagram with a secret invalid, in any diagram type', () => {
    for (const text of [
      `flowchart LR\n  api -->|"token ${FAKE.github}"| gh`,
      `sequenceDiagram\n  a->>b: login with ${FAKE.stripe}`,
      `erDiagram\n  USER {\n    string password "default k9Xp2mQ7vL"\n  }\n  %% password=k9Xp2mQ7vL`,
    ]) {
      const r = validateDiagram(text);
      expect(r.valid, text).toBe(false);
      expect(r.issues.some(i => i.rule === 'secret-value' && i.level === 'error'), text).toBe(true);
    }
  });

  it('leaves ordinary diagrams alone', () => {
    const r = validateDiagram('flowchart LR\n  api -->|"reads DB_PASSWORD from env"| db[(Postgres)]');
    expect(r.issues.filter(i => i.rule === 'secret-value')).toEqual([]);
  });
});
