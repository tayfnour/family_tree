/* Pure family validation and leaf-first botanical layout.
   Slots for names are scattered through a leaf-shaped crown first; the
   family is then fitted onto them and the branches grow towards them. */
(function (scope) {
    'use strict';
    const TAU = Math.PI * 2;
    // World units. The crown grows with the family while names keep their size.
    const SIZE = { spacing: 46, leaf: 17, parent: 19, minCrown: 700, trunkChain: 5, ringHeads: 7 };

    // Validate before replacing live data. IDs are unique; depth follows ancestry.
    function normalize(raw) {
        let roots = Array.isArray(raw) ? raw : raw?.familyData || raw?.roots || (raw?.root ? [raw.root] : null);
        if (!Array.isArray(roots) || !roots.length) throw new Error('الملف لا يحتوي على أفراد.');
        if (Array.isArray(raw?.ancestors) && raw.ancestors.length && raw.root) {
            let branch = raw.root;
            for (const ancestor of [...raw.ancestors].reverse()) branch = { name: typeof ancestor === 'string' ? ancestor : ancestor.name, children: [branch] };
            roots = [branch];
        }
        let count = 0;
        const ids = new Set();
        function visit(node, depth, path) {
            if (++count > 5000 || depth > 100) throw new Error('الحد المدعوم هو ٥٠٠٠ فرد و١٠٠ جيل لكل شجرة.');
            if (!node || typeof node !== 'object' || typeof node.name !== 'string' || !node.name.trim()) throw new Error('يجب أن يكون لكل فرد اسم نصي غير فارغ.');
            if (node.name.trim().length > 120) throw new Error('الاسم يجب ألا يتجاوز ١٢٠ حرفًا.');
            if (node.children !== undefined && !Array.isArray(node.children)) throw new Error('الأبناء يجب أن يكونوا مصفوفة children.');
            let id = typeof node.id === 'string' && node.id.trim() ? node.id : `person-${path}`;
            while (ids.has(id)) id += '-copy';
            ids.add(id);
            return { id, name: node.name.trim(), generation: depth, children: (node.children || []).map((child, i) => visit(child, depth + 1, `${path}-${i}`)) };
        }
        return roots.map((root, i) => visit(root, 1, String(i)));
    }

    function random(seed) {
        let a = seed >>> 0;
        return () => {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = Math.imul(a ^ (a >>> 15), a | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    const noise = (i, salt) => { const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453; return v - Math.floor(v); };
    const cross = (ax, ay, bx, by) => ax * by - ay * bx;

    // A broad, softly pointed leaf. The trunk fork O = (0, 0) sits low in it;
    // the lower lobes hang beside the trunk like the reference poster.
    function crownShape(W) {
        const a = W / 2, H = W * 1.09, top = -H * 0.86, mid = 0.52;
        const half = h => {
            if (h <= 0 || h >= 1) return 0;
            const t = h < mid ? (mid - h) / mid : (h - mid) / (1 - mid);
            return a * Math.sqrt(Math.max(0, 1 - Math.pow(t, h < mid ? 1.85 : 2.7)));
        };
        const side = Array.from({ length: 97 }, (_, i) => ({ x: half(i / 96), y: top + i / 96 * H }));
        const outline = [...side, ...side.slice(1, -1).reverse().map(p => ({ x: -p.x, y: p.y }))];
        return { W, H, top, half, outline, inside: (x, y) => Math.abs(x) < half((y - top) / H) };
    }

    // Each density level is a fixed crown, so adding a person usually reuses
    // the same slots and the tree changes locally instead of reshuffling.
    function geometry(level, heads) {
        const W = SIZE.minCrown * Math.pow(1.06, Math.max(0, level));
        const spacing = SIZE.spacing * Math.pow(1.07, Math.max(0, -level));
        const big = Math.min(2.4, Math.sqrt(W / SIZE.minCrown));
        const trunkTop = Math.min(700, Math.max(110, W * 0.12));
        const g = { level, W, spacing, big, trunkTop, crown: crownShape(W), heads, medal: 0, ring: 0 };
        if (heads) {
            g.medal = (heads <= 3 ? 32 : heads <= 5 ? 28 : 25) * big;
            g.ring = Math.max(g.medal + 26, trunkTop * 0.42, (heads - 1) * (2 * g.medal + 10) / 1.75);
            g.blendFrom = g.ring + g.medal + 4;
            g.blendTo = g.blendFrom + 26 + g.medal * 0.4;
            // Names start above a straight line just over the medallions. Any
            // family's convex area then stays above it, while the medallion
            // limbs turn below it, so the two can never meet.
            g.cut = g.blendTo + 14;
        } else g.cut = trunkTop * 0.6;
        return g;
    }

    // Bridson Poisson-disc sampling: natural spacing, never closer than `spacing`.
    function poisson(g) {
        const d = g.spacing, cell = d / Math.SQRT2, crown = g.crown, margin = SIZE.leaf + 8;
        const accept = (x, y) => y < -g.cut && y > crown.top + margin
            && Math.abs(x) < crown.half((y - crown.top) / crown.H) - margin;
        const minX = -g.W / 2, minY = crown.top, cols = Math.ceil(g.W / cell) + 1, rows = Math.ceil(crown.H / cell) + 1;
        const grid = new Int32Array(cols * rows).fill(-1), pts = [], active = [], rand = random(7919);
        function fits(x, y) {
            const cx = Math.floor((x - minX) / cell), cy = Math.floor((y - minY) / cell);
            if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
            for (let j = Math.max(0, cy - 2); j <= Math.min(rows - 1, cy + 2); j++)
                for (let i = Math.max(0, cx - 2); i <= Math.min(cols - 1, cx + 2); i++) {
                    const k = grid[j * cols + i];
                    if (k >= 0 && (pts[k].x - x) ** 2 + (pts[k].y - y) ** 2 < d * d) return false;
                }
            return true;
        }
        function add(x, y) {
            grid[Math.floor((y - minY) / cell) * cols + Math.floor((x - minX) / cell)] = pts.length;
            active.push(pts.length); pts.push({ x, y });
        }
        const midY = crown.top + crown.H * 0.5;
        // Starting points avoid exact alignment with the fork below them.
        for (const [x, y] of [[3.7, -g.cut - d], [-6.1, midY], [-g.W * 0.3, midY + 5.3], [g.W * 0.3, midY - 4.1], [8.9, crown.top + crown.H * 0.2]])
            if (accept(x, y) && fits(x, y)) add(x, y);
        while (active.length) {
            const slot = Math.floor(rand() * active.length), p = pts[active[slot]];
            let found = false;
            for (let t = 0; t < 30 && !found; t++) {
                const angle = rand() * TAU, r = d * (1 + rand());
                const x = p.x + Math.cos(angle) * r, y = p.y + Math.sin(angle) * r;
                if (accept(x, y) && fits(x, y)) { add(x, y); found = true; }
            }
            if (!found) { active[slot] = active[active.length - 1]; active.pop(); }
        }
        // Rim slots are released first, so a smaller family keeps a full,
        // rounded crown and every addition fills the next rim slot.
        const o = crown.outline;
        pts.forEach(p => {
            let best = Infinity;
            for (let i = 0; i < o.length; i++) {
                const a = o[i], b = o[(i + 1) % o.length], vx = b.x - a.x, vy = b.y - a.y;
                const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy || 1)));
                best = Math.min(best, Math.hypot(p.x - a.x - vx * t, p.y - a.y - vy * t));
            }
            p.rim = best;
        });
        return pts.sort((a, b) => b.rim - a.rim || a.y - b.y || a.x - b.x);
    }

    const slotCache = new Map();
    function slotSet(level, heads) {
        const key = `${level}|${heads}`;
        if (!slotCache.has(key)) {
            if (slotCache.size > 16) slotCache.delete(slotCache.keys().next().value);
            const g = geometry(level, heads);
            slotCache.set(key, { g, pts: poisson(g) });
        }
        return slotCache.get(key);
    }
    function chooseSlots(count, heads) {
        if (!count) return { g: geometry(0, heads), pts: [] };
        const base = slotSet(0, heads).pts.length || 1;
        let level = count > base ? Math.floor(Math.log(count / base) / (2 * Math.log(1.06))) - 1
            : Math.max(-22, Math.floor(Math.log(count / base) / (2 * Math.log(1.07))) - 1);
        for (; ; level++) {
            const set = slotSet(level, heads);
            if (set.pts.length >= count || level > 80) return { g: set.g, pts: set.pts.slice(0, count) };
        }
    }

    function segmentsCross(a, b, c, d) {
        const d1 = cross(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y), d2 = cross(b.x - a.x, b.y - a.y, d.x - a.x, d.y - a.y);
        const d3 = cross(d.x - c.x, d.y - c.y, a.x - c.x, a.y - c.y), d4 = cross(d.x - c.x, d.y - c.y, b.x - c.x, b.y - c.y);
        return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
    }
    function distanceToSegment(p, a, b) {
        const vx = b.x - a.x, vy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy || 1)));
        return Math.hypot(p.x - a.x - vx * t, p.y - a.y - vy * t);
    }
    // Convex hull (monotone chain), counter-clockwise in screen space.
    function hull(points) {
        const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
        if (p.length < 3) return p;
        const turn = (o, a, b) => cross(a.x - o.x, a.y - o.y, b.x - o.x, b.y - o.y);
        const lower = [], upper = [];
        for (const q of p) { while (lower.length > 1 && turn(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
        for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length > 1 && turn(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
        return lower.slice(0, -1).concat(upper.slice(0, -1));
    }
    // Does segment a-q touch the convex polygon h (q itself not in h)?
    function segmentHitsHull(a, q, h) {
        if (h.length === 1) return distanceToSegment(h[0], a, q) < 1e-6;
        if (h.length >= 3) {
            let inside = true;
            for (let i = 0; i < h.length && inside; i++) { const u = h[i], v = h[(i + 1) % h.length]; if (cross(v.x - u.x, v.y - u.y, q.x - u.x, q.y - u.y) < 0) inside = false; }
            if (inside) return true;
        }
        for (let i = 0; i < h.length; i++) if (segmentsCross(a, q, h[i], h[(i + 1) % h.length])) return true;
        return false;
    }
    // Hull vertices whose segment to the apex touches the hull only there.
    function visibleVertices(apex, h) {
        if (h.length < 3) return h;
        return h.filter((v, i) => {
            const prev = h[(i + h.length - 1) % h.length], next = h[(i + 1) % h.length];
            return cross(v.x - prev.x, v.y - prev.y, apex.x - prev.x, apex.y - prev.y) < 0 || cross(next.x - v.x, next.y - v.y, apex.x - v.x, apex.y - v.y) < 0;
        });
    }

    // Angle swept from the backward ray: left of the growth direction first,
    // then forward, then right.
    function sweep(apex, back, p) {
        const vx = p.x - apex.x, vy = p.y - apex.y;
        const a = Math.atan2(back.x * vy - back.y * vx, back.x * vx + back.y * vy);
        return a < 0 ? a + TAU : a;
    }
    const turnBy = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
    const fromSweep = (k, r) => ({ x: Math.cos(k + Math.PI / 2) * r, y: Math.sin(k + Math.PI / 2) * r });
    const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
    const branchWidth = (size, g) => Math.min(g.trunkTop * 0.32, 1.6 + 1.3 * Math.sqrt(size));
    // Integer shares proportional to size, never below the family's own size.
    function shares(total, sizes) {
        const sum = sizes.reduce((a, b) => a + b, 0), extra = Math.max(0, total - sum);
        const raw = sizes.map(s => s + extra * s / sum), out = raw.map(Math.floor);
        let left = Math.max(sum, total) - out.reduce((a, b) => a + b, 0);
        raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i]++; left--; } });
        return out;
    }

    /* Each child receives a convex, disjoint share of its parent's slots and
       is joined by a straight segment that touches nothing else, so branches
       can never cross. Two ways of sharing are used:
       - wedges around the parent, for broad crowns (limbs fan out);
       - along an axis, for long narrow shares: the parent's branch carries
         on and every child takes a compact cell beside it on a short twig. */
    function place(node, apex, back, pts, g, out, axisAllowed = true) {
        const kids = node.children;
        if (!kids.length || !pts.length) return;
        for (const s of pts) { s.k = sweep(apex, back, s); s.d = (s.x - apex.x) ** 2 + (s.y - apex.y) ** 2; }
        if (axisAllowed && kids.length >= 2 && pts.length >= 4 && alongAxis(node, apex, back, pts, g, out)) return;
        const order = [...kids].reverse(); // eldest ends on the right
        const twigs = order.filter(c => !c.children.length), limbs = order.filter(c => c.children.length);
        const byAngle = list => list.sort((a, b) => a.k - b.k);
        const cut = (list, group) => { const sizes = shares(list.length, group.map(c => c.size)); let i = 0; return group.map((c, j) => list.slice(i, i += sizes[j])); };
        let plan = null;
        if (!limbs.length) plan = { cap: [...pts].sort((a, b) => a.d - b.d).slice(0, twigs.length), wedges: [] };
        else if (twigs.length) {
            // Childless children take the nearest slots as short twigs, as
            // long as no limb's share would cover their twig.
            const near = [...pts].sort((a, b) => a.d - b.d);
            let cap = near.slice(0, twigs.length), rest = near.slice(twigs.length);
            for (let attempt = 0; attempt < Math.min(12, twigs.length * 2 + 2); attempt++) {
                const wedges = cut(byAngle(rest), limbs), hulls = wedges.map(hull);
                let clash = null;
                for (const q of cap) {
                    const w = wedges.findIndex(list => list.length && q.k >= list[0].k && q.k <= list[list.length - 1].k);
                    if (w >= 0 && segmentHitsHull(apex, q, hulls[w])) { clash = { q, w: wedges[w] }; break; }
                }
                if (!clash) { plan = { cap, wedges }; break; }
                const swap = clash.w.reduce((best, s) => s.d < best.d ? s : best);
                cap = cap.map(s => s === clash.q ? swap : s);
                rest = rest.map(s => s === swap ? clash.q : s);
            }
        } else plan = { cap: [], wedges: cut(byAngle([...pts]), limbs) };
        if (!plan) plan = { cap: [], wedges: cut(byAngle([...pts]), order), all: true };
        byAngle(plan.cap).forEach((s, i) => { Object.assign(twigs[i], { x: s.x, y: s.y }); out.edges.push({ from: apex, to: twigs[i] }); });
        (plan.all ? order : limbs).forEach((child, i) => {
            const list = plan.wedges[i];
            const candidates = visibleVertices(apex, hull(list)), middle = list[list.length >> 1].k;
            let seed = candidates[0], best = Infinity;
            for (const v of candidates) {
                // Near the parent and near the middle of its share, so the
                // family spreads evenly instead of crowding one side.
                let score = Math.sqrt(v.d) * (1 + 0.6 * Math.abs(v.k - middle));
                for (const q of plan.cap) if (distanceToSegment(q, apex, v) < SIZE.leaf + 5) score += g.spacing * 3;
                if (score < best) { best = score; seed = v; }
            }
            Object.assign(child, { x: seed.x, y: seed.y });
            out.edges.push({ from: apex, to: child });
            const len = Math.sqrt(seed.d) || 1;
            place(child, child, { x: (apex.x - seed.x) / len, y: (apex.y - seed.y) / len }, list.filter(s => s !== seed), g, out);
        });
    }
    function alongAxis(node, apex, back, pts, g, out) {
        // Only for long shares: length well beyond width.
        const fwd = { x: -back.x, y: -back.y };
        let len = 0, lo = Infinity, hi = -Infinity;
        for (const s of pts) {
            const vx = s.x - apex.x, vy = s.y - apex.y, u = cross(fwd.x, fwd.y, vx, vy);
            len = Math.max(len, vx * fwd.x + vy * fwd.y); lo = Math.min(lo, u); hi = Math.max(hi, u);
        }
        if (len < 1.5 * (hi - lo) || len < g.spacing * 2.5) return false;
        // The axis may turn as long as every slot still lies ahead of the parent.
        const sorted = [...pts].sort((a, b) => a.k - b.k), kmin = sorted[0].k, kmax = sorted[sorted.length - 1].k;
        const from = kmax - Math.PI / 2 + 0.06, to = kmin + Math.PI / 2 - 0.06;
        if (from > to) return false;
        // Siblings alternate sides, eldest nearest the parent and on the right.
        const right = node.children.filter((_, i) => i % 2 === 0), left = node.children.filter((_, i) => i % 2 === 1);
        const need = list => list.reduce((s, c) => s + c.size, 0), want = shares(pts.length, [need(left), need(right)])[0];
        let bestJ = -1;
        for (let j = need(left); j <= pts.length - need(right); j++) {
            const lowK = j ? sorted[j - 1].k : -Infinity, highK = j < sorted.length ? sorted[j].k : Infinity;
            if (Math.max(lowK, from) < Math.min(highK, to) && (bestJ < 0 || Math.abs(j - want) < Math.abs(bestJ - want))) bestJ = j;
        }
        if (bestJ < 0) return false;
        const lowK = bestJ ? sorted[bestJ - 1].k : -Infinity, highK = bestJ < sorted.length ? sorted[bestJ].k : Infinity;
        const theta = (Math.max(lowK, from) + Math.min(highK, to)) / 2, dir = turnBy(back, theta);
        const t = s => (s.x - apex.x) * dir.x + (s.y - apex.y) * dir.y, u = s => cross(dir.x, dir.y, s.x - apex.x, s.y - apex.y);
        const feet = [], area = hull([...pts, apex]);
        const inside = p => area.length < 3 || area.every((a, i) => { const b = area[(i + 1) % area.length]; return cross(b.x - a.x, b.y - a.y, p.x - a.x, p.y - a.y) >= -1e-6 * Math.hypot(b.x - a.x, b.y - a.y); });
        for (const [side, group] of [[sorted.slice(bestJ), right], [sorted.slice(0, bestJ), left]]) {
            if (!group.length) continue;
            side.sort((a, b) => t(a) - t(b));
            const sizes = shares(side.length, group.map(c => c.size));
            let i = 0;
            group.forEach((child, j) => {
                const cell = side.slice(i, i += sizes[j]);
                // The slot nearest the axis faces it across an empty gap.
                const seed = cell.reduce((best, s) => Math.abs(u(s)) < Math.abs(u(best)) ? s : best);
                const foot = { x: apex.x + dir.x * t(seed), y: apex.y + dir.y * t(seed), t: t(seed), axis: node };
                feet.push({ foot, child, seed, cell });
            });
        }
        // The axis must stay inside this family's own area, or it could
        // reach a neighbour's branches; otherwise wedges are used instead.
        if (!feet.every(f => inside(f.foot))) return false;
        // The parent's branch continues along the axis through every foot.
        feet.sort((a, b) => a.foot.t - b.foot.t);
        let prev = apex, remaining = node.size - 1;
        feet.forEach(({ foot, child }) => {
            out.edges.push({ from: prev, to: foot, axis: true, carries: remaining, owner: node });
            out.edges.push({ from: foot, to: child });
            remaining -= child.size; prev = foot;
        });
        for (const { foot, child, seed, cell } of feet) {
            Object.assign(child, { x: seed.x, y: seed.y });
            const fl = Math.hypot(foot.x - seed.x, foot.y - seed.y) || 1;
            place(child, child, { x: (foot.x - seed.x) / fl, y: (foot.y - seed.y) / fl }, cell.filter(s => s !== seed), g, out);
        }
        return true;
    }

    function buildLayout(roots) {
        const nodes = [];
        function wrap(person, parent, depth) {
            const n = { person, parent, depth, children: [], size: 1, x: 0, y: 0 };
            nodes.push(n);
            n.children = person.children.map(child => wrap(child, n, depth + 1));
            n.size = 1 + n.children.reduce((sum, child) => sum + child.size, 0);
            return n;
        }
        const tops = roots.map(root => wrap(root, null, 0));
        // Single-child ancestors stand on the trunk as ovals, oldest at the foot.
        const chain = [];
        let fork = { children: tops, size: 1 + tops.reduce((s, n) => s + n.size, 0), virtual: true };
        if (tops.length === 1) {
            let n = tops[0]; chain.push(n);
            while (n.children.length === 1 && chain.length < SIZE.trunkChain) { n = n.children[0]; chain.push(n); }
            fork = n;
        }
        const heads = fork.children, ring = heads.length > 0 && heads.length <= SIZE.ringHeads;
        const crownCount = nodes.length - chain.length - (ring ? heads.length : 0);
        const { g, pts } = chooseSlots(crownCount ? Math.ceil(crownCount * 1.06) + 4 : 0, ring ? heads.length : 0);
        const slots = pts.map(p => ({ x: p.x, y: p.y }));
        const O = { x: 0, y: 0 }, down = { x: 0, y: 1 }, out = { edges: [] };

        chain.forEach(n => { n.kind = 'trunk'; });
        nodes.forEach(n => { if (!n.kind) n.kind = n.children.length ? 'parent' : 'leaf'; n.r = n.kind === 'parent' ? SIZE.parent : SIZE.leaf; });
        if (ring) {
            // Gold medallions sit on the trunk top; their families take wedges
            // around the fork and their limbs fan out through a clear ring.
            slots.forEach(s => { s.k = sweep(O, down, s); });
            slots.sort((a, b) => a.k - b.k);
            const order = [...heads].reverse(), sizes = shares(slots.length, order.map(h => h.size - 1));
            let i = 0;
            const lists = order.map((h, j) => slots.slice(i, i += h.children.length ? sizes[j] : 0));
            const want = lists.map(list => list.length ? list[list.length >> 1].k : NaN);
            const lo = Math.PI - 1.22, hi = Math.PI + 1.22, gap = (2 * g.medal + 10) / g.ring;
            want.forEach((v, j) => { if (Number.isNaN(v)) want[j] = order.length === 1 ? Math.PI : lo + (hi - lo) * j / (order.length - 1); });
            const k = want.map(v => Math.max(lo, Math.min(hi, v)));
            for (let j = 1; j < k.length; j++) k[j] = Math.max(k[j], k[j - 1] + gap);
            if (k[k.length - 1] > hi) { k[k.length - 1] = hi; for (let j = k.length - 2; j >= 0; j--) k[j] = Math.min(k[j], k[j + 1] - gap); }
            order.forEach((h, j) => {
                const p = fromSweep(k[j], g.ring);
                Object.assign(h, { kind: 'medallion', r: g.medal, x: p.x, y: p.y, k: k[j] });
                const start = out.edges.length;
                place(h, O, down, lists[j], g, out, false);
                for (let e = start; e < out.edges.length; e++) if (out.edges[e].from === O) out.edges[e].ringFrom = h;
            });
        } else place(fork, O, down, slots, g, out, false);

        // Trunk: height leaves room for every ancestor oval.
        const ovalRx = 62 * Math.pow(g.big, 0.6), ovalRy = 29 * Math.pow(g.big, 0.6), step = ovalRy * 2 + 18;
        const below = ring ? Math.max(0, ...heads.map(h => h.y + h.r)) : 0;
        const trunkHeight = Math.max(g.W * 0.36, below + 50 + chain.length * step + 40);
        chain.forEach((n, i) => {
            const scale = i === 0 ? 1.12 : 1;
            Object.assign(n, { x: 0, y: trunkHeight - 50 - ovalRy * 0.2 - i * step, rx: ovalRx * scale, ry: ovalRy * scale, r: ovalRx * scale });
        });

        // Widths follow how much family each piece of wood carries; twigs bow
        // gently with the flow, and any bowed twig found crossing is straightened.
        const edges = out.edges;
        edges.forEach(e => {
            const size = e.axis ? e.carries : e.to.size;
            e.w0 = branchWidth(size, g);
            e.w1 = e.axis ? branchWidth(Math.max(1, size - 1), g) * 0.92 : e.to.children && e.to.children.length ? branchWidth(size, g) * 0.86 : 1.2;
            e.bow = !e.axis && !e.ringFrom;
            e.fromNode = e.from.axis || (e.from.person ? e.from : null);
        });
        const shape = edge => {
            const to = edge.to;
            if (edge.ringFrom) {
                // Turn towards the child just above the medallions, below the
                // line where names begin, then follow the straight ray from the
                // fork, which the families' shares never cross.
                const m = edge.ringFrom, target = sweep(O, down, to), pts = [];
                for (let i = 0; i <= 16; i++) {
                    const r = g.ring + (g.blendTo - g.ring) * i / 16;
                    pts.push(fromSweep(m.k + (target - m.k) * smooth((r - g.blendFrom) / (g.blendTo - g.blendFrom)), r));
                }
                pts.push({ x: to.x, y: to.y });
                return pts;
            }
            const a = edge.from, len = Math.hypot(to.x - a.x, to.y - a.y) || 1;
            if (!edge.bow || len < 12) return [{ x: a.x, y: a.y }, { x: to.x, y: to.y }];
            // A soft S-curve: leave along the line, settle into it at the end.
            const ux = (to.x - a.x) / len, uy = (to.y - a.y) / len, side = (Math.round(a.x * 7 + to.y * 3) & 1) ? 1 : -1, bend = Math.min(10, len * 0.09) * side;
            return Array.from({ length: 9 }, (_, i) => {
                const t = i / 8, w = Math.sin(t * Math.PI) * bend;
                return { x: a.x + (to.x - a.x) * t - uy * w, y: a.y + (to.y - a.y) * t + ux * w };
            });
        };
        edges.forEach(e => { e.points = shape(e); });
        for (let round = 0; round < 4; round++) {
            const clashes = findCrossings(edges);
            if (!clashes.length) break;
            clashes.forEach(([a, b]) => { for (const e of [a, b]) if (e.bow) { e.bow = false; e.points = shape(e); } });
        }

        // The trunk splits into one short limb per medallion.
        const stems = ring ? heads.map(h => ({ to: h, from: { x: Math.max(-g.trunkTop * 0.3, Math.min(g.trunkTop * 0.3, h.x * 0.45)), y: g.trunkTop * 0.75 },
            w0: Math.min(g.trunkTop * 0.5, g.trunkTop * 1.1 / heads.length), w1: g.medal * 1.1 })) : [];

        const crown = g.crown;
        const bounds = { left: -g.W / 2 - 70, right: g.W / 2 + 70, top: crown.top - 80, bottom: trunkHeight + 170 };
        return {
            nodes, edges, stems, chain, heads, ring, slots: slots.length, geometry: g, crown,
            trunk: { width: g.trunkTop, height: trunkHeight }, foliage: foliage(g, edges, trunkHeight),
            left: bounds.left, top: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top, bottom: bounds.bottom, ground: trunkHeight
        };
    }

    // Decorative leaves are planned with the layout so drawing stays cheap.
    function foliage(g, edges, trunkHeight) {
        const leaves = [], crown = g.crown, step = 15, half = g.trunkTop / 2;
        let i = 0;
        for (let y = crown.top + 6; y < crown.top + crown.H; y += step * 0.87) {
            const row = Math.round((y - crown.top) / (step * 0.87));
            for (let x = -g.W / 2 + (row % 2) * step / 2; x < g.W / 2; x += step, i++) {
                const px = x + (noise(i, 1) - 0.5) * step * 0.8, py = y + (noise(i, 2) - 0.5) * step * 0.8;
                if (!crown.inside(px, py) || (py > -10 && Math.abs(px) < half + 8)) continue;
                const out = Math.atan2(py - (crown.top + crown.H * 0.55), px);
                leaves.push({ x: px, y: py, a: out + (noise(i, 3) - 0.5) * 2.4, l: 17 + noise(i, 4) * 9, t: noise(i, 5) < 0.28 ? 2 : 0 });
            }
        }
        // Small paired leaves along the twigs make every name sit on a sprig.
        edges.forEach((e, j) => {
            if (e.w0 > 6 || e.points.length < 2) return;
            const a = e.points[0], b = e.points[e.points.length - 1], ang = Math.atan2(b.y - a.y, b.x - a.x);
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            for (let t = 0.35; t < 0.8 && len > 30; t += 0.3) {
                const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
                for (const side of [-1, 1]) leaves.push({ x, y, a: ang + side * 0.75, l: 11 + noise(j, t * 10 + side) * 4, t: 1 });
            }
        });
        return leaves;
    }

    // Exact crossing test between branch centre lines, bucketed for speed.
    function findCrossings(edges) {
        const cell = 60, grid = new Map(), out = [], seen = new Set();
        edges.forEach((e, ei) => {
            for (let s = 0; s < e.points.length - 1; s++) {
                const a = e.points[s], b = e.points[s + 1];
                for (let gx = Math.floor(Math.min(a.x, b.x) / cell); gx <= Math.floor(Math.max(a.x, b.x) / cell); gx++)
                    for (let gy = Math.floor(Math.min(a.y, b.y) / cell); gy <= Math.floor(Math.max(a.y, b.y) / cell); gy++) {
                        const key = gx * 100003 + gy;
                        if (!grid.has(key)) grid.set(key, []);
                        grid.get(key).push([ei, s]);
                    }
            }
        });
        const related = (e, f) => e.to === f.to || e.to === f.from || f.to === e.from || e.from === f.from || (e.ringFrom && e.ringFrom === f.ringFrom);
        for (const list of grid.values()) {
            for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
                const [ei, si] = list[i], [ej, sj] = list[j];
                if (ei === ej) continue;
                const e = edges[ei], f = edges[ej], key = ei < ej ? `${ei}|${ej}` : `${ej}|${ei}`;
                if (seen.has(key)) continue;
                if (related(e, f) && !(e.from === f.from && !e.ringFrom && (e.bow || f.bow))) continue;
                const a = e.points[si], b = e.points[si + 1], c = f.points[sj], d = f.points[sj + 1];
                if (segmentsCross(a, b, c, d)) {
                    // Siblings meet at their shared fork; only count real crossings.
                    if (e.from === f.from) {
                        const hit = intersection(a, b, c, d);
                        if (Math.hypot(hit.x - e.from.x, hit.y - e.from.y) < 1.5) continue;
                    }
                    seen.add(key); out.push([e, f]);
                }
            }
        }
        return out;
    }
    function intersection(a, b, c, d) {
        const den = cross(b.x - a.x, b.y - a.y, d.x - c.x, d.y - c.y) || 1e-9;
        const t = cross(c.x - a.x, c.y - a.y, d.x - c.x, d.y - c.y) / den;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }

    // Read-only checks used by the tests and the in-page diagnostics.
    function diagnose(layout) {
        const crowned = layout.nodes.filter(n => n.kind !== 'trunk');
        let overlaps = 0, hits = 0;
        const cell = 50, grid = new Map();
        crowned.forEach(n => { const key = `${Math.floor(n.x / cell)},${Math.floor(n.y / cell)}`; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(n); });
        const around = (x, y) => { const out = []; const gx = Math.floor(x / cell), gy = Math.floor(y / cell); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(...(grid.get(`${gx + i},${gy + j}`) || [])); return out; };
        crowned.forEach(n => around(n.x, n.y).forEach(m => { if (m !== n && Math.hypot(m.x - n.x, m.y - n.y) < m.r + n.r - 0.5) overlaps++; }));
        layout.edges.forEach(e => {
            for (let s = 0; s < e.points.length - 1; s++) {
                const a = e.points[s], b = e.points[s + 1];
                const near = new Set([...around(a.x, a.y), ...around(b.x, b.y), ...around((a.x + b.x) / 2, (a.y + b.y) / 2)]);
                for (const n of near) if (n !== e.to && n !== e.fromNode && n !== e.ringFrom && distanceToSegment(n, a, b) < n.r * 0.55) { hits++; break; }
            }
        });
        return { crossings: findCrossings(layout.edges).length, overlaps: overlaps / 2, branchesUnderNames: hits };
    }

    const api = { normalize, buildLayout, diagnose, SIZE };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else scope.FamilyTreeLayout = api;
})(typeof window !== 'undefined' ? window : globalThis);
