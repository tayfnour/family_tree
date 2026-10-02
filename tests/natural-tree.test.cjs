// Run with: node tests/natural-tree.test.cjs
'use strict';
const assert = require('node:assert/strict');
const { normalize, buildLayout, diagnose } = require('../natural-tree-layout.js');

let failed = 0;
function test(name, fn) {
    const start = Date.now();
    try { fn(); console.log(`ok   ${name} (${Date.now() - start} ms)`); }
    catch (error) { failed++; console.error(`FAIL ${name}\n     ${error.stack.split('\n').slice(0, 3).join('\n     ')}`); }
}

// Deterministic random families with uneven branches.
function family(count, seed, maxKids = 6) {
    let a = seed >>> 0;
    const rand = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const root = { name: 'الجد', children: [] }, all = [root], depth = new Map([[root, 1]]);
    while (all.length < count) {
        const parent = all[Math.floor(Math.pow(rand(), 0.7) * all.length)];
        if (parent.children.length >= maxKids || depth.get(parent) >= 14) continue;
        const child = { name: `فرد ${all.length}`, children: [] };
        parent.children.push(child); depth.set(child, depth.get(parent) + 1); all.push(child);
    }
    return [root];
}
const count = roots => roots.reduce((s, n) => s + 1 + count(n.children), 0);
function checkLayout(roots) {
    const layout = buildLayout(roots);
    assert.equal(layout.nodes.length, count(roots), 'every person is drawn');
    assert.equal(new Set(layout.nodes.map(n => n.person.id)).size, layout.nodes.length, 'each person once');
    for (const n of layout.nodes) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), 'finite position');
    const report = diagnose(layout);
    assert.equal(report.crossings, 0, 'branches never cross');
    assert.equal(report.overlaps, 0, 'names never overlap');
    assert.equal(report.leafOverlaps, 0, 'leaves never overlap');
    for (const n of layout.nodes) if (n.kind === 'leaf') assert.ok(n.leaf, 'every child without children sits on a leaf');
    for (const n of layout.nodes) if (n.kind === 'parent') assert.ok(!n.leaf, 'fathers sit on circles at their forks');
    return layout;
}

test('normalize accepts the supported formats', () => {
    assert.equal(normalize([{ name: 'أ' }, { name: 'ب' }]).length, 2);
    assert.equal(normalize({ familyData: [{ name: 'أ' }] })[0].name, 'أ');
    assert.equal(normalize({ roots: [{ name: 'أ' }] })[0].name, 'أ');
    assert.equal(normalize({ root: { name: 'أ', children: [{ name: 'ب' }] } })[0].children[0].name, 'ب');
    const withAncestors = normalize({ ancestors: ['الأقدم', { name: 'الأقرب' }], root: { name: 'الأصل' } });
    assert.equal(withAncestors[0].name, 'الأقدم');
    assert.equal(withAncestors[0].children[0].children[0].name, 'الأصل');
});
test('normalize rejects invalid records', () => {
    assert.throws(() => normalize([]));
    assert.throws(() => normalize([{ name: '  ' }]));
    assert.throws(() => normalize([{ name: 'أ', children: 'x' }]));
    assert.throws(() => normalize([{ name: 'أ'.repeat(121) }]));
    assert.throws(() => normalize([{ name: 'أ', children: Array.from({ length: 5000 }, () => ({ name: 'ب' })) }]));
    let deep = { name: '0' }; for (let i = 1, n = deep; i <= 100; i++) n = (n.children = [{ name: String(i) }])[0];
    assert.throws(() => normalize([deep]));
});
test('ids stay unique', () => {
    const data = normalize([{ id: 'x', name: 'أ', children: [{ id: 'x', name: 'ب' }] }]);
    assert.notEqual(data[0].id, data[0].children[0].id);
});

test('tiny trees: one person, a couple, several roots', () => {
    checkLayout(normalize([{ name: 'وحيد' }]));
    checkLayout(normalize([{ name: 'أب', children: [{ name: 'ابن' }] }]));
    const layout = checkLayout(normalize([{ name: 'أ', children: [{ name: 'ب' }] }, { name: 'ج' }, { name: 'د' }]));
    assert.equal(layout.nodes.filter(n => n.kind === 'medallion').length, 3);
});
test('ancestors with one child stand on the trunk', () => {
    const layout = checkLayout(normalize([{ name: 'جد أكبر', children: [{ name: 'جد', children: [{ name: 'أ' }, { name: 'ب' }] }] }]));
    assert.deepEqual(layout.chain.map(n => n.person.name), ['جد أكبر', 'جد']);
    assert.ok(layout.chain[0].y > layout.chain[1].y, 'the oldest is lowest');
});
test('random families of many shapes never cross', () => {
    for (const size of [2, 5, 12, 40, 90, 200, 450, 800]) for (const seed of [1, 2, 3]) checkLayout(normalize(family(size, seed * 97 + size)));
});
test('500 children of one parent', () => checkLayout(normalize([{ name: 'أ', children: Array.from({ length: 500 }, (_, i) => ({ name: `ابن ${i}` })) }])));
test('100 generations', () => {
    let deep = { name: '0' }; for (let i = 1, n = deep; i < 100; i++) n = (n.children = [{ name: String(i) }])[0];
    checkLayout(normalize([deep]));
});
test('5000 people', () => {
    const start = Date.now();
    checkLayout(normalize(family(5000, 7, 7)));
    assert.ok(Date.now() - start < 15000, 'large trees stay practical');
});
test('the crown grows with the family', () => {
    const small = buildLayout(normalize(family(50, 4))), big = buildLayout(normalize(family(1500, 4)));
    assert.ok(big.geometry.W > small.geometry.W * 1.5);
    assert.equal(small.foliage.length, 0, 'no nameless leaves');
});
test('adding one person keeps the crown in place', () => {
    const roots = normalize(family(300, 9));
    const before = buildLayout(roots);
    const grown = JSON.parse(JSON.stringify(roots));
    grown[0].children[0].children.push({ id: 'new-person', name: 'جديد', generation: 3, children: [] });
    const after = checkLayout(normalize(grown));
    assert.equal(after.geometry.W, before.geometry.W, 'same crown size');
});
test('layout is deterministic and never edits the records', () => {
    const roots = normalize(family(250, 11));
    const copy = JSON.stringify(roots);
    const a = buildLayout(roots), b = buildLayout(roots);
    assert.equal(JSON.stringify(roots), copy);
    assert.deepEqual(a.nodes.map(n => [n.x, n.y]), b.nodes.map(n => [n.x, n.y]));
});
test('fathers sit on their forks and only named leaves are drawn', () => {
    const layout = checkLayout(normalize(family(400, 13)));
    const forks = new Set(layout.edges.map(e => e.from));
    for (const n of layout.nodes) if (n.kind === 'parent') assert.ok(forks.has(n), 'every father is a fork');
    assert.equal(layout.foliage.length, 0, 'only named leaves');
    for (const n of layout.nodes) if (n.kind === 'parent') assert.ok(layout.edges.filter(e => e.from === n).length >= Math.min(1, n.children.length), 'branches split at the father');
    const tapered = layout.edges.filter(e => !e.axis && e.to.children?.length);
    assert.ok(tapered.every(e => e.w1 <= e.w0), 'branches thin towards their tip');
});
test('names and leaves stay inside the crown', () => {
    const layout = buildLayout(normalize(family(600, 5)));
    for (const n of layout.nodes) if (n.kind === 'leaf' || n.kind === 'parent') assert.ok(layout.crown.inside(n.x, n.y), 'name inside crown');
    for (const f of layout.foliage.slice(0, 2000)) assert.ok(f.x >= layout.left && f.x <= layout.left + layout.width && f.y >= layout.top && f.y <= layout.bottom);
});

if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
console.log('\nall tests passed');
