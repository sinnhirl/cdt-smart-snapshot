/**
 * Depth-limiting prune for snapshot trees.
 *
 * Why: Deep DOM trees explode token counts. Collapsing subtrees past maxDepth into
 * a one-line summary keeps the outline readable while hinting that more structure
 * exists if the agent needs to dig in (raise maxDepth / navigate).
 */

import type {TextSnapshotNode} from '../types.js';

/**
 * Prunes a tree so nodes deeper than maxDepth become collapsed summaries.
 *
 * Why: BFS/DFS depth counting from the root (depth 0) matches how agents read the
 * indented text tree. At maxDepth the node is kept but its children are replaced
 * with collapsed metadata (childCount) for the `[+] "name" (N child nodes, uid=M)` line.
 *
 * @param root - Input snapshot tree.
 * @param maxDepth - Maximum depth to expand (root is depth 0).
 * @returns A new tree with deep subtrees collapsed.
 * @throws Never throws. If maxDepth < 0, the root itself is collapsed.
 */
export function pruneTree(
  root: TextSnapshotNode,
  maxDepth: number,
): TextSnapshotNode {
  return pruneAtDepth(root, 0, maxDepth);
}

/**
 * Recursive helper that tracks current depth.
 *
 * @param node - Current node.
 * @param depth - Depth of `node` (root = 0).
 * @param maxDepth - Maximum expandable depth.
 * @returns Pruned node.
 */
function pruneAtDepth(
  node: TextSnapshotNode,
  depth: number,
  maxDepth: number,
): TextSnapshotNode {
  if (depth >= maxDepth) {
    // At/ past maxDepth: keep leaves as-is; collapse nodes that still have children.
    if (node.children.length === 0) {
      return {...node, children: []};
    }
    return {
      ...node,
      children: [],
      collapsed: true,
      childCount: node.children.length,
    };
  }

  const children: TextSnapshotNode[] = [];
  for (const child of node.children) {
    children.push(pruneAtDepth(child, depth + 1, maxDepth));
  }
  return {...node, children};
}
