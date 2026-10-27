import { describe, it, expect } from 'vitest';
import { edgeMotion, tripSeconds, FLOW_MOTION } from '../lib/flow-motion.js';
import { parseFlowchart } from '../lib/flowchart.js';
import { isProcessFlowchart } from '../lib/palette.js';

// Which edges of a flowchart get a moving icon, by edge "from->to"
function moving(text: string): Record<string, string | null> {
  const fc = parseFlowchart(text);
  const process = isProcessFlowchart([...fc.nodes.values()].map(n => n.shape));
  return Object.fromEntries(fc.edges.map(e => [`${e.from}->${e.to}`, edgeMotion(e, process)]));
}

describe('edgeMotion', () => {
  it('moves every one-way arrow of a process flowchart', () => {
    expect(moving(`flowchart TD
      s([Start]) --> a[Check]
      a --> q{OK?}
      q -->|Yes| done([End])
      q -.->|No| a
      a ==> log[(Log)]
      a --o note[Note]`)).toEqual({
      's->a': 'normal', 'a->q': 'normal', 'q->done': 'normal', 'q->a': 'normal', 'a->log': 'normal', 'a->note': 'normal',
    });
  });

  it('keeps two-way, undirected and invisible edges still', () => {
    expect(moving(`flowchart TD
      s([Start]) <--> a[Sync]
      a --- b[Linked]
      b ~~~ c[Spacer]`)).toEqual({ 's->a': null, 'a->b': null, 'b->c': null });
  });

  it('moves only marked edges in an architecture diagram', () => {
    expect(moving(`flowchart LR
      web e1@-->|upload file| api
      api e2@-->|store file| files
      api -->|implements| iface
      e1@{ animate: true }
      e2@{ animation: slow }`)).toEqual({ 'web->api': 'normal', 'api->files': 'slow', 'api->iface': null });
  });

  it('lets animate: false keep a process arrow still, and animate: true move a two-way edge', () => {
    expect(moving(`flowchart TD
      s([Start]) e1@--> a[Step]
      a e2@<--> b[Peer]
      e1@{ animate: false }
      e2@{ animation: fast }`)).toEqual({ 's->a': null, 'a->b': 'fast' });
  });
});

describe('tripSeconds', () => {
  it('uses the speed setting, with a minimum for short edges', () => {
    expect(tripSeconds(180, 'normal')).toBeCloseTo(180 / FLOW_MOTION.speed.normal);
    expect(tripSeconds(180, 'slow')).toBeGreaterThan(tripSeconds(180, 'fast'));
    expect(tripSeconds(5, 'fast')).toBe(FLOW_MOTION.minTrip);
  });
});
