/**
 * omm evidence deployment [--json] — list the files that describe how and where this
 * project is deployed, with the facts read from them (see src/lib/evidence.ts).
 * Read-only; does not need .omm/.
 */

import { collectDeploymentEvidence, type DeploymentEvidence } from '../lib/evidence.js';

const list = (xs: (string | undefined)[]) => xs.filter(Boolean).join(', ');

function print(ev: DeploymentEvidence): string {
  const out: string[] = [];
  const section = (title: string, lines: string[]) => { if (lines.length) out.push(`${title}:`, ...lines.map(l => `  ${l}`), ''); };

  if (!ev.found) {
    out.push(`No deployment evidence found (${ev.scannedFiles} files checked).`,
      'Nothing says where this project runs, so do not create a deployment perspective.', '');
  }
  section('Containers (Dockerfile)', ev.dockerfiles.map(d =>
    `${d.path}: ${d.stages.map(s => s.name ? `${s.image} as ${s.name}` : s.image).join(' → ')}` +
    (d.expose.length ? ` · expose ${d.expose.join(', ')}` : '') + (d.cmd ? ` · cmd ${d.cmd}` : d.entrypoint ? ` · entrypoint ${d.entrypoint}` : '')));
  section('Docker Compose', ev.compose.flatMap(c => [
    `${c.path}${c.variant ? ` (${c.variant})` : ''}`,
    ...c.services.map(s => `  ${s.name}: ${s.image ?? `build ${s.build}`}` +
      (s.ports.length ? ` · ports ${s.ports.join(', ')}` : '') +
      (s.dependsOn.length ? ` · depends on ${s.dependsOn.join(', ')}` : '') +
      (s.networks.length ? ` · networks ${s.networks.join(', ')}` : '') +
      (s.envKeys.length ? ` · env ${s.envKeys.join(', ')}` : '') +
      (s.replicas ? ` · ${s.replicas} replicas` : '')),
  ]));
  section('Kubernetes', ev.kubernetes.map(k => {
    const parts = [`${k.kind} ${k.name}${k.namespace ? ` (ns ${k.namespace})` : ''}`];
    if (k.containers?.length) parts.push(k.containers.map(c => `${c.name} ${c.image ?? ''}${c.ports.length ? ` :${c.ports.join(',')}` : ''}`.trim()).join('; '));
    if (k.replicas !== undefined) parts.push(`${k.replicas} replicas`);
    if (k.schedule) parts.push(`schedule ${k.schedule}`);
    if (k.serviceType) parts.push(`${k.serviceType} ${k.ports?.join(', ') ?? ''}`.trim());
    if (k.rules?.length) parts.push(k.rules.map(r => `${r.host ?? '*'}${r.path ?? ''} → ${r.service ?? '?'}:${r.port ?? '?'}`).join('; '));
    if (k.note) parts.push(k.note);
    return `${k.path}: ${parts.join(' · ')}`;
  }));
  section('Helm', ev.helm.map(h => `${h.path}: ${list([h.name, h.version && `v${h.version}`, h.appVersion && `app ${h.appVersion}`])}` +
    (h.dependencies.length ? ` · depends on ${h.dependencies.join(', ')}` : '') + (h.valuesFiles.length ? ` · values ${h.valuesFiles.join(', ')}` : '')));
  section('Terraform', ev.terraform.filter(t => t.resources.length || t.modules.length || t.providers.length || t.backend).map(t =>
    `${t.path}: ${list([t.providers.length ? `providers ${t.providers.join(', ')}` : undefined, t.backend && `backend ${t.backend}`,
      t.resources.length ? `resources ${t.resources.map(r => `${r.type}.${r.name}`).join(', ')}` : undefined,
      t.modules.length ? `modules ${t.modules.map(m => m.source ? `${m.name} (${m.source})` : m.name).join(', ')}` : undefined])}`));
  section('Serverless', ev.serverless.flatMap(s => [
    `${s.path}: ${list([s.service, s.provider, s.runtime, s.region, s.stage && `stage ${s.stage}`])}`,
    ...s.functions.map(f => `  ${f.name}${f.handler ? ` (${f.handler})` : ''}${f.events.length ? ` ← ${f.events.join(', ')}` : ''}`),
  ]));
  section('Processes (Procfile)', ev.processes.map(p => `${p.path}: ${p.process} → ${p.command}`));
  section('Hosting platforms', ev.platforms.map(p => `${p.path}: ${p.platform}` +
    (Object.keys(p.facts).length ? ` · ${Object.entries(p.facts).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ')}` : '')));
  section('Reverse proxies', ev.proxies.map(p => `${p.path}: ${p.server}` + (p.sites.length ? ` · sites ${p.sites.join(', ')}` : '') +
    (p.listen.length ? ` · listen ${p.listen.join(', ')}` : '') + (p.upstreams.length ? ` · → ${p.upstreams.join(', ')}` : '')));
  section('Deploy jobs (CI/CD)', ev.ci.flatMap(c => c.deployJobs.map(j => `${c.path} (${c.system}): ${j.job}` +
    (j.environment ? ` · environment ${j.environment}` : '') + (j.uses.length ? ` · uses ${j.uses.join(', ')}` : '') + (j.tools.length ? ` · runs ${j.tools.join(', ')}` : ''))));
  section('Packages', ev.packages.filter(p => p.bin.length || p.scripts.length).map(p => `${p.path}: ${p.name ?? '(no name)'}` +
    (p.bin.length ? ` · commands ${p.bin.join(', ')}` : '') + (p.scripts.length ? ` · scripts ${p.scripts.map(s => s.tools.length ? `${s.name} (${s.tools.join(', ')})` : s.name).join(', ')}` : '') +
    (p.publish ? ' · publishable' : '')));
  section('Environment files', ev.envFiles.map(e => e.read ? `${e.path}: keys ${e.keys.join(', ') || '(none)'}` : `${e.path}: not opened (may hold secrets)`));
  section('Environments', ev.environments.map(e => `${e.name}: ${e.sources.join(', ')}`));
  section('Warnings', ev.warnings.map(w => (w.path ? `${w.path}: ` : '') + w.message));
  if (ev.found) out.push(`${ev.sources.length} source file${ev.sources.length === 1 ? '' : 's'} (${ev.scannedFiles} files checked). Facts only: connections between parts that no file states are not listed.`);
  return out.join('\n').trimEnd() + '\n';
}

export function commandEvidence(topic?: string, flags: string[] = []): void {
  if (topic !== 'deployment') {
    process.stderr.write('error: omm evidence deployment [--json]\n');
    process.exit(1);
  }
  const ev = collectDeploymentEvidence(process.cwd());
  process.stdout.write(flags.includes('--json') ? JSON.stringify(ev, null, 2) + '\n' : print(ev));
}
