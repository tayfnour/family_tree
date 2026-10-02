/* Data-driven botanical layout. Coordinates belong to an expandable world,
   never to the viewport. Layout data is kept separate from family records. */
(() => {
    'use strict';
    const TAU = Math.PI * 2;
    const { normalize, buildLayout } = window.FamilyTreeLayout;
    // Family leaves are the named endpoints. Decorative foliage is optional
    // and disabled by default so every visible leaf carries a person name.
    config.showFoliage = config.showFoliage === true;
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
        return normalize([make('الجد المؤسس', Array.from({ length: 5 }, (_, i) =>
            make(names[i], Array.from({ length: 3 }, (_, j) =>
                make(names[(i * 3 + j + 5) % names.length], Array.from({ length: 2 + (i + j) % 3 }, (_, k) => make(names[(i * 7 + j * 3 + k) % names.length])))))))]);
    }

    function wood(points, startWidth, endWidth, seed = 0) {
        const path = new Path2D(), normals = [];
        for (let i = 0; i < points.length; i++) {
            const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
            const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            normals.push({ x: -(b.y - a.y) / len, y: (b.x - a.x) / len });
        }
        const widths = points.map((_, i) => {
            const t = i / (points.length - 1);
            return (startWidth * (1 - t) + endWidth * t) * (1 + Math.sin(t * 18 + seed) * 0.045);
        });
        for (const side of [1, -1]) {
            for (let j = 0; j < points.length; j++) {
                const i = side === 1 ? j : points.length - 1 - j;
                const x = points[i].x + normals[i].x * widths[i] * side / 2;
                const y = points[i].y + normals[i].y * widths[i] * side / 2;
                if (side === 1 && j === 0) path.moveTo(x, y); else path.lineTo(x, y);
            }
        }
        path.closePath();
        const p = points[0], normal = normals[0];
        const gradient = ctx.createLinearGradient(p.x - normal.x * startWidth / 2, p.y - normal.y * startWidth / 2, p.x + normal.x * startWidth / 2, p.y + normal.y * startWidth / 2);
        gradient.addColorStop(0, config.shadowColor); gradient.addColorStop(0.35, config.trunkColor);
        gradient.addColorStop(0.56, config.highlightColor); gradient.addColorStop(0.76, config.branchColor); gradient.addColorStop(1, config.shadowColor);
        ctx.fillStyle = gradient; ctx.fill(path);
        ctx.save(); ctx.clip(path);
        for (let line = 0; line < 9; line++) {
            const offset = (line / 8 - 0.5) * 0.9;
            ctx.beginPath();
            points.forEach((point, i) => {
                const shift = widths[i] * offset + Math.sin(i * 0.7 + line + seed) * Math.min(2, startWidth / 14);
                const x = point.x + normals[i].x * shift, y = point.y + normals[i].y * shift;
                if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.lineWidth = line % 2 ? 0.65 : 1.15;
            ctx.strokeStyle = line % 2 ? '#e7bd7259' : '#21170c68'; ctx.stroke();
        }
        ctx.restore();
    }

    function curve(edge) {
        const from = edge.from, to = edge.to;
        const rawDx = to.x - from.x, rawDy = to.y - from.y;
        const rawLength = Math.hypot(rawDx, rawDy) || 1;
        // Start at the rim of the parent badge. This prevents all children
        // from drawing a dark knot through the badge centre.
        const startPad = from.depth === 0 ? 10 : Math.min(28, rawLength * 0.16);
        const a = { x: from.x + rawDx / rawLength * startPad, y: from.y + rawDy / rawLength * startPad };
        const b = to;
        const dx = b.x - a.x, dy = b.y - a.y;
        const length = Math.hypot(dx, dy) || 1;
        const phase = Math.sin(b.angle * 11 + b.depth * 2.1) * Math.PI;
        const turn = Math.sin(b.angle * 9 + b.depth * 2.1) > 0 ? 1 : -1;
        // Reserve each descendant's own sector: narrow twigs bend less than
        // the thick main limbs, keeping neighbouring family branches legible.
        const bendRoom = Math.min(170, length * 0.34, 18 + b.sectorWidth * length * 0.72);
        const c1 = { x: a.x + dx * 0.20, y: a.y + dy * 0.38 };
        const c2 = { x: b.x - dx * 0.22, y: b.y - dy * 0.26 };
        return Array.from({ length: 61 }, (_, i) => {
            const t = i / 60, u = 1 - t;
            // Two gentle coils give the limb the hand-drawn, living twist of
            // the reference. The envelope reaches zero at both relatives,
            // while the sector limit keeps the coil away from siblings.
            const envelope = Math.sin(t * Math.PI);
            const coil = 0.72 + 0.28 * Math.sin(t * TAU + phase);
            const ripple = Math.sin(t * TAU * 1.35 + phase * 0.7) * 0.22;
            const bend = turn * bendRoom * envelope * (coil + ripple);
            return { x: u ** 3 * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * b.x - dy / length * bend,
                y: u ** 3 * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * b.y + dx / length * bend };
        });
    }

    function leaf(x, y, size, angle) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-size * 0.6, -size * 0.55, -size * 0.25, -size, 0, -size * 1.2);
        ctx.bezierCurveTo(size * 0.65, -size * 0.65, size * 0.4, -size * 0.1, 0, 0);
        const g = ctx.createLinearGradient(-size / 2, 0, size / 2, -size);
        g.addColorStop(0, '#294a21'); g.addColorStop(0.48, config.leafColor); g.addColorStop(1, '#b4ca66');
        ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = '#466532'; ctx.lineWidth = 0.65; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -size * 1.04);
        for (let i = 1; i < 4; i++) { ctx.moveTo(0, -size * i / 5); ctx.lineTo(size * 0.22, -size * (i + 1) / 5); ctx.moveTo(0, -size * i / 5); ctx.lineTo(-size * 0.19, -size * (i + 1) / 5); }
        ctx.strokeStyle = '#d6db8b99'; ctx.lineWidth = 0.6; ctx.stroke(); ctx.restore();
    }

    function label(n, isSelected) {
        const root = n.depth === 0 || !n.parent;
        const terminal = !n.children.length && !root;
        // A single fixed leaf size keeps the family endpoints visually equal,
        // even when one name is longer than another.
        const w = root ? 43 : terminal ? 35 : 29, h = terminal ? 18 : w;
        ctx.save(); ctx.translate(n.x, n.y);
        if (terminal) ctx.rotate(Math.max(-0.45, Math.min(0.45, (n.angle + Math.PI / 2) * 0.38)));
        ctx.shadowColor = '#2c331835'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
        if (root) {
            ctx.beginPath();
            for (let i = 0; i < 64; i++) { const a = i * TAU / 64, r = i % 2 ? 1.1 : 1.18; const x = Math.cos(a) * w * r, y = Math.sin(a) * h * r; if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
            ctx.closePath(); ctx.fillStyle = '#b89643'; ctx.fill();
        }
        ctx.beginPath();
        if (terminal) { ctx.moveTo(-w, 10); ctx.bezierCurveTo(-w * 0.82, -19, w * 0.2, -25, w, -10); ctx.bezierCurveTo(w * 0.82, 19, -w * 0.2, 25, -w, 10); }
        else ctx.ellipse(0, 0, w, h, 0, 0, TAU);
        const g = ctx.createLinearGradient(0, -h, 0, h);
        g.addColorStop(0, terminal ? '#d1e59b' : '#fff7dc'); g.addColorStop(0.48, terminal ? '#accd76' : '#f5e6be'); g.addColorStop(1, terminal ? '#759f49' : root ? '#dec471' : '#e9d8ad');
        ctx.fillStyle = g; ctx.fill(); ctx.shadowColor = 'transparent';
        ctx.strokeStyle = isSelected ? '#b35a31' : terminal ? '#547c36' : '#b2914d'; ctx.lineWidth = isSelected ? 3 : 1.4; ctx.stroke();
        if (terminal) {
            ctx.beginPath(); ctx.moveTo(-w + 3, 9); ctx.quadraticCurveTo(0, 0, w - 3, -9);
            for (let i = -2; i <= 2; i++) { const x = i * 9, y = -x * 0.28; ctx.moveTo(x, y); ctx.quadraticCurveTo(x - 4, y - 6, x - 9, y - 9); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 4, y + 6, x + 9, y + 9); }
            ctx.strokeStyle = '#496d3555'; ctx.lineWidth = 0.8; ctx.stroke();
        }
        ctx.fillStyle = '#293d23'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = 'rtl';
        const name = n.person.name;
        let fontSize = root ? 19 : terminal ? 10 : 15;
        ctx.font = `bold ${fontSize}px Tajawal, Tahoma, sans-serif`;
        // Long names wrap inside the label; the editor always shows the full name.
        if (ctx.measureText(name).width > w * 1.7) {
            const words = name.split(/\s+/), middle = Math.ceil(words.length / 2);
            const lines = words.length > 1 ? [words.slice(0, middle).join(' '), words.slice(middle).join(' ')] : [name];
            ctx.font = `bold ${terminal ? 8 : 12}px Tajawal, Tahoma, sans-serif`;
            lines.forEach((line, i) => ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * (terminal ? 8 : 15), w * 1.75));
        } else ctx.fillText(name, 0, 1);
        ctx.restore();
    }

    function poster() {
        const l = layout;
        ctx.fillStyle = '#faf8ec'; ctx.fillRect(l.left, l.top, l.width, l.height);
        const wash = ctx.createRadialGradient(0, -l.height * 0.35, 40, 0, -l.height * 0.35, l.width * 0.65);
        wash.addColorStop(0, '#edf2df'); wash.addColorStop(1, '#faf8ec');
        ctx.fillStyle = wash; ctx.fillRect(l.left + 16, l.top + 16, l.width - 32, l.height - 32);
        [10, 15, 23].forEach((inset, i) => { ctx.strokeStyle = i === 1 ? '#657850' : '#b79954'; ctx.lineWidth = i === 1 ? 3 : 1; ctx.strokeRect(l.left + inset, l.top + inset, l.width - inset * 2, l.height - inset * 2); });
        // Small botanical corner ornaments, all vector-drawn.
        for (const x of [l.left + 35, l.left + l.width - 35]) for (const y of [l.top + 35, l.top + l.height - 35]) {
            ctx.save(); ctx.translate(x, y); ctx.strokeStyle = '#b79954'; ctx.lineWidth = 1;
            for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.ellipse(0, 9, 4, 12, 0.5, 0, TAU); ctx.stroke(); } ctx.restore();
        }
        ctx.textAlign = 'center'; ctx.direction = 'rtl'; ctx.fillStyle = '#294a35';
        ctx.font = 'bold 32px Tajawal, Tahoma, sans-serif'; ctx.fillText(title, 0, l.top + 69, l.width - 150);
        ctx.font = '13px Tajawal, Tahoma, sans-serif'; ctx.fillStyle = '#9d834d'; ctx.fillText('جذورٌ تجمعنا … وأغصانٌ تمتد', 0, l.top + 97);
        const ground = l.trunkHeight;
        ctx.beginPath(); ctx.ellipse(0, ground + 13, Math.min(l.width * 0.36, 350), 28, 0, 0, TAU);
        ctx.fillStyle = '#b3bc7c35'; ctx.fill();
        for (let i = 0; i < 100; i++) {
            const x = Math.sin(i * 47) * Math.min(l.width * 0.37, 370), y = ground + 15 + Math.sin(i * 17) * 12;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x - 6, y - 12, x + Math.sin(i) * 13, y - 13 - (i % 13));
            ctx.strokeStyle = i % 2 ? '#899e535e' : '#b2b9716e'; ctx.lineWidth = 1.3; ctx.stroke();
        }
        for (let i = -3; i <= 3; i++) {
            const pts = Array.from({ length: 25 }, (_, k) => { const t = k / 24; return { x: i * 7 + i * 40 * t, y: ground - 36 + 50 * t - 10 * t * t }; });
            wood(pts, 22, 1, i);
        }
        const trunk = Array.from({ length: 40 }, (_, i) => { const t = i / 39; return { x: Math.sin(t * Math.PI) * 12, y: ground * (1 - t) - 10 }; });
        wood(trunk, l.trunkWidth * 1.3, l.trunkWidth * 0.52, 2);
        // Spatial buckets keep decorative leaves clear of name labels.
        const buckets = new Map();
        l.nodes.forEach(n => { const key = `${Math.floor(n.x / 120)},${Math.floor(n.y / 120)}`; if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(n); });
        function clear(x, y) {
            const bx = Math.floor(x / 120), by = Math.floor(y / 120);
            for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const n of buckets.get(`${bx + i},${by + j}`) || []) if (Math.abs(n.x - x) < 68 && Math.abs(n.y - y) < 50) return false;
            return true;
        }
        l.edges.forEach((edge, index) => {
            const pts = curve(edge), width = Math.min(l.trunkWidth * 0.67, 7 + Math.sqrt(edge.to.weight) * 9);
            // The final segment is a separate, narrow twig. It gives every
            // terminal leaf a visible stem while keeping the main limb clean.
            const twigStart = Math.max(1, pts.length - 9);
            wood(pts.slice(0, twigStart + 1), width, Math.max(2.8, width * 0.48), index);
            wood(pts.slice(twigStart), Math.max(1.8, width * 0.48), 1.15, index + 0.5);
            if (config.showFoliage) {
                for (let k = 8; k < 38; k += 5) {
                    const p = pts[k], q = pts[k - 1], side = k % 2 ? 1 : -1;
                    const angle = Math.atan2(p.y - q.y, p.x - q.x) + Math.PI / 2 + side * 0.9;
                    const size = 25 + (index + k) % 15;
                    if (clear(p.x + Math.sin(angle) * size * 0.5, p.y - Math.cos(angle) * size * 0.5)) leaf(p.x, p.y, size, angle);
                }
            }
        });
        l.nodes.forEach(n => label(n, n.person.id === selected));
        ctx.textAlign = 'center'; ctx.fillStyle = '#85866a'; ctx.font = '12px Tajawal, Tahoma, sans-serif';
        ctx.fillText(`${l.nodes.length.toLocaleString('ar')} فردًا  ·  ${Math.max(...l.nodes.map(n => n.person.generation)).toLocaleString('ar')} أجيال`, 0, l.bottom - 35);
    }

    function fit() {
        if (!layout) return;
        fitScale = Math.min((canvas.width - 28) / layout.width, (canvas.height - 28) / layout.height);
        camera = { scale: fitScale, x: (canvas.width - layout.width * fitScale) / 2 - layout.left * fitScale, y: (canvas.height - layout.height * fitScale) / 2 - layout.top * fitScale };
        scheduleDraw();
    }
    function render() {
        if (dirty || !layout) { layout = buildLayout(familyData); dirty = false; fit(); }
        ctx.save(); ctx.setTransform(camera.scale, 0, 0, camera.scale, camera.x, camera.y); poster(); ctx.restore();
        document.getElementById('natural-zoom').textContent = `${Math.round(camera.scale / fitScale * 100)}%`;
    }
    drawFamilyDataTree = render;

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
      <div class="natural-legend"><span>الآباء: دوائر</span><span>الأبناء في الأطراف: أوراق</span></div>
      <div class="natural-row"><button id="natural-export">حفظ JSON</button><button id="natural-import" class="natural-secondary">استيراد JSON</button></div>
      <input type="file" id="familyJsonFile" accept=".json,application/json" hidden>
      <div class="natural-row"><button id="natural-image" class="natural-secondary">تنزيل صورة الشجرة كاملة</button></div>
      <details class="natural-details"><summary>بيانات تجريبية وخيارات الرسم</summary><p class="natural-muted">التوليد يستبدل بيانات الشجرة الحالية ببيانات تجريبية.</p>${oldGenerator}<button id="natural-generate" type="button">توليد بيانات تجريبية</button>
      <label class="natural-field"><input type="checkbox" id="natural-foliage"> إظهار الأوراق الزخرفية (بدون أسماء)</label>
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
    document.getElementById('natural-foliage').checked = config.showFoliage;
    document.getElementById('natural-foliage').addEventListener('change', event => { config.showFoliage = event.target.checked; saveConfig(); markRandomTreeDirty(); scheduleDraw(); });
    document.getElementById('natural-title').addEventListener('input', event => { title = event.target.value.trim() || 'شجرة العائلة'; storage.set('familyTreeTitle', title); scheduleDraw(); });
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
            const n = [...layout.nodes].reverse().find(n => Math.abs(n.x - x) < 52 && Math.abs(n.y - y) < 34);
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
        try { ctx = output.getContext('2d'); selected = null; ctx.setTransform(scale, 0, 0, scale, -layout.left * scale, -layout.top * scale); poster(); }
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
    window.NaturalTree = { buildLayout, normalize, getLayout: () => layout };
})();
