/* Pure family validation and expandable botanical layout. */
(function (scope) {
    'use strict';
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

    function buildLayout(roots) {
        const nodes = [], levels = [], edges = [];
        const multi = roots.length > 1;
        function wrap(person, parent, depth) {
            const n = { person, parent, depth, children: [], weight: 1 };
            nodes.push(n);
            (levels[depth] ||= []).push(n);
            n.children = person.children.map(child => wrap(child, n, depth + 1));
            n.weight = Math.max(1, n.children.reduce((sum, child) => sum + child.weight, 0));
            return n;
        }
        const tops = roots.map(root => wrap(root, null, multi ? 1 : 0));
        function sector(n, start, end) {
            n.angle = (start + end) / 2;
            n.sectorWidth = end - start;
            let cursor = start;
            n.children.forEach(child => {
                const span = (end - start) * child.weight / n.weight;
                sector(child, cursor, cursor + span);
                cursor += span;
            });
        }
        const totalWeight = tops.reduce((s, n) => s + n.weight, 0);
        let cursor = -Math.PI + 0.15;
        tops.forEach(n => {
            const span = (Math.PI - 0.3) * n.weight / totalWeight;
            sector(n, cursor, cursor + span);
            cursor += span;
        });
        let radius = 0;
        levels.forEach((level, depth) => {
            if (depth === 0) { level[0].x = 0; level[0].y = 0; return; }
            const sorted = [...level].sort((a, b) => a.angle - b.angle);
            // Keep a generation on one radial lane. Staggering nodes at
            // different radii made neighbouring parent-to-child paths cross;
            // a single lane preserves the angular order of every branch.
            let base = radius + 135;
            for (let i = 1; i < sorted.length; i++) {
                const gap = sorted[i].angle - sorted[i - 1].angle;
                if (gap > 0.000001) base = Math.max(base, 124 / (2 * Math.sin(gap / 2)));
            }
            sorted.forEach(n => {
                const r = base;
                n.x = Math.cos(n.angle) * r;
                n.y = Math.sin(n.angle) * r * 1.13;
            });
            radius = base;
        });
        const trunkWidth = Math.min(100, 35 + Math.sqrt(nodes.length) * 5);
        const trunkHeight = 240;
        nodes.forEach(n => {
            if (n.parent) edges.push({ from: n.parent, to: n });
            else if (multi) edges.push({ from: { x: 0, y: 25, weight: totalWeight, depth: 0 }, to: n });
        });
        const minX = Math.min(-300, ...nodes.map(n => n.x - 85));
        const maxX = Math.max(300, ...nodes.map(n => n.x + 85));
        const minY = Math.min(-320, ...nodes.map(n => n.y - 65));
        return { nodes, edges, levels, trunkWidth, trunkHeight, width: maxX - minX + 120,
            height: trunkHeight - minY + 230, left: minX - 60, top: minY - 135, bottom: trunkHeight + 95 };
    }

    const api = { normalize, buildLayout };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else scope.FamilyTreeLayout = api;
})(typeof window !== 'undefined' ? window : globalThis);

