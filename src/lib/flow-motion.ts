/**
 * Flow motion: which edges show a moving file icon in the viewer, and how fast it moves.
 *
 * Only edges that stand for something moving get one:
 * - in a process flowchart (one with a start/end node), every one-way arrow, since work
 *   moves from step to step;
 * - in any other flowchart, only edges the author marked with `e1@{ animate: true }`
 *   (an architecture edge may be a dependency such as "implements", which does not move);
 * - in a sequence diagram, every message, one after another in diagram order.
 * State and ER diagrams never move: a transition or relationship is not data in transit.
 */
import type { FlowEdge } from './flowchart.js';

export type FlowSpeed = 'slow' | 'normal' | 'fast';

export const FLOW_MOTION = {
  /** Icon speed in layout pixels per second */
  speed: { slow: 50, normal: 90, fast: 160 } as Record<FlowSpeed, number>,
  /** Shortest trip, in seconds, so the icon on a short edge can still be seen */
  minTrip: 0.8,
  /** Pause after each trip on a flowchart edge, in seconds */
  pause: 1.2,
  /** Pause between two messages of a sequence diagram, in seconds */
  messageGap: 0.3,
  /** The icon stops this far before the end of the line, so it never covers the arrowhead */
  stopBefore: 18,
  /** At most this many moving icons on the canvas; other edges stay static */
  maxIcons: 60,
};

/** Speed of the moving icon on a flowchart edge, or null when the edge stays static */
export function edgeMotion(edge: Pick<FlowEdge, 'style' | 'head' | 'tail' | 'animate' | 'animation'>, processFlowchart: boolean): FlowSpeed | null {
  if (edge.style === 'invisible' || edge.animate === false) return null;
  if (edge.animate) return edge.animation ?? 'normal';
  if (processFlowchart && edge.head !== 'none' && edge.tail === 'none') return 'normal';
  return null;
}

/** Seconds the icon needs to travel a line of the given length */
export function tripSeconds(length: number, speed: FlowSpeed): number {
  return Math.max(FLOW_MOTION.minTrip, length / FLOW_MOTION.speed[speed]);
}
