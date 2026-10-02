/* Data-driven botanical layout. Coordinates belong to an expandable world,
   never to the viewport. Layout data is kept separate from family records. */
(() => {
    'use strict';
    const TAU = Math.PI * 2;
    const { normalize, buildLayout, diagnose, SIZE } = window.FamilyTreeLayout;
    const storage = {
        get(key) { try { return localStorage.getItem(key); } catch { return null; } },
        set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } }
    };
    let layout = null, selected = null, camera = { x: 0, y: 0, scale: 1 }, fitScale = 1;
    let dirty = true, title = storage.get('familyTreeTitle') || 'شجرة العائلة';
    let pointers = new Map(), gesture = null, wasDragged = false;
    const panel = document.getElementById('tab-family');
    const oldGenerator = Array.from(panel.querySelectorAll('.control-group')).slice(0, 5).map(el => el.outerHTML).join('');
    const status = message => { document.getElementById('natural-status').textContent = message; };

    function example() {
        let id = 0;
        const names = ['عبدالله', 'محمد', 'أحمد', 'خالد', 'علي', 'يوسف', 'عمر', 'إبراهيم', 'سعد', 'فهد', 'ناصر', 'حسن', 'راشد', 'سلمان', 'عبدالرحمن'];
        const make = (name, children = []) => ({ id: `example-${++id}`, name, children });
        // Two ancestors on the trunk, three gold medallions, then a full crown.
        const branch = (seed, depth) => Array.from({ length: depth > 3 ? (seed % 3 ? 0 : 1 + seed % 2) : 2 + (seed * 7 + depth) % 4 }, (_, k) =>
            make(names[(seed * 5 + k * 3 + depth) % names.length], depth < 5 ? branch(seed * 3 + k + 1, depth + 1) : []));
        return normalize([make('الجد المؤسس', [make('عبدالله', Array.from({ length: 3 }, (_, i) => make(names[i + 1], branch(i + 2, 2))))])]);
    }

    // Flat palette derived from the colour tab, so the user's choices still apply.
    function mix(hex, other, t) {
        const parse = h => { const v = /^#?([0-9a-f]{6})$/i.exec(h || ''); const n = v ? parseInt(v[1], 16) : 0x777777; return [n >> 16, (n >> 8) & 255, n & 255]; };
        const a = parse(hex), b = parse(other);
        return `rgb(${a.map((c, i) => Math.round(c + (b[i] - c) * t)).join(',')})`;
    }
    function palette() {
        const leaf = config.leafColor || '#228B22', trunk = config.trunkColor || '#884D2A', branch = config.branchColor || '#6B3D1F';
        return { leafLight: mix(leaf, '#d8f08a', 0.42), leafDark: mix(leaf, '#0f2a08', 0.12), leafTip: mix(leaf, '#f3f7a0', 0.62),
            trunk: mix(trunk, '#000000', 0.12), trunkLight: mix(trunk, '#e8b47a', 0.18), bark: mix(trunk, '#000000', 0.45), branch: mix(branch, '#000000', 0.08) };
    }

    // Geometry is written as SVG path data and parsed once by the browser,
    // which is far faster than hundreds of thousands of Path2D calls.
    const f1 = v => Math.round(v * 10) / 10;
    // Tapered branch as one closed polygon. All polygons wind the same way,
    // so they merge cleanly when filled together as one flat shape.
    function taper(out, points, w0, w1) {
        if (points.length < 2) return;
        const n = points.length, left = [], right = [];
        for (let i = 0; i < n; i++) {
            const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
            const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
            const w = (w0 + (w1 - w0) * Math.pow(i / (n - 1), 0.8)) / 2;
            left.push(`${f1(points[i].x + nx * w)} ${f1(points[i].y + ny * w)}`); right.push(`${f1(points[i].x - nx * w)} ${f1(points[i].y - ny * w)}`);
        }
        out.push(`M${left.join('L')}L${right.reverse().join('L')}Z`);
    }
    const disc = (out, x, y, r) => out.push(`M${f1(x + r)} ${f1(y)}A${f1(r)} ${f1(r)} 0 1 0 ${f1(x - r)} ${f1(y)}A${f1(r)} ${f1(r)} 0 1 0 ${f1(x + r)} ${f1(y)}Z`);
    const toPath = list => new Path2D(list.join(''));

    // Static geometry is built once per layout. Foliage is split into tiles
    // so a zoomed-in view only fills the leaves it can see.
    const TILE = 800;
    let scene = null;
    function buildScene(l) {
        const tiles = new Map(), branches = [], leaves = [], rims = [], roses = [], cores = [];
        for (const f of l.foliage) {
            const key = `${Math.floor(f.x / TILE)},${Math.floor(f.y / TILE)}`;
            if (!tiles.has(key)) tiles.set(key, { x: Math.floor(f.x / TILE) * TILE, y: Math.floor(f.y / TILE) * TILE, light: [], dark: [], tip: [] });
            const t = tiles.get(key), c = Math.cos(f.a), d = Math.sin(f.a), tx = f1(f.x + c * f.l), ty = f1(f.y + d * f.l), w = f.l * 0.46;
            const mx = f.x + c * f.l * 0.45, my = f.y + d * f.l * 0.45, x = f1(f.x), y = f1(f.y);
            (f.t === 2 ? t.tip : t.light).push(`M${x} ${y}Q${f1(mx - d * w)} ${f1(my + c * w)} ${tx} ${ty}Z`);
            t.dark.push(`M${x} ${y}L${tx} ${ty}Q${f1(mx + d * w)} ${f1(my - c * w)} ${x} ${y}Z`);
        }
        for (const e of l.edges) {
            taper(branches, e.points, e.w0, e.w1);
            if (e.axis || e.to.children?.length) disc(branches, e.to.x, e.to.y, e.w1 / 2);
        }
        // Medallion stems grow out of the trunk top in a soft curve.
        const stems = [];
        for (const e of l.stems) {
            const c = { x: e.from.x * 0.4 + e.to.x * 0.1, y: Math.min(e.from.y, e.to.y) * 0.2 + e.to.y * 0.3 };
            taper(stems, Array.from({ length: 9 }, (_, i) => { const t = i / 8, u = 1 - t; return { x: u * u * e.from.x + 2 * u * t * c.x + t * t * e.to.x, y: u * u * e.from.y + 2 * u * t * c.y + t * t * e.to.y }; }), e.w0, e.w1);
        }
        for (const n of l.nodes) {
            if (n.kind === 'leaf') { disc(leaves, n.x, n.y, n.r); disc(rims, n.x, n.y + 1.6, n.r + 0.6); }
            else if (n.kind === 'parent') {
                const pts = [];
                for (let i = 0; i < 48; i++) { const a = i / 48 * TAU, r = n.r * (0.86 + 0.14 * Math.cos(a * 8)); pts.push(`${f1(n.x + Math.cos(a) * r)} ${f1(n.y + Math.sin(a) * r)}`); }
                roses.push(`M${pts.join('L')}Z`); disc(cores, n.x, n.y, n.r * 0.72);
            }
        }
        return {
            tiles: [...tiles.values()].map(t => ({ x: t.x, y: t.y, light: toPath(t.light), dark: toPath(t.dark), tip: toPath(t.tip) })),
            branches: toPath(branches), stems: toPath(stems), leaves: toPath(leaves), rims: toPath(rims), roses: toPath(roses), cores: toPath(cores),
            // Wavy flat clouds and a two-tone hill, all vector.
            clouds: Array.from({ length: 5 }, (_, i) => ({ x: l.left + l.width * (0.1 + 0.2 * i + Math.sin(i * 7) * 0.05), y: l.top + l.height * (0.07 + 0.09 * (i % 3)), s: l.width * (0.05 + 0.02 * (i % 2)) }))
        };
    }

    function fitText(n, maxWidth, base, min) {
        if (n.label && n.label.base === base) return n.label;
        const name = n.person.name;
        let size = base;
        ctx.font = `bold ${size}px Tajawal, Tahoma, sans-serif`;
        let lines = [name];
        while (size > min && ctx.measureText(name).width > maxWidth) { size -= 0.5; ctx.font = `bold ${size}px Tajawal, Tahoma, sans-serif`; }
        if (ctx.measureText(name).width > maxWidth && /\s/.test(name)) {
            const words = name.split(/\s+/), middle = Math.ceil(words.length / 2);
            lines = [words.slice(0, middle).join(' '), words.slice(middle).join(' ')];
            size = Math.max(min, base * 0.72);
        }
        n.label = { base, size, lines };
        return n.label;
    }
    function text(n, maxWidth, base, min, color) {
        const t = fitText(n, maxWidth, base, min);
        ctx.font = `bold ${t.size}px Tajawal, Tahoma, sans-serif`; ctx.fillStyle = color;
        t.lines.forEach((line, i) => ctx.fillText(line, n.x, n.y + 1 + (i - (t.lines.length - 1) / 2) * t.size * 1.05, maxWidth));
    }

    // Everything except names and the selection ring; `view` culls foliage.
    function scenery(view) {
        const l = layout, s = scene || (scene = buildScene(l)), p = palette();
        const sky = ctx.createLinearGradient(0, l.top, 0, l.ground);
        sky.addColorStop(0, '#9fd3f2'); sky.addColorStop(0.7, '#dcf0fa'); sky.addColorStop(1, '#f4fafc');
        ctx.fillStyle = sky; ctx.fillRect(l.left, l.top, l.width, l.height);
        ctx.fillStyle = '#ffffffd0';
        for (const c of s.clouds) { ctx.beginPath(); for (const [dx, dy, r] of [[0, 0, 1], [0.9, 0.2, 0.75], [-0.9, 0.25, 0.7], [0.35, -0.45, 0.72]]) { ctx.moveTo(c.x + dx * c.s + r * c.s, c.y + dy * c.s); ctx.arc(c.x + dx * c.s, c.y + dy * c.s, r * c.s, 0, TAU); } ctx.fill(); }
        const ground = l.ground;
        ctx.fillStyle = '#a5d16a'; ctx.beginPath(); ctx.moveTo(l.left, ground - 10);
        ctx.quadraticCurveTo(l.left + l.width * 0.3, ground - 55, l.left + l.width * 0.55, ground - 18); ctx.quadraticCurveTo(l.left + l.width * 0.8, ground + 10, l.left + l.width, ground - 35);
        ctx.lineTo(l.left + l.width, l.top + l.height); ctx.lineTo(l.left, l.top + l.height); ctx.fill();
        ctx.fillStyle = '#7fb544'; ctx.beginPath(); ctx.moveTo(l.left, ground + 25);
        ctx.quadraticCurveTo(l.left + l.width * 0.5, ground - 22, l.left + l.width, ground + 22); ctx.lineTo(l.left + l.width, l.top + l.height); ctx.lineTo(l.left, l.top + l.height); ctx.fill();

        // Trunk: concave sides, flared roots, flat light side and bark lines.
        const top = l.trunk.width / 2, base = top * 1.45;
        const trunk = new Path2D();
        trunk.moveTo(-top, -4); trunk.bezierCurveTo(-top * 0.82, ground * 0.45, -top * 0.95, ground * 0.8, -base * 1.5, ground + 12);
        trunk.quadraticCurveTo(-base * 0.8, ground - 6, -base * 0.45, ground + 16); trunk.quadraticCurveTo(0, ground + 2, base * 0.45, ground + 16);
        trunk.quadraticCurveTo(base * 0.8, ground - 6, base * 1.5, ground + 12); trunk.bezierCurveTo(top * 0.95, ground * 0.8, top * 0.82, ground * 0.45, top, -4);
        trunk.quadraticCurveTo(0, -top * 0.35, -top, -4); trunk.closePath();
        ctx.fillStyle = p.trunk; ctx.fill(trunk); ctx.fill(s.stems);
        ctx.save(); ctx.clip(trunk); ctx.fillStyle = p.trunkLight; ctx.fillRect(-base * 2, -top, base * 1.25, ground + top * 2);
        ctx.strokeStyle = p.bark; ctx.lineWidth = 2; ctx.lineCap = 'round';
        for (let i = -3; i <= 3; i++) { ctx.beginPath(); const x = i * top * 0.24; ctx.moveTo(x, ground * (0.08 + Math.abs(i) * 0.05)); ctx.bezierCurveTo(x * 1.1 + 6, ground * 0.4, x * 0.9 - 6, ground * 0.65, x * 1.3, ground * (0.9 - Math.abs(i) * 0.04)); ctx.stroke(); }
        ctx.restore();

        const leaves = () => {
            if (config.naturalFoliage === false) return;
            const shown = s.tiles.filter(t => !view || (t.x < view.x1 + 40 && t.x + TILE > view.x0 - 40 && t.y < view.y1 + 40 && t.y + TILE > view.y0 - 40));
            for (const [key, color] of [['light', p.leafLight], ['tip', p.leafTip], ['dark', p.leafDark]]) { ctx.fillStyle = color; for (const t of shown) ctx.fill(t[key]); }
        };
        if (config.leavesFirst !== false) leaves();
        ctx.fillStyle = p.branch; ctx.fill(s.branches);
        if (config.leavesFirst === false) leaves();

        // Names: cream circles for the youngest, gold rosettes for parents.
        ctx.fillStyle = '#00000022'; ctx.fill(s.rims);
        ctx.fillStyle = '#fbf4de'; ctx.fill(s.leaves); ctx.strokeStyle = '#d6c08e'; ctx.lineWidth = 1.2; ctx.stroke(s.leaves);
        ctx.fillStyle = '#e8a93a'; ctx.fill(s.roses); ctx.fillStyle = '#fbd98a'; ctx.fill(s.cores);
        for (const n of l.nodes) {
            if (n.kind === 'medallion') {
                ctx.beginPath(); ctx.arc(n.x, n.y + 2.5, n.r + 1, 0, TAU); ctx.fillStyle = '#00000026'; ctx.fill();
                ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, TAU); ctx.fillStyle = '#d39a2c'; ctx.fill();
                ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 0.86, 0, TAU); ctx.fillStyle = '#f2c65a'; ctx.fill();
                ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 0.7, 0, TAU); ctx.fillStyle = '#fde6a4'; ctx.fill();
            } else if (n.kind === 'trunk') {
                ctx.beginPath(); ctx.ellipse(n.x, n.y + 3, n.rx, n.ry, 0, 0, TAU); ctx.fillStyle = '#00000030'; ctx.fill();
                ctx.beginPath(); ctx.ellipse(n.x, n.y, n.rx, n.ry, 0, 0, TAU); ctx.fillStyle = '#d4ad5a'; ctx.fill();
                ctx.beginPath(); ctx.ellipse(n.x, n.y, n.rx - 6, n.ry - 5, 0, 0, TAU); ctx.fillStyle = '#fbf3dc'; ctx.fill();
            }
        }

        // Title banner on the grass.
        const bw = Math.min(l.width * 0.7, 900), bh = 62, by = ground + 52;
        ctx.fillStyle = '#00000020'; ctx.beginPath(); ctx.roundRect(-bw / 2, by + 4, bw, bh, 14); ctx.fill();
        ctx.fillStyle = '#fffaf0'; ctx.beginPath(); ctx.roundRect(-bw / 2, by, bw, bh, 14); ctx.fill();
        ctx.strokeStyle = '#c9a45a'; ctx.lineWidth = 2; ctx.stroke();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = 'rtl';
        ctx.fillStyle = '#4e342e'; ctx.font = 'bold 30px Tajawal, Tahoma, sans-serif'; ctx.fillText(title, 0, by + 26, bw - 40);
        ctx.fillStyle = '#8a6d3b'; ctx.font = '13px Tajawal, Tahoma, sans-serif';
        ctx.fillText(`${l.nodes.length.toLocaleString('ar')} فردًا  ·  ${Math.max(...l.nodes.map(n => n.person.generation)).toLocaleString('ar')} أجيال`, 0, by + 49);
    }
    // Names and the selection ring, drawn live on top. Names smaller than a
    // few screen pixels are skipped; zoom in to read them.
    function names(view, scale) {
        const l = layout, g = l.geometry;
        const sel = selected && l.nodes.find(n => n.person.id === selected);
        if (sel) {
            ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 3.5; ctx.beginPath();
            if (sel.kind === 'trunk') ctx.ellipse(sel.x, sel.y, sel.rx + 4, sel.ry + 4, 0, 0, TAU); else ctx.arc(sel.x, sel.y, sel.r + 4, 0, TAU);
            ctx.stroke();
        }
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = 'rtl';
        const readable = scale * SIZE.leaf >= 5.5;
        for (const n of l.nodes) {
            if (view && (n.x < view.x0 - 80 || n.x > view.x1 + 80 || n.y < view.y0 - 80 || n.y > view.y1 + 80)) continue;
            if (n.kind === 'trunk') text(n, n.rx * 1.55, 20 * Math.min(1.5, g.big), 9, '#4a3216');
            else if (n.kind === 'medallion') text(n, n.r * 1.4, 15 * Math.min(1.5, g.big), 8, '#5a3b05');
            else if (readable) text(n, n.r * (n.kind === 'parent' ? 1.3 : 1.7), 10, 5, n.kind === 'parent' ? '#5a3b05' : '#4e3a20');
        }
    }
    function poster(scale = camera.scale) { scenery(null); names(null, scale); }

    // A snapshot of the scenery serves zoomed-out views; closer views are
    // drawn as vectors. Any change to data, colours or title clears it.
    let snapshot = null;
    function invalidate() { snapshot = null; }
    function snapshotFor(scale) {
        const l = layout, want = Math.min(3000 / Math.max(l.width, l.height), Math.max(fitScale * 1.6, 0.05));
        if (snapshot && snapshot.layout === l && Math.abs(snapshot.scale - want) / want < 0.25) return snapshot;
        const c = document.createElement('canvas');
        c.width = Math.ceil(l.width * want); c.height = Math.ceil(l.height * want);
        const original = ctx;
        try { ctx = c.getContext('2d'); ctx.setTransform(want, 0, 0, want, -l.left * want, -l.top * want); scenery(null); }
        finally { ctx = original; }
        return (snapshot = { canvas: c, scale: want, layout: l });
    }

    function fit() {
        if (!layout) return;
        // Room is kept at the bottom for the zoom toolbar.
        const bar = 58;
        fitScale = Math.min((canvas.width - 28) / layout.width, (canvas.height - 28 - bar) / layout.height);
        camera = { scale: fitScale, x: (canvas.width - layout.width * fitScale) / 2 - layout.left * fitScale, y: (canvas.height - bar - layout.height * fitScale) / 2 - layout.top * fitScale };
        scheduleDraw();
    }
    function render() {
        if (dirty || !layout) { layout = buildLayout(familyData); scene = null; snapshot = null; dirty = false; fit(); }
        const view = { x0: -camera.x / camera.scale, y0: -camera.y / camera.scale, x1: (canvas.width - camera.x) / camera.scale, y1: (canvas.height - camera.y) / camera.scale };
        ctx.save(); ctx.setTransform(camera.scale, 0, 0, camera.scale, camera.x, camera.y);
        const shot = camera.scale <= Math.min(3000 / Math.max(layout.width, layout.height), Math.max(fitScale * 1.6, 0.05)) * 1.05 ? snapshotFor(camera.scale) : null;
        if (shot) { ctx.imageSmoothingQuality = 'high'; ctx.drawImage(shot.canvas, layout.left, layout.top, shot.canvas.width / shot.scale, shot.canvas.height / shot.scale); }
        else scenery(view);
        names(view, camera.scale);
        ctx.restore();
        document.getElementById('natural-zoom').textContent = `${Math.round(camera.scale / fitScale * 100)}%`;
    }
    drawFamilyDataTree = render;
    // Colour controls call markRandomTreeDirty; the snapshot must follow them.
    const markDirty = markRandomTreeDirty;
    markRandomTreeDirty = () => { invalidate(); markDirty(); };

    function refresh() {
        dirty = true;
        renderFamilyTreeView();
        scheduleDraw();
    }
    function save() {
        const ok = storage.set('familyTreeData', JSON.stringify(familyData));
        status(ok ? 'تم الحفظ على هذا المتصفح.' : 'تعذر الحفظ المحلي. صدّر ملف JSON للاحتفاظ بتعديلاتك.');
    }
    saveFamilyData = save;
    normalizeImportedFamilyData = normalize;
    renderFamilyTreeView = () => {
        if (!familyData) return;
        const list = document.getElementById('treeViewContainer'), select = document.getElementById('natural-parent');
        if (!select) return;
        list.replaceChildren(); select.replaceChildren();
        const rootOption = new Option('إضافة أصل مستقل', ''); select.add(rootOption);
        let count = 0, depth = 0;
        function row(person, generation) {
            count++; depth = Math.max(depth, generation);
            select.add(new Option(`${'— '.repeat(Math.min(6, generation - 1))}${person.name}`, person.id));
            const button = document.createElement('button'); button.type = 'button'; button.className = 'natural-person';
            button.style.paddingRight = `${8 + Math.min(7, generation - 1) * 12}px`;
            button.textContent = `${person.children.length ? '◉' : '❧'} ${person.name}`;
            button.setAttribute('aria-pressed', String(person.id === selected));
            const small = document.createElement('small'); small.textContent = `الجيل ${generation}`; button.append(small);
            button.addEventListener('click', () => choose(person.id, true)); list.append(button);
            person.children.forEach(child => row(child, generation + 1));
        }
        familyData.forEach(root => row(root, 1));
        select.value = selected || familyData[0]?.id || '';
        document.getElementById('natural-count').textContent = count.toLocaleString('ar');
        document.getElementById('natural-depth').textContent = depth.toLocaleString('ar');
        document.getElementById('natural-example').hidden = !familyData.some(n => n.id.startsWith('example-'));
    };
    function find(id) {
        const stack = [...familyData];
        while (stack.length) { const n = stack.pop(); if (n.id === id) return n; stack.push(...n.children); }
        return null;
    }
    function choose(id, center = false) {
        const person = find(id); if (!person) return;
        selected = id;
        document.getElementById('natural-rename').value = person.name;
        document.getElementById('natural-selected').textContent = `تعديل: ${person.name}`;
        renderFamilyTreeView();
        if (center && layout) {
            const n = layout.nodes.find(n => n.person.id === id);
            if (n) { camera.scale = Math.max(fitScale, 1); camera.x = canvas.width / 2 - n.x * camera.scale; camera.y = canvas.height / 2 - n.y * camera.scale; }
        }
        scheduleDraw();
    }

    panel.innerHTML = `
      <div class="natural-kicker">سجل العائلة · جذور وامتداد</div>
      <label class="natural-field" for="natural-title">عنوان الشجرة</label>
      <input class="natural-input" id="natural-title" maxlength="90">
      <div class="natural-stats"><div><strong id="natural-count">٠</strong><span>أفراد العائلة</span></div><div><strong id="natural-depth">٠</strong><span>أجيال متصلة</span></div></div>
      <div id="natural-example"><p class="natural-muted">أسماء توضيحية للمعاينة. استورد بيانات عائلتك أو ابدأ من أصل واحد.</p><div class="natural-row"><button id="natural-start" class="natural-secondary">بدء شجرة عائلتي</button></div></div>
      <h3 class="section-title">غصن جديد في العائلة</h3>
      <form id="natural-add-form">
        <label class="natural-field" for="natural-parent">الأب / الأصل الذي يتفرع منه</label><select class="natural-input" id="natural-parent"></select>
        <label class="natural-field" for="natural-name">اسم الفرد الجديد</label><input class="natural-input" id="natural-name" required maxlength="120" placeholder="اكتب الاسم هنا" autocomplete="off">
        <div class="natural-row"><button type="submit">＋ إضافة إلى الشجرة</button></div>
      </form>
      <div id="natural-status" role="status" aria-live="polite"></div>
      <h3 class="section-title" id="natural-selected">تعديل الفرد المحدد</h3>
      <form id="natural-edit-form"><label class="natural-field" for="natural-rename">الاسم</label><input class="natural-input" id="natural-rename" required maxlength="120"><div class="natural-row"><button class="natural-secondary" type="submit">حفظ الاسم</button></div></form>
      <h3 class="section-title">أفراد العائلة</h3><p class="natural-muted">اختر اسمًا من القائمة أو من الشجرة لعرضه وإضافة أبنائه.</p>
      <div id="treeViewContainer" class="tree-view-container"></div>
      <div class="natural-legend"><span class="trunk">الأصول على الجذع</span><span class="medal">الفروع الكبرى</span><span class="rose">الآباء</span><span class="leaf">بلا أبناء بعد</span></div>
      <h3 class="section-title">شكل الشجرة</h3>
      <label class="natural-field natural-check"><input type="checkbox" id="natural-foliage"> إظهار الأوراق الخضراء</label>
      <label class="natural-field natural-check"><input type="checkbox" id="natural-leaves-first"> رسم الأوراق أولًا لتبقى الأغصان ظاهرة فوقها</label>
      <div class="natural-row"><button id="natural-export">حفظ JSON</button><button id="natural-import" class="natural-secondary">استيراد JSON</button></div>
      <input type="file" id="familyJsonFile" accept=".json,application/json" hidden>
      <div class="natural-row"><button id="natural-image" class="natural-secondary">تنزيل صورة الشجرة كاملة</button></div>
      <details class="natural-details"><summary>بيانات تجريبية وخيارات الرسم</summary><p class="natural-muted">التوليد يستبدل بيانات الشجرة الحالية ببيانات تجريبية.</p>${oldGenerator}<button id="natural-generate" type="button">توليد بيانات تجريبية</button>
      <div class="natural-row"><button id="natural-legacy" class="natural-secondary">إظهار إعدادات الرسم الحر</button></div><p class="natural-muted">إعدادات الرسم الحر تخص الوضع التجريبي عند إيقاف الرسم من بيانات العائلة.</p>
      <label class="natural-field"><input type="checkbox" id="i-useFamilyData" checked> الرسم من بيانات العائلة</label></details>`;

    document.querySelector('#sidebar h2').textContent = 'شجرة العائلة';
    for (const button of document.querySelectorAll('.tab-btn')) if (/family|colors/.test(button.getAttribute('onclick'))) button.dataset.primary = 'true';
    switchTab('family');
    document.getElementById('natural-title').value = title;
    document.getElementById('natural-start').addEventListener('click', () => {
        if (!confirm('سيتم استبدال الأسماء التوضيحية بأصل واحد لبدء شجرتك. هل تريد المتابعة؟')) return;
        familyData = normalize([{ name: 'الجد المؤسس' }]); selected = familyData[0].id; save(); refresh(); choose(selected);
    });
    for (const [id, key] of [['natural-foliage', 'naturalFoliage'], ['natural-leaves-first', 'leavesFirst']]) {
        const box = document.getElementById(id);
        box.checked = config[key] !== false;
        box.addEventListener('change', event => { config[key] = event.target.checked; saveConfig(); invalidate(); scheduleDraw(); });
    }
    document.getElementById('natural-title').addEventListener('input', event => { title = event.target.value.trim() || 'شجرة العائلة'; storage.set('familyTreeTitle', title); invalidate(); scheduleDraw(); });
    document.getElementById('natural-add-form').addEventListener('submit', event => {
        event.preventDefault();
        const name = document.getElementById('natural-name').value.trim(); if (!name) return;
        const parentId = document.getElementById('natural-parent').value, parent = find(parentId);
        if (countFamilyNodes(familyData) >= 5000 || parent?.generation >= 100) { status('بلغت الحد المدعوم: ٥٠٠٠ فرد أو ١٠٠ جيل.'); return; }
        const person = { id: `person-${crypto.randomUUID()}`, name, generation: parent ? parent.generation + 1 : 1, children: [] };
        if (parent) parent.children.push(person); else familyData.push(person);
        selected = person.id; save(); refresh(); choose(person.id);
        document.getElementById('natural-name').value = '';
    });
    document.getElementById('natural-edit-form').addEventListener('submit', event => {
        event.preventDefault(); const person = find(selected), name = document.getElementById('natural-rename').value.trim();
        if (!person || !name) return; person.name = name; save(); refresh(); choose(person.id);
    });
    document.getElementById('natural-export').addEventListener('click', exportFamilyJSON);
    document.getElementById('natural-import').addEventListener('click', () => document.getElementById('familyJsonFile').click());
    document.getElementById('familyJsonFile').addEventListener('change', async event => {
        const file = event.target.files[0]; if (!file) return;
        try {
            if (file.size > 5 * 1024 * 1024) throw new Error('حجم الملف يجب ألا يتجاوز ٥ ميغابايت.');
            const data = normalize(JSON.parse(await file.text()));
            familyData = data; useFamilyData = true; document.getElementById('i-useFamilyData').checked = true;
            selected = data[0].id; save(); refresh(); choose(selected);
        } catch (error) { status(`تعذر الاستيراد: ${error.message}`); }
        event.target.value = '';
    });
    const generate = generateFamilyTree;
    generateFamilyTree = () => { generate(); familyData = normalize(familyData); selected = familyData[0].id; useFamilyData = true; document.getElementById('i-useFamilyData').checked = true; save(); refresh(); choose(selected); };
    document.getElementById('natural-generate').addEventListener('click', () => {
        if (confirm('سيتم استبدال بيانات العائلة الحالية ببيانات تجريبية. هل تريد المتابعة؟')) generateFamilyTree();
    });
    document.getElementById('natural-legacy').addEventListener('click', () => document.querySelector('.tabs').classList.toggle('advanced'));
    document.getElementById('i-useFamilyData').addEventListener('change', toggleFamilyMode);

    const toolbar = document.createElement('div'); toolbar.className = 'natural-toolbar';
    toolbar.innerHTML = '<button type="button" id="natural-minus" aria-label="تصغير">−</button><span id="natural-zoom">100%</span><button type="button" id="natural-plus" aria-label="تكبير">＋</button><button type="button" id="natural-fit">عرض كامل</button>';
    document.getElementById('canvas-container').append(toolbar);
    function zoomAt(factor, x = canvas.width / 2, y = canvas.height / 2) {
        const next = Math.max(fitScale * 0.5, Math.min(Math.max(6, fitScale * 12), camera.scale * factor));
        const ratio = next / camera.scale; camera.x = x - (x - camera.x) * ratio; camera.y = y - (y - camera.y) * ratio; camera.scale = next; scheduleDraw();
    }
    document.getElementById('natural-plus').addEventListener('click', () => zoomAt(1.3));
    document.getElementById('natural-minus').addEventListener('click', () => zoomAt(1 / 1.3));
    document.getElementById('natural-fit').addEventListener('click', fit);
    function position(event) { const r = canvas.getBoundingClientRect(); return { x: (event.clientX - r.left) * canvas.width / r.width, y: (event.clientY - r.top) * canvas.height / r.height }; }
    canvas.addEventListener('wheel', event => {
        if (!useFamilyData) return;
        event.preventDefault(); event.stopImmediatePropagation(); const p = position(event); zoomAt(Math.exp(-event.deltaY * 0.001), p.x, p.y);
    }, { capture: true, passive: false });
    // Capture legacy mouse handlers so there is only one camera in family mode.
    for (const type of ['mousedown', 'mousemove', 'mouseup', 'mouseleave']) canvas.addEventListener(type, event => { if (useFamilyData) event.stopImmediatePropagation(); }, true);
    canvas.addEventListener('pointerdown', event => {
        if (!useFamilyData) return;
        canvas.setPointerCapture(event.pointerId); pointers.set(event.pointerId, position(event));
        gesture = [...pointers.values()]; wasDragged = pointers.size > 1;
    });
    canvas.addEventListener('pointermove', event => {
        if (!useFamilyData || !pointers.has(event.pointerId)) return;
        pointers.set(event.pointerId, position(event)); const current = [...pointers.values()];
        if (gesture.length === 1 && current.length === 1) {
            const dx = current[0].x - gesture[0].x, dy = current[0].y - gesture[0].y;
            if (Math.abs(dx) + Math.abs(dy) > 2) wasDragged = true;
            camera.x += dx; camera.y += dy;
        } else if (gesture.length === 2 && current.length === 2) {
            const distance = points => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            const oldX = (gesture[0].x + gesture[1].x) / 2, oldY = (gesture[0].y + gesture[1].y) / 2;
            zoomAt(distance(current) / Math.max(1, distance(gesture)), oldX, oldY);
            camera.x += (current[0].x + current[1].x) / 2 - oldX; camera.y += (current[0].y + current[1].y) / 2 - oldY;
            wasDragged = true;
        }
        gesture = current; scheduleDraw();
    });
    canvas.addEventListener('pointerup', event => {
        if (!pointers.has(event.pointerId)) return;
        if (!wasDragged && layout) {
            const p = position(event), x = (p.x - camera.x) / camera.scale, y = (p.y - camera.y) / camera.scale;
            const n = layout.nodes.find(n => n.kind === 'trunk' ? ((n.x - x) / n.rx) ** 2 + ((n.y - y) / n.ry) ** 2 <= 1 : Math.hypot(n.x - x, n.y - y) <= n.r + 3);
            if (n) choose(n.person.id);
        }
        pointers.delete(event.pointerId); gesture = [...pointers.values()];
    });
    canvas.addEventListener('pointercancel', event => { pointers.delete(event.pointerId); gesture = [...pointers.values()]; wasDragged = true; });
    function resize() {
        const box = document.getElementById('canvas-container');
        canvas.width = Math.max(280, box.clientWidth - 32); canvas.height = Math.max(340, box.clientHeight - 36);
        canvas.style.width = `${canvas.width}px`; canvas.style.height = `${canvas.height}px`; markRandomTreeDirty(); fit(); scheduleDraw();
    }
    new ResizeObserver(resize).observe(document.getElementById('canvas-container'));
    exportImage = () => {
        if (!useFamilyData) { const a = document.createElement('a'); a.download = 'tree.png'; a.href = canvas.toDataURL(); a.click(); return; }
        const output = document.createElement('canvas'), scale = Math.min(2, 4096 / Math.max(layout.width, layout.height));
        output.width = Math.ceil(layout.width * scale); output.height = Math.ceil(layout.height * scale);
        const original = ctx, originalSelected = selected;
        try { ctx = output.getContext('2d'); selected = null; ctx.setTransform(scale, 0, 0, scale, -layout.left * scale, -layout.top * scale); poster(scale); }
        finally { ctx = original; selected = originalSelected; }
        output.toBlob(blob => { if (!blob) { status('تعذر تصدير الصورة.'); return; } const url = URL.createObjectURL(blob), a = document.createElement('a'); a.download = 'family-tree.png'; a.href = url; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
    };
    document.getElementById('natural-image').addEventListener('click', exportImage);

    let loadError = '';
    try { familyData = familyData?.length ? normalize(familyData) : example(); }
    catch (error) { familyData = example(); loadError = `تعذر عرض البيانات المحفوظة: ${error.message} لم يتم تغيير النسخة المحفوظة.`; }
    selected = familyData[0].id; useFamilyData = true; refresh(); choose(selected); resize();
    if (loadError) status(loadError);
    if (document.fonts) document.fonts.ready.then(scheduleDraw);
    // Read-only diagnostics for layout regression checks; records stay unmodified.
    window.NaturalTree = { buildLayout, normalize, getLayout: () => layout, diagnose: () => layout && diagnose(layout) };
})();
