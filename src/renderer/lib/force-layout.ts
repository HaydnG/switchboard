export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutOptions {
  width: number;
  height: number;
  iterations?: number;
  /** Nodes kept at the centre (the focused entry). */
  pinned?: string[];
  seed?: number;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fruchterman–Reingold layout. Deterministic for a given input, O(n²) per
 * iteration, so callers cap the node count (a few hundred lays out in tens of ms).
 */
export function forceLayout(
  nodes: string[],
  edges: Array<{ from: string; to: string }>,
  { width, height, iterations = 260, pinned = [], seed = 7 }: LayoutOptions,
): Map<string, LayoutPoint> {
  const n = nodes.length;
  const positions = new Map<string, LayoutPoint>();
  if (n === 0) return positions;
  const cx = width / 2;
  const cy = height / 2;
  if (n === 1) {
    positions.set(nodes[0], { x: cx, y: cy });
    return positions;
  }

  const random = mulberry32(seed + n);
  const index = new Map(nodes.map((id, i) => [id, i]));
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const radius = Math.min(width, height) * 0.35;
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    xs[i] = cx + radius * Math.cos(angle) + (random() - 0.5) * 10;
    ys[i] = cy + radius * Math.sin(angle) + (random() - 0.5) * 10;
  }
  const pinnedSet = new Set(pinned.map((id) => index.get(id)).filter((i) => i !== undefined));
  for (const i of pinnedSet) {
    xs[i!] = cx;
    ys[i!] = cy;
  }

  const links = edges
    .map((edge) => [index.get(edge.from), index.get(edge.to)] as const)
    .filter(
      (pair): pair is readonly [number, number] => pair[0] !== undefined && pair[1] !== undefined,
    );
  const k = Math.sqrt((width * height) / n) * 0.75;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  let temperature = Math.min(width, height) / 8;
  const cooling = temperature / (iterations + 1);

  for (let iter = 0; iter < iterations; iter++) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ddx = xs[i] - xs[j];
        let ddy = ys[i] - ys[j];
        let dist2 = ddx * ddx + ddy * ddy;
        if (dist2 < 0.01) {
          ddx = random() - 0.5;
          ddy = random() - 0.5;
          dist2 = 0.01;
        }
        const force = (k * k) / dist2;
        dx[i] += ddx * force;
        dy[i] += ddy * force;
        dx[j] -= ddx * force;
        dy[j] -= ddy * force;
      }
    }
    for (const [a, b] of links) {
      const ddx = xs[a] - xs[b];
      const ddy = ys[a] - ys[b];
      const dist = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01;
      const force = dist / k;
      dx[a] -= ddx * force;
      dy[a] -= ddy * force;
      dx[b] += ddx * force;
      dy[b] += ddy * force;
    }
    for (let i = 0; i < n; i++) {
      if (pinnedSet.has(i)) continue;
      // Gentle gravity keeps disconnected pieces on screen.
      dx[i] += (cx - xs[i]) * 0.02 * k;
      dy[i] += (cy - ys[i]) * 0.02 * k;
      const len = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 1;
      const step = Math.min(len, temperature);
      xs[i] += (dx[i] / len) * step;
      ys[i] += (dy[i] / len) * step;
    }
    temperature = Math.max(0.5, temperature - cooling);
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, xs[i]);
    maxX = Math.max(maxX, xs[i]);
    minY = Math.min(minY, ys[i]);
    maxY = Math.max(maxY, ys[i]);
  }
  const margin = 40;
  const scale = Math.min(
    (width - margin * 2) / Math.max(1, maxX - minX),
    (height - margin * 2) / Math.max(1, maxY - minY),
    1.6,
  );
  const offsetX = cx - ((minX + maxX) / 2) * scale;
  const offsetY = cy - ((minY + maxY) / 2) * scale;
  nodes.forEach((id, i) => {
    positions.set(id, { x: xs[i] * scale + offsetX, y: ys[i] * scale + offsetY });
  });
  return positions;
}
