/* Pure family validation and leaf-first botanical layout.
   Slots for names are scattered through a leaf-shaped crown first; the
   family is then fitted onto them and the branches grow towards them. */
(function (scope) {
    'use strict';
    const TAU = Math.PI * 2;
    // World units. The crown grows with the family while names keep their size.
    const SIZE = { spacing: 50, leaf: 17, parent: 17, minCrown: 700, trunkChain: 5, ringHeads: 7, nameLeaf: { a: 19, b: 10.5 } };

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
        const a = W / 2, H = W * 1.02, top = -H * 0.93, mid = 0.5;
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
    // Wood thickens with everything it carries, so a limb is broad at its
    // base and narrows after every fork, down to a thin twig at a leaf.
    const branchWidth = (size, g) => Math.min(g.trunkTop * 0.36, 1.2 + 1.5 * Math.pow(size, 0.55));
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
        byAngle(plan.cap).forEach((s, i) => { Object.assign(twigs[i], { x: s.x, y: s.y }); });
        if (!limbs.length && twigs.length > 1 && sprig(apex, twigs, out)) return;
        twigs.forEach(c => out.edges.push({ from: apex, to: c }));
        const placed = (plan.all ? order : limbs).map((child, i) => {
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
            return { child, list, seed };
        });
        connect(apex, placed.map(p => p.child), g, out);
        placed.forEach(({ child, list, seed }) => {
            const len = Math.sqrt(seed.d) || 1;
            place(child, child, { x: (apex.x - seed.x) / len, y: (apex.y - seed.y) / len }, list.filter(s => s !== seed), g, out);
        });
    }
    /* Limbs leave a parent the way wood grows: one shared limb that forks
       again and again, heavier side first, instead of a fan of rays from
       one point. Each fork lies inside its group's angle and nearer than
       any member; if a bundle ever touches another branch it is undone. */
    function connect(apex, kids, g, out) {
        if (kids.length < 2 || (!apex.x && !apex.y)) { kids.forEach(c => out.edges.push({ from: apex, to: c })); return; }
        const id = out.bundles.size + 1;
        out.bundles.set(id, { apex, kids });
        const grow = (from, list) => {
            if (list.length === 1) { out.edges.push({ from, to: list[0], bundle: id }); return; }
            let sx = 0, sy = 0, near = Infinity;
            for (const c of list) {
                const dx = c.x - from.x, dy = c.y - from.y, l = Math.hypot(dx, dy) || 1;
                sx += dx / l * c.size; sy += dy / l * c.size; near = Math.min(near, l);
            }
            const sl = Math.hypot(sx, sy) || 1, step = near * 0.42;
            if (step < g.spacing * 0.45) { list.forEach(c => out.edges.push({ from, to: c, bundle: id })); return; }
            const fork = { x: from.x + sx / sl * step, y: from.y + sy / sl * step, size: list.reduce((s, c) => s + c.size, 0), junction: true };
            out.edges.push({ from, to: fork, bundle: id });
            let cut = 1, diff = Infinity, run = 0;
            for (let i = 1; i < list.length; i++) { run += list[i - 1].size; const d = Math.abs(fork.size - 2 * run); if (d < diff) { diff = d; cut = i; } }
            grow(fork, list.slice(0, cut)); grow(fork, list.slice(cut));
        };
        grow(apex, kids);
    }
    /* When every child is childless and they lie ahead of the father in a
       narrow band, one twig carries them all, leaf after leaf, like a real
       sprig. The twig visits them in order along its direction, so it never
       doubles back, and it stays inside this family's own area. */
    function sprig(apex, kids, out) {
        let cx = 0, cy = 0;
        for (const c of kids) { cx += c.x - apex.x; cy += c.y - apex.y; }
        const l = Math.hypot(cx, cy) || 1, ux = cx / l, uy = cy / l;
        const along = c => (c.x - apex.x) * ux + (c.y - apex.y) * uy;
        const angles = kids.map(c => Math.atan2(c.y - apex.y, c.x - apex.x)), mid = Math.atan2(uy, ux);
        if (kids.some(c => along(c) <= 0) || angles.some(a => Math.abs(Math.atan2(Math.sin(a - mid), Math.cos(a - mid))) > 0.85)) return false;
        const order = [...kids].sort((a, b) => along(a) - along(b));
        let prev = apex;
        order.forEach((c, i) => { out.edges.push({ from: prev, to: c, chain: true, carries: order.length - i }); prev = c; });
        return true;
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
        const O = { x: 0, y: 0 }, down = { x: 0, y: 1 }, out = { edges: [], bundles: new Map() };

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
        let edges = out.edges;
        const dressEdge = e => {
            const size = e.axis || e.chain ? e.carries : e.to.size;
            e.w0 = branchWidth(size, g);
            // The tip matches the largest branch that carries on from it.
            const onward = e.axis || e.chain ? size - 1 : e.to.junction ? Math.max(...out.edges.filter(f => f.from === e.to).map(f => f.axis ? f.carries : f.to.size), 1)
                : e.to.children?.length ? Math.max(...e.to.children.map(c => c.size)) : 0;
            e.w1 = onward ? Math.min(e.w0 * 0.9, branchWidth(onward, g)) : 1.1;
            e.curl = 2;
            e.fromNode = e.from.axis || (e.from.person ? e.from : null);
        };
        edges.forEach(dressEdge);
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
                if (!edge.curl) { pts.push({ x: to.x, y: to.y }); return pts; }
                // Beyond the turn the limb winds on to the child like any branch.
                const start = pts[pts.length - 1], rest = curve({ ...edge, from: start, curl: edge.curl }, pts[pts.length - 1].x - pts[pts.length - 2].x, pts[pts.length - 1].y - pts[pts.length - 2].y);
                return pts.concat(rest.slice(1));
            }
            return curve(edge);
        };
        const curve = (edge, hx, hy) => {
            const to = edge.to, a = edge.from, len = Math.hypot(to.x - a.x, to.y - a.y) || 1;
            if (!edge.curl || len < 12) return [{ x: a.x, y: a.y }, { x: to.x, y: to.y }];
            const ux = (to.x - a.x) / len, uy = (to.y - a.y) / len, side = (Math.round(a.x * 7 + to.y * 3) & 1) ? 1 : -1;
            if (edge.curl === 1) {
                // A soft S-curve: leave along the line, settle into it at the end.
                const bend = Math.min(9, len * 0.08) * side;
                return Array.from({ length: 9 }, (_, i) => { const t = i / 8, w = Math.sin(t * Math.PI) * bend; return { x: a.x + (to.x - a.x) * t - uy * w, y: a.y + (to.y - a.y) * t + ux * w }; });
            }
            // Living wood: the branch sets off in the direction its parent was
            // growing, sweeps round towards the child, settles into the way the
            // child's own main branch goes on, and winds a little on the way.
            const blend = (d, w) => { if (!d) return { x: ux, y: uy }; const x = d.x * w + ux * (1 - w), y = d.y * w + uy * (1 - w), l = Math.hypot(x, y) || 1; return x * ux + y * uy > 0.25 ? { x: x / l, y: y / l } : { x: ux, y: uy }; };
            const hl = Math.hypot(hx || 0, hy || 0), start = hl ? { x: hx / hl, y: hy / hl } : heading.get(a);
            const s0 = blend(start, 0.72), s1 = blend(onward.get(to), 0.45), k = len * 0.4, wind = Math.min(11, len * 0.075) * side;
            const c1 = { x: a.x + s0.x * k, y: a.y + s0.y * k }, c2 = { x: to.x - s1.x * k, y: to.y - s1.y * k };
            return Array.from({ length: 13 }, (_, i) => {
                const t = i / 12, v = 1 - t, w = Math.sin(t * Math.PI * 2) * wind * Math.sin(t * Math.PI);
                return { x: v * v * v * a.x + 3 * v * v * t * c1.x + 3 * v * t * t * c2.x + t * t * t * to.x - uy * w, y: v * v * v * a.y + 3 * v * v * t * c1.y + 3 * v * t * t * c2.y + t * t * t * to.y + ux * w };
            });
        };
        // Growth directions: where each branch arrives, and where the
        // heaviest branch leaving each fork goes next.
        let heading = new Map(), onward = new Map();
        const flows = () => {
            heading = new Map(); onward = new Map();
            const heaviest = new Map();
            for (const e of edges) {
                const l = Math.hypot(e.to.x - e.from.x, e.to.y - e.from.y) || 1, d = { x: (e.to.x - e.from.x) / l, y: (e.to.y - e.from.y) / l };
                heading.set(e.to, d);
                const w = e.axis || e.chain ? e.carries : e.to.size;
                if (!heaviest.has(e.from) || heaviest.get(e.from) < w) { heaviest.set(e.from, w); onward.set(e.from, d); }
            }
        };
        flows();
        edges.forEach(e => { e.points = shape(e); });
        for (let round = 0; round < 10; round++) {
            const clashes = findCrossings(edges);
            if (!clashes.length) break;
            const undo = new Set();
            clashes.forEach(([a, b]) => {
                for (const e of [a, b]) { if (e.bundle) undo.add(e.bundle); else if (e.curl) { e.curl--; e.points = shape(e); } }
            });
            // A bundle that touched another branch goes back to plain rays.
            if (undo.size) {
                edges = edges.filter(e => !undo.has(e.bundle));
                for (const id of undo) for (const kid of out.bundles.get(id).kids) { const e = { from: out.bundles.get(id).apex, to: kid }; dressEdge(e); edges.push(e); }
                flows();
                for (const e of edges) if (!e.bundle && e.points && (heading.has(e.from) || onward.has(e.to))) e.points = shape(e);
                for (const e of edges) if (!e.points) e.points = shape(e);
            }
        }

        // The trunk splits into one short limb per medallion.
        const stems = ring ? heads.map(h => ({ to: h, from: { x: Math.max(-g.trunkTop * 0.3, Math.min(g.trunkTop * 0.3, h.x * 0.45)), y: g.trunkTop * 0.75 },
            w0: Math.min(g.trunkTop * 0.5, g.trunkTop * 1.1 / heads.length), w1: g.medal * 1.1 })) : [];

        const crown = g.crown;
        const bounds = { left: -g.W / 2 - 70, right: g.W / 2 + 70, top: crown.top - 80, bottom: trunkHeight + 170 };
        return {
            nodes, edges, stems, chain, heads, ring, slots: slots.length, geometry: g, crown,
            trunk: { width: g.trunkTop, height: trunkHeight }, foliage: dress(nodes, edges, g),
            left: bounds.left, top: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top, bottom: bounds.bottom, ground: trunkHeight
        };
    }

    // A leaf is approximated by three discs along its midrib; two leaves
    // overlap only if some of their discs do.
    function footprint(cx, cy, angle, a, b) {
        const c = Math.cos(angle), s = Math.sin(angle);
        return [-0.55, 0, 0.55].map(t => ({ x: cx + c * a * t, y: cy + s * a * t, r: b }));
    }
    function decoPrint(f) {
        const c = Math.cos(f.a), s = Math.sin(f.a);
        return [0.33, 0.72].map(t => ({ x: f.x + c * f.l * t, y: f.y + s * f.l * t, r: f.l * 0.27 }));
    }
    // Leaf angles stay within about 35 degrees of level so names stay readable.
    const readable = angle => {
        const n = Math.atan2(Math.sin(angle), Math.cos(angle)), cap = 0.6;
        if (Math.cos(n) >= 0) return Math.max(-cap, Math.min(cap, n));
        const back = Math.atan2(Math.sin(n - Math.PI), Math.cos(n - Math.PI));
        return Math.PI + Math.max(-cap, Math.min(cap, back));
    };

    /* Fathers and grandfathers sit on circles at their forks, so the line
       of descent reads down every branch; the youngest are small green
       leaves at the tips of their twigs. Decorative leaves then grow in
       pairs along the branches, each on its own stem, and only inside the
       crown's outline. Nothing is placed where it would touch a leaf or a
       circle already there, so no two leaves ever overlap. */
    function dress(nodes, edges, g) {
        const cell = 48, grid = new Map(), { a: A, b: B } = SIZE.nameLeaf;
        const keyOf = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
        const free = (discs, self) => discs.every(d => {
            const gx = Math.floor(d.x / cell), gy = Math.floor(d.y / cell);
            for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const p of grid.get(`${gx + i},${gy + j}`) || []) if (!(self && p.owner === self) && Math.hypot(p.x - d.x, p.y - d.y) < p.r + d.r) return false;
            return true;
        });
        const keep = discs => discs.forEach(d => { const k = keyOf(d.x, d.y); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(d); });
        const dirAt = (pts, end) => { const p = end ? pts[pts.length - 2] : pts[0], q = end ? pts[pts.length - 1] : pts[1]; return Math.atan2(q.y - p.y, q.x - p.x); };
        const incoming = new Map();
        for (const e of edges) if (e.to.person) incoming.set(e.to, dirAt(e.points, true));
        // Fathers and grandfathers are circles on their forks; the youngest
        // generation are small green leaves at the tips of their twigs.
        for (const n of nodes) if (n.kind === 'parent' || n.kind === 'medallion') keep([{ x: n.x, y: n.y, r: n.r + 2 }]);
        for (const n of nodes) if (n.kind === 'leaf') {
            const angle = readable(incoming.get(n) ?? -Math.PI / 2);
            let scale = 1;
            while (scale > 0.5 && !free(footprint(n.x, n.y, angle, A * scale, B * scale))) scale -= 0.1;
            n.leaf = { x: n.x, y: n.y, a: angle, s: scale };
            keep(footprint(n.x, n.y, angle, A * scale, B * scale));
        }
        // Decorative leaves along every branch, alternating sides.
        const leaves = [];
        let i = 0;
        for (const e of edges) {
            if (e.w0 > 20) continue;
            const pts = e.points, seg = [];
            let total = 0;
            for (let s = 0; s < pts.length - 1; s++) { const l = Math.hypot(pts[s + 1].x - pts[s].x, pts[s + 1].y - pts[s].y); seg.push(l); total += l; }
            for (let along = 7; along < total - 5; along += 7.5) {
                let s = 0, left = along;
                while (s < seg.length - 1 && left > seg[s]) left -= seg[s++];
                const p = pts[s], q = pts[s + 1], t = seg[s] ? left / seg[s] : 0, dir = Math.atan2(q.y - p.y, q.x - p.x);
                const w = (e.w0 + (e.w1 - e.w0) * along / total) / 2, px = p.x + (q.x - p.x) * t, py = p.y + (q.y - p.y) * t;
                // A pair of leaves at each step, one on each side; a leaf that
                // would touch another is simply not grown.
                for (const side of (i & 1 ? [1, -1] : [-1, 1])) {
                    i++;
                    const nx = -Math.sin(dir) * side, ny = Math.cos(dir) * side, bx = px + nx * w, by = py + ny * w;
                    const angle = dir + side * (0.55 + noise(i, 3) * 0.6), l = 13 + noise(i, 4) * 7, stem = 2.5 + noise(i, 6) * 3;
                    const leaf = { bx, by, x: bx + Math.cos(angle) * stem, y: by + Math.sin(angle) * stem, a: angle, l, t: noise(i, 5) < 0.3 ? 2 : 0 };
                    const discs = decoPrint(leaf);
                    const tipX = leaf.x + Math.cos(angle) * l, tipY = leaf.y + Math.sin(angle) * l;
                    if (g.crown.inside(tipX * 1.03, tipY - (tipY - g.crown.top) * 0.0) && free(discs)) { keep(discs); leaves.push(leaf); }
                }
            }
        }
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
        // Leaves: every pair of name and decorative leaves must be apart.
        const discs = [];
        layout.nodes.forEach((n, id) => { if (n.kind === 'parent') discs.push({ x: n.x, y: n.y, r: n.r, id }); if (n.leaf) footprint(n.leaf.x, n.leaf.y, n.leaf.a, SIZE.nameLeaf.a * n.leaf.s, SIZE.nameLeaf.b * n.leaf.s).forEach(d => discs.push({ ...d, id })); });
        layout.foliage.forEach((f, j) => decoPrint(f).forEach(d => discs.push({ ...d, id: -1 - j })));
        const lg = new Map();
        discs.forEach(d => { const k = `${Math.floor(d.x / 48)},${Math.floor(d.y / 48)}`; if (!lg.has(k)) lg.set(k, []); lg.get(k).push(d); });
        let leafOverlaps = 0;
        discs.forEach(d => { const gx = Math.floor(d.x / 48), gy = Math.floor(d.y / 48); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const p of lg.get(`${gx + i},${gy + j}`) || []) if (p.id !== d.id && Math.hypot(p.x - d.x, p.y - d.y) < p.r + d.r - 0.5) leafOverlaps++; });
        return { crossings: findCrossings(layout.edges).length, overlaps: overlaps / 2, leafOverlaps: leafOverlaps / 2, branchesUnderNames: hits };
    }

    const api = { normalize, buildLayout, diagnose, SIZE };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else scope.FamilyTreeLayout = api;
})(typeof window !== 'undefined' ? window : globalThis);
