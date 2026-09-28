// Anchor grammar: parse and resolve "<event>[:<pet>[:<gif>]][+-ms]" strings.
// Browser-safe (see schema.ts's header comment — no Node imports here).
//
// Frozen from this bead's commit on (video/README.md).

import { isObservedKind, type Events, type ObservedEvent, type ObservedKind } from './schema';

export const MOUSE_KINDS = ['mousedown', 'mouseup', 'click', 'dblclick'] as const;
export type MouseKind = (typeof MOUSE_KINDS)[number];

/** Resolved by the edit, not the recorder — see conventions.anchors in shots.json. */
export const EDIT_ONLY_ANCHORS = ['in', 'end', 'cursor_depart', 'ball_in_frame', 'catch_point'] as const;
export type EditOnlyAnchor = (typeof EDIT_ONLY_ANCHORS)[number];

export type ParsedAnchor =
  | { kind: 'event'; event: ObservedKind; pet?: string; gif?: string; offsetMs: number }
  | { kind: 'mouse'; mouseKind: MouseKind; offsetMs: number }
  | { kind: 'edit'; name: EditOnlyAnchor; offsetMs: number };

const ANCHOR_RE = /^(\w+)(?::(\w+))?(?::(\w+))?([+-]\d+)?$/;

/**
 * Parses an anchor spec into its structured form. Throws on malformed
 * syntax or an unrecognised event/mouse-kind/edit-anchor name — anchors are
 * hand-written into shots.json, so a typo should fail loudly rather than
 * silently resolving to nothing.
 */
export function parseAnchor(spec: string): ParsedAnchor {
  const match = ANCHOR_RE.exec(spec);
  if (!match) {
    throw new Error(`anchor "${spec}" does not match the anchor grammar`);
  }
  const [, name, part2, part3, offsetStr] = match;
  const offsetMs = offsetStr ? parseInt(offsetStr, 10) : 0;

  if (name === 'mouse') {
    if (!part2 || !(MOUSE_KINDS as readonly string[]).includes(part2)) {
      throw new Error(`anchor "${spec}": "mouse:" must be followed by one of ${MOUSE_KINDS.join(', ')}`);
    }
    if (part3) {
      throw new Error(`anchor "${spec}": the mouse alias takes no third segment`);
    }
    return { kind: 'mouse', mouseKind: part2 as MouseKind, offsetMs };
  }

  if ((EDIT_ONLY_ANCHORS as readonly string[]).includes(name)) {
    if (part2 || part3) {
      throw new Error(`anchor "${spec}": edit-only anchors take no pet or gif segment`);
    }
    return { kind: 'edit', name: name as EditOnlyAnchor, offsetMs };
  }

  if (!isObservedKind(name)) {
    throw new Error(`anchor "${spec}": "${name}" is not a known event, the mouse alias, or an edit-only anchor`);
  }

  return { kind: 'event', event: name, pet: part2, gif: part3, offsetMs };
}

function matchesObserved(event: ObservedEvent, parsed: Extract<ParsedAnchor, { kind: 'event' }>): boolean {
  if (event.kind !== parsed.event) return false;
  if (parsed.pet !== undefined && event.pet !== parsed.pet) return false;
  if (parsed.gif !== undefined && event.to !== parsed.gif) return false;
  return true;
}

/**
 * Resolves a recorder anchor (event or mouse alias) against a recorded
 * Events document, returning the matched event's t plus the anchor's
 * offset. Throws for an edit-only anchor (conventions.anchors: "resolved
 * by the edit, not the recorder") or when nothing in `observed` matches.
 */
export function resolveAnchor(spec: string, events: Events): number {
  const parsed = parseAnchor(spec);

  if (parsed.kind === 'edit') {
    throw new Error(`anchor "${spec}" is edit-only and is not resolved against Events`);
  }

  if (parsed.kind === 'mouse') {
    const match = events.observed.find((event) => event.kind === parsed.mouseKind);
    if (!match) {
      throw new Error(`anchor "${spec}": no observed "${parsed.mouseKind}" event`);
    }
    return match.t + parsed.offsetMs;
  }

  const match = events.observed.find((event) => matchesObserved(event, parsed));
  if (!match) {
    throw new Error(`anchor "${spec}": no matching observed event`);
  }
  return match.t + parsed.offsetMs;
}
