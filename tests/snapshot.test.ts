import {describe, expect, it} from 'vitest';

import {formatTree, runSmartSnapshotPipeline} from '../src/core/snapshot.js';
import {UidMapper} from '../src/core/uid.js';
import type {
  ElementVisibilityInfo,
  SnapshotOptions,
  TextSnapshotNode,
} from '../src/types.js';

/**
 * Builds a node.
 * @param uid - Uid.
 * @param role - Role.
 * @param name - Name.
 * @param children - Children.
 * @returns TextSnapshotNode.
 */
function node(
  uid: number,
  role: string,
  name: string,
  children: TextSnapshotNode[] = [],
): TextSnapshotNode {
  return {uid, role, name, children, visible: true, offscreen: false};
}

const defaultOptions: SnapshotOptions = {
  maxDepth: 8,
  includeHidden: false,
  verbose: false,
};

describe('snapshot', () => {
  it('shouldProduceFormattedTreeWithRolesNamesUids', () => {
    const tree = node(1, 'Document', 'example.com', [
      node(12, 'button', 'Compose'),
      node(15, 'link', 'Inbox'),
    ]);
    const text = formatTree(tree);
    expect(text).toContain('[Document] example.com');
    expect(text).toContain('[button] "Compose" (uid=12)');
    expect(text).toContain('[link] "Inbox" (uid=15)');
  });

  it('shouldApplyAllFourPipelinesInOrder', () => {
    // Tree mixes: hidden node, generic container, duplicate links, deep nesting.
    const deep: TextSnapshotNode = {
      uid: 50,
      role: 'link',
      name: 'Deep',
      children: [],
      visible: true,
      offscreen: false,
    };
    let chain = deep;
    // Build depth so prune with maxDepth=3 collapses.
    for (let i = 0; i < 5; i++) {
      chain = {
        uid: 40 + i,
        role: 'article',
        name: `L${String(i)}`,
        children: [chain],
        visible: true,
        offscreen: false,
      };
    }

    const tree: TextSnapshotNode = {
      uid: 1,
      role: 'Document',
      name: 'page',
      visible: true,
      offscreen: false,
      children: [
        {
          uid: 2,
          role: 'generic',
          name: '',
          visible: true,
          offscreen: false,
          children: [
            {
              uid: 3,
              role: 'button',
              name: 'OK',
              children: [],
              visible: true,
              offscreen: false,
            },
            {
              uid: 4,
              role: 'link',
              name: 'Dup',
              children: [],
              visible: true,
              offscreen: false,
            },
            {
              uid: 5,
              role: 'link',
              name: 'Dup',
              children: [],
              visible: true,
              offscreen: false,
            },
            {
              uid: 6,
              role: 'button',
              name: 'HiddenBtn',
              children: [],
              visible: false,
              offscreen: false,
            },
          ],
        },
        chain,
      ],
    };

    const {formatted, root} = runSmartSnapshotPipeline(tree, {
      ...defaultOptions,
      maxDepth: 3,
    });

    // Interaction: generic collapsed, button/link kept.
    expect(formatted).toContain('[button] "OK"');
    expect(formatted).not.toContain('generic');
    // Visibility: hidden button dropped.
    expect(formatted).not.toContain('HiddenBtn');
    // Dedupe: Dup ×2
    expect(formatted).toMatch(/Dup".*×2|×2.*"Dup"/);
    // Prune: collapsed marker somewhere for deep chain.
    expect(formatted).toContain('[+]');
    expect(root.role).toBe('Document');
  });

  it('shouldIncludeHiddenWhenRequested', () => {
    const tree = node(1, 'Document', 'page', [
      {
        uid: 2,
        role: 'button',
        name: 'Visible',
        children: [],
        visible: true,
        offscreen: false,
      },
      {
        uid: 3,
        role: 'button',
        name: 'Secret',
        children: [],
        visible: false,
        offscreen: false,
      },
    ]);

    const hidden = runSmartSnapshotPipeline(tree, {
      ...defaultOptions,
      includeHidden: false,
    });
    expect(hidden.formatted).not.toContain('Secret');

    const shown = runSmartSnapshotPipeline(tree, {
      ...defaultOptions,
      includeHidden: true,
    });
    expect(shown.formatted).toContain('Secret');
  });
});

describe('snapshot with visibility map', () => {
  it('applies visibility from info map before filtering', () => {
    const mapper = new UidMapper();
    const uid1 = mapper.getUid(10);
    const uid2 = mapper.getUid(20);
    const tree: TextSnapshotNode = {
      uid: uid1,
      role: 'Document',
      name: 'p',
      children: [{uid: uid2, role: 'button', name: 'X', children: []}],
    };
    const info = new Map<number, ElementVisibilityInfo>([
      [
        uid1,
        {
          display: 'block',
          visibility: 'visible',
          opacity: 1,
          rect: {
            top: 0,
            left: 0,
            bottom: 100,
            right: 100,
            width: 100,
            height: 100,
          },
          viewportWidth: 800,
          viewportHeight: 600,
        },
      ],
      [
        uid2,
        {
          display: 'none',
          visibility: 'visible',
          opacity: 1,
          rect: {top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0},
          viewportWidth: 800,
          viewportHeight: 600,
        },
      ],
    ]);
    const result = runSmartSnapshotPipeline(tree, defaultOptions, info);
    expect(result.formatted).not.toContain('"X"');
  });
});
