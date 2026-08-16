// Graph layout, shared by every domain emitter.
//
// A spec names wiring, not coordinates. Both the Material Editor and Niagara draw a graph
// left to right along its dependency chain, so the same layout serves both: only the node
// metrics differ, and those are parameters.

// Nodes with no explicit position are laid out in dependency order, left to right, so a
// spec only has to name the wiring. Columns come from dependency depth; rows are then
// relaxed towards the average height of each node's neighbours, which pulls a parameter up
// beside the node it feeds instead of stacking every source in one very tall first column.
//
// A spec that names blocks gets one band per block, packed across the page and wrapped, so it
// reads left to right and then down. That is also what lets a comment box wrap a block: its
// members end up contiguous, so the box is just their bounding rectangle.
//
// `links` only has to expose `{ from: { id }, to: { id } }` -- whatever else a domain hangs
// off a link is ignored here.
export const autoLayout = (nodes, links, {
  columnGap = 260, rowGap = 170, bandGap = 340,
  laneColumns = 24, bandColumns = 2, sweeps = 6,
} = {}) => {
  const upstream = new Map(nodes.map((n) => [n.id, []]));
  const downstream = new Map(nodes.map((n) => [n.id, []]));
  for (const { from, to } of links) {
    upstream.get(to.id).push(from.id);
    downstream.get(from.id).push(to.id);
  }

  // Layer by distance to the *output*, not from the inputs, then flip. Measuring from the
  // inputs would drop every constant and parameter into column zero however late it is
  // consumed, stranding it far from the node it feeds; measuring to the output puts each one
  // directly in front of its consumer, which is how the Material Editor reads.
  //
  // The distance is measured *inside* a block. Measuring it across the whole graph squeezed each
  // block into whichever two or three columns its own chain happened to land on while the
  // bands stacked downwards, so a seven-stage graph came out as one very tall ribbon. Blocks
  // reach each other through named reroutes rather than wires, so each is free to start again
  // from its own left edge.
  const depthWithin = (members) => {
    const inside = new Set(members.map((n) => n.id));
    const height = new Map();
    const resolve = (id, seen = new Set()) => {
      if (height.has(id)) return height.get(id);
      if (seen.has(id)) return 0; // a cycle cannot happen in a material, but never hang on one
      seen.add(id);
      const children = (downstream.get(id) ?? []).filter((c) => inside.has(c));
      const h = children.length ? Math.max(...children.map((c) => resolve(c, seen))) + 1 : 0;
      height.set(id, h);
      return h;
    };
    members.forEach((n) => resolve(n.id));
    const tallest = Math.max(...members.map((n) => height.get(n.id)));
    return new Map(members.map((n) => [n.id, tallest - height.get(n.id)]));
  };

  // Columns come from that depth; rows are then relaxed towards the average height of each
  // node's neighbours, which pulls a parameter up beside the node it feeds instead of stacking
  // every source in one very tall first column.
  const arrange = (members) => {
    const depth = depthWithin(members);
    const columns = new Map();
    for (const node of members) {
      const c = depth.get(node.id);
      columns.set(c, [...(columns.get(c) ?? []), node]);
    }
    const row = new Map();
    for (const [, group] of columns) group.forEach((n, i) => row.set(n.id, i));

    const order = [...columns.keys()].sort((a, b) => a - b);
    // Keep the barycentre ordering but push rows apart so two nodes never share a slot.
    const settle = (group) => {
      group.sort((a, b) => row.get(a.id) - row.get(b.id));
      let previous = -Infinity;
      for (const node of group) {
        const y = Math.max(row.get(node.id), previous + 1);
        row.set(node.id, y);
        previous = y;
      }
    };
    for (let sweep = 0; sweep < sweeps; sweep++) {
      const columnOrder = sweep % 2 ? order : [...order].reverse();
      for (const c of columnOrder) {
        for (const node of columns.get(c)) {
          // A neighbour in another band has no row here, and pulling towards it would drag the
          // node out of its own block — so only same-band neighbours count.
          const neighbours = [...upstream.get(node.id), ...downstream.get(node.id)]
            .map((id) => row.get(id))
            .filter((v) => v !== undefined);
          if (neighbours.length) {
            row.set(node.id, neighbours.reduce((a, b) => a + b, 0) / neighbours.length);
          }
        }
        settle(columns.get(c));
      }
    }
    for (const [id, y] of row) row.set(id, Math.round(y));
    return { depth, row };
  };

  // Bands run in the order the spec first mentions each block. Deriving the order from depth
  // instead reads backwards as soon as a block ends in a named reroute declaration: a
  // declaration is consumed by nothing, so it sits at the far right and drags its block's
  // depth with it. The author's order is both predictable and the one they meant.
  const bands = [...new Set(nodes.map((n) => n.block ?? ""))]
    .map((name) => ({ name, members: nodes.filter((n) => (n.block ?? "") === name) }));

  // Bands are packed across a lane until the next one would not fit, then wrapped, so the page
  // reads left to right and then down — the order the blocks were written in.
  let laneTop = 0;
  let laneHeight = 0;
  let column = 0;
  for (const band of bands) {
    const { depth, row } = arrange(band.members);
    const width = Math.max(...band.members.map((n) => depth.get(n.id))) + 1;
    const height = Math.max(...band.members.map((n) => row.get(n.id))) + 1;

    if (column > 0 && column + width > laneColumns) {
      laneTop += laneHeight * rowGap + bandGap;
      laneHeight = 0;
      column = 0;
    }
    for (const node of band.members) {
      if (node.x !== undefined && node.y !== undefined) continue;
      node.x = (column + depth.get(node.id)) * columnGap;
      node.y = laneTop + row.get(node.id) * rowGap;
    }
    column += width + bandColumns;
    laneHeight = Math.max(laneHeight, height);
  }
};

// Muted and low-alpha on purpose: the colour separates one stage from the next at a glance
// and is not meant to encode anything, so it must not compete with the nodes inside it.
export const BLOCK_COLOURS = [
  "(R=0.160000,G=0.280000,B=0.420000,A=0.300000)", // steel
  "(R=0.140000,G=0.360000,B=0.320000,A=0.300000)", // teal
  "(R=0.220000,G=0.340000,B=0.180000,A=0.300000)", // moss
  "(R=0.420000,G=0.320000,B=0.120000,A=0.300000)", // amber
  "(R=0.440000,G=0.220000,B=0.140000,A=0.300000)", // rust
  "(R=0.340000,G=0.180000,B=0.360000,A=0.300000)", // plum
  "(R=0.220000,G=0.200000,B=0.440000,A=0.300000)", // indigo
  "(R=0.260000,G=0.260000,B=0.300000,A=0.300000)", // slate
];

// A named block becomes a comment box drawn round its members. The padding leaves room for
// the title bar above the topmost node and for the widest node's body, neither of which the
// layout knows exactly — the defaults are the sizes the Material Editor draws at 1:1 zoom.
//
// Geometry only. Turning a box into T3D is the domain emitter's job, because the object that
// carries it differs: a material comment wraps a MaterialExpressionComment, a Niagara one is
// a plain EdGraphNode_Comment.
export const blockBoxes = (nodes, {
  blockColors = {},
  nodeWidth = 240, nodeHeight = 130,
  padX = 56, padTop = 104, padBottom = 56,
} = {}) =>
  [...new Set(nodes.map((n) => n.block).filter(Boolean))].map((name, i) => {
    const members = nodes.filter((n) => n.block === name);
    const left = Math.min(...members.map((n) => n.x));
    const right = Math.max(...members.map((n) => n.x));
    const bottom = Math.max(...members.map((n) => n.y));
    const topEdge = Math.min(...members.map((n) => n.y));
    return {
      text: name,
      x: left - padX,
      y: topEdge - padTop,
      w: right - left + nodeWidth + padX * 2,
      h: bottom - topEdge + nodeHeight + padTop + padBottom,
      color: blockColors?.[name] ?? BLOCK_COLOURS[i % BLOCK_COLOURS.length],
    };
  });
