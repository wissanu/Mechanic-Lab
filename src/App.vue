<script setup lang="ts">
import { ref, computed } from 'vue'
import { levels, evaluate, ang, qyOf, g, type Design, type Res, type V } from './engine'

const li = ref(0)
const lv = computed(() => levels[li.value])
const mk = (i: number): Design[] =>
  levels[i].slots.map(s => ({ kind: null, T: 0, comp: false, qy: s.lock !== undefined ? qyOf(s, s.lock) : (s.yr[0] + s.yr[1]) / 2 }))
const designs = ref<Design[][]>(levels.map((_, i) => mk(i)))
const ds = computed(() => designs.value[li.value])
const done = ref(levels.map(() => false))
const res = ref<Res | null>(null)
const t = ref(0)
const hint = ref(false)
const svg = ref<SVGSVGElement | null>(null)
const drag = ref(-1)
let raf = 0

const sx = (x: number) => lv.value.ox + x * lv.value.S
const sy = (y: number) => lv.value.oy - y * lv.value.S
const fx = (p: V): V => [sx(p[0]), sy(p[1])]
const live = computed(() => evaluate(lv.value, ds.value))

// ท่าทางของโครงสร้างระหว่างพัง (คำนวณจากกลศาสตร์: a = ΣF/m, α = M/I)
const pose = computed(() => {
  const r = res.value, l = lv.value, T = t.value
  if (!r || r.ok) return { a: 0, dx: 0, dy: 0 }
  if (l.beam) {
    if (r.ev.some(e => e.m === 'pullout')) return { a: -0.25 * T, dx: 0, dy: -Math.min(0.5 * g * T * T, 3.4) }
    const W = l.loads.reduce((s, x) => s + Math.abs(x.f[1]), 0)
    const I = (W / g) * l.L * l.L / 3
    return { a: Math.max(-1.0, Math.min(0.9, 0.5 * (r.M / I) * T * T)), dx: 0, dy: 0 }
  }
  const k = (0.5 * T * T) / 50 // มวลสมมติ 50 kg
  return {
    a: 0,
    dx: Math.max(-2.2, Math.min(2.2, r.R[0] * k)),
    dy: Math.max(r.R[1] * k, l.floor + 0.25 - l.joint[1]),
  }
})
const tp = (p: V): V => {
  const q = pose.value
  if (!lv.value.beam) return [p[0] + q.dx, p[1] + q.dy]
  return [p[0] * Math.cos(q.a) - p[1] * Math.sin(q.a) + q.dx, p[0] * Math.sin(q.a) + p[1] * Math.cos(q.a) + q.dy]
}
const xy = (p: V): V => fx(tp(p))

const anchors = computed(() => lv.value.slots.map((s, i) => fx([s.wall, ds.value[i].qy])))
const arrows = computed(() =>
  lv.value.loads.map(l => {
    const a = xy(l.p), k = lv.value.fs
    return { x1: a[0], y1: a[1], x2: a[0] + l.f[0] * k, y2: a[1] - l.f[1] * k, label: l.label }
  }),
)
const truss = computed(() => {
  if (!lv.value.beam) return null
  const n = [0, 1, 2, 3, 4].map(i => i * 1.5)
  const B = n.map(x => xy([x, 0])), T = n.map(x => xy([x, 1.2 - 0.2 * x]))
  let d = `M${B[0]}L${B[4]}M${T[0]}L${T[4]}`
  B.forEach((b, i) => { d += `M${b}L${T[i]}`; if (i < 4) d += `M${b}L${T[i + 1]}` })
  return { d, deck: `M${B[0]}L${B[4]}` }
})

const evOf = (i: number) => (res.value && !res.value.ok ? res.value.ev.find(e => e.i === i) : undefined)
function paths(i: number): string[] {
  const s = lv.value.slots[i], P = xy(s.at), Q = anchors.value[i], T = t.value, e = evOf(i)
  const mid = [(P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2]
  const f = (a: number[], b: number[], c: number[]) => `M${a} Q${c} ${b}`
  if (!e) return [f(Q, P, mid)]
  if (e.m === 'slack') return [f(Q, P, [mid[0], mid[1] + Math.min(T * 40, 70)])]
  if (e.m === 'buckle') {
    const n = [-(P[1] - Q[1]), P[0] - Q[0]], k = Math.min(T * 30, 60) / (Math.hypot(n[0], n[1]) || 1)
    return [f(Q, P, [mid[0] + n[0] * k, mid[1] + n[1] * k])]
  }
  const fall = Math.min(T * T * 30, 100)
  const a = [Q[0] + (P[0] - Q[0]) * 0.3, Q[1] + (P[1] - Q[1]) * 0.3 + fall]
  const b = [P[0] + (Q[0] - P[0]) * 0.3, P[1] + (Q[1] - P[1]) * 0.3]
  return [f(Q, a, [(Q[0] + a[0]) / 2, (Q[1] + a[1]) / 2]), f(P, b, [(P[0] + b[0]) / 2, (P[1] + b[1]) / 2])]
}
const col = (i: number) => (evOf(i) ? '#dc2626' : ds.value[i].kind === 'cable' ? '#2563eb' : ds.value[i].kind === 'rod' ? '#475569' : '#dc2626')

const angOf = (i: number) => Math.round(ang(lv.value.slots[i], ds.value[i].qy) * 10) / 10
function setAng(i: number, e: Event) {
  const v = parseFloat((e.target as HTMLInputElement).value)
  if (!isNaN(v)) ds.value[i].qy = qyOf(lv.value.slots[i], Math.max(-85, Math.min(85, v)))
}
function move(e: PointerEvent) {
  if (drag.value < 0 || !svg.value) return
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.value.getScreenCTM()!.inverse())
  const s = lv.value.slots[drag.value]
  ds.value[drag.value].qy = Math.min(s.yr[1], Math.max(s.yr[0], (lv.value.oy - p.y) / lv.value.S))
}

function run() {
  cancelAnimationFrame(raf)
  res.value = evaluate(lv.value, ds.value)
  if (res.value.ok) done.value[li.value] = true
  t.value = 0
  const t0 = performance.now()
  const step = (n: number) => {
    t.value = (n - t0) / 1000
    if (t.value < 6) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
}
function stop() { cancelAnimationFrame(raf); res.value = null; t.value = 0 }
function reset() { stop(); designs.value[li.value] = mk(li.value) }
function go(i: number) { stop(); li.value = i; hint.value = false }

const msg = computed(() => {
  const r = res.value, l = lv.value
  if (!r) return []
  if (r.ok) return ['✅ สมดุล! แรงลัพธ์ ≈ 0 และชิ้นส่วนทุกชิ้นรับแรงได้ โครงสร้างยืนหยัด']
  const o: string[] = []
  if (r.empty) o.push('❓ ยังใส่ชิ้นส่วนสีแดงไม่ครบ (เลือกชนิดและใส่แรงให้ครบ)')
  for (const e of r.ev) {
    const n = e.i >= 0 ? l.slots[e.i].label : ''
    o.push(
      e.m === 'snap' ? `💥 ${n}: แรงดึงเกินที่ทนได้ → ขาด!`
        : e.m === 'slack' ? `〰 ${n}: สลิงรับแรงอัด (ดัน) ไม่ได้ → หย่อน ไม่ทำงาน`
        : e.m === 'buckle' ? `🔩 ${n}: แรงอัดเกินที่เหล็กทนได้ → โก่งเดาะ!`
        : `🧱 บานพับรับแรง ${Math.round(r.hr)} N เกิน ${l.hinge} N → หลุดจากกำแพง!`,
    )
  }
  if (r.un) o.push(l.beam ? `⚖ ΣM = ${r.M.toFixed(0)} N·m ≠ 0 → คานหมุน${r.M > 0 ? 'ขึ้น' : 'ลง'}` : `⚖ แรงลัพธ์ ${r.hr.toFixed(0)} N ≠ 0 → จุดต่อถูกเหวี่ยง ตกพื้น`)
  return o
})
</script>

<template>
  <div class="app">
    <header>
      <h1>🌉 ห้องทดลองสะพานโครงถัก</h1>
      <nav>
        <button v-for="(l, i) in levels" :key="i" :class="{ on: i === li }" @click="go(i)">{{ done[i] ? '✅ ' : '' }}{{ l.title }}</button>
      </nav>
    </header>
    <main>
      <svg ref="svg" viewBox="0 0 800 600" @pointermove="move" @pointerup="drag = -1" @pointerleave="drag = -1">
        <defs>
          <marker id="ah" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0L8,4L0,8z" fill="#ea580c" /></marker>
        </defs>
        <rect x="0" y="0" width="800" height="600" fill="#f8fafc" />
        <rect x="0" :y="sy(lv.floor)" width="800" height="600" :fill="lv.beam ? '#bfdbfe' : '#d6d3d1'" />
        <text x="790" :y="sy(lv.floor) + 24" text-anchor="end" font-size="14" fill="#64748b">{{ lv.beam ? 'แม่น้ำ' : 'พื้น' }}</text>
        <rect v-for="w in lv.walls" :key="w" :x="w <= 0 ? sx(w) - 22 : sx(w)" :y="sy(lv.yt)" width="22" :height="sy(lv.yb) - sy(lv.yt)" fill="#94a3b8" />

        <g v-if="truss">
          <path :d="truss.d" stroke="#334155" stroke-width="2" fill="none" />
          <path :d="truss.deck" stroke="#1e293b" stroke-width="7" />
          <circle :cx="fx([0, 0])[0]" :cy="fx([0, 0])[1]" r="10" fill="#facc15" stroke="#0f172a" stroke-width="2" />
          <text :x="fx([0, 0])[0] + 14" :y="fx([0, 0])[1] + 28" font-size="13">จุดหมุน O (บานพับ)</text>
        </g>
        <g v-else>
          <circle :cx="xy(lv.joint)[0]" :cy="xy(lv.joint)[1]" r="9" fill="#0f172a" />
          <text :x="xy(lv.joint)[0] + 12" :y="xy(lv.joint)[1] + 22" font-size="14">O</text>
        </g>

        <g v-for="(s, i) in lv.slots" :key="i">
          <path v-for="(d, k) in paths(i)" :key="k" :d="d" fill="none" :stroke="col(i)" :stroke-width="ds[i].kind === 'rod' ? 8 : 3.5" :stroke-dasharray="ds[i].kind ? '' : '9 6'" stroke-linecap="round" />
          <circle :cx="anchors[i][0]" :cy="anchors[i][1]" r="11" :fill="ds[i].kind ? '#2563eb' : '#dc2626'" stroke="#fff" stroke-width="3" :style="{ cursor: s.lock === undefined ? 'grab' : 'not-allowed', touchAction: 'none' }" @pointerdown.prevent="s.lock === undefined && (drag = i)" />
          <text :x="anchors[i][0] + (s.wall <= 0 ? 18 : -18)" :y="anchors[i][1] + 4" :text-anchor="s.wall <= 0 ? 'start' : 'end'" font-size="13" fill="#7f1d1d">{{ s.label }} · {{ angOf(i) }}°{{ s.lock === undefined ? ' (ลากได้)' : '' }}</text>
        </g>

        <g v-for="(a, i) in arrows" :key="'a' + i">
          <line :x1="a.x1" :y1="a.y1" :x2="a.x2" :y2="a.y2" stroke="#ea580c" stroke-width="3" marker-end="url(#ah)" />
          <text :x="a.x2 + 6" :y="a.y2 + (a.y2 > a.y1 ? 16 : -6)" font-size="13" fill="#9a3412">{{ a.label }}</text>
        </g>
      </svg>

      <aside>
        <h2>{{ lv.title }}</h2>
        <p>{{ lv.story }}</p>
        <p class="note">สลิงทนดึง ≤ {{ lv.cableMax }} N · เหล็กทนดึง ≤ {{ lv.rodTen }} N · เหล็กอัดแล้วโก่งเดาะเมื่อ &gt; {{ lv.kb }}/L² N (ยิ่งยาวยิ่งทนน้อย)</p>
        <button class="ghost" @click="hint = !hint">💡 คำใบ้</button>
        <p v-if="hint" class="hint">{{ lv.hint }}</p>

        <div v-for="(s, i) in lv.slots" :key="i" class="card" :class="{ empty: !ds[i].kind }">
          <b>{{ s.label }}</b>
          <div class="row">
            <button :class="{ on: ds[i].kind === 'cable' }" @click="ds[i].kind = 'cable'">🪢 สลิง</button>
            <button :class="{ on: ds[i].kind === 'rod' }" @click="ds[i].kind = 'rod'">🔩 เหล็ก</button>
          </div>
          <label>มุมจากจุดต่อ (°) <input type="number" step="0.5" :value="angOf(i)" :disabled="s.lock !== undefined" @change="setAng(i, $event)" /></label>
          <label>แรง (N) <input type="number" min="0" step="10" v-model.number="ds[i].T" /></label>
          <label>ชนิดแรง
            <select v-model="ds[i].comp">
              <option :value="false">ดึง (Tension)</option>
              <option :value="true">ดัน (Compression)</option>
            </select>
          </label>
        </div>

        <div class="fbd">
          <template v-if="lv.beam">ΣM<sub>O</sub> = {{ live.M.toFixed(0) }} N·m · แรงที่บานพับ = {{ live.hr.toFixed(0) }} N (ทนได้ {{ lv.hinge }})</template>
          <template v-else>ΣFx = {{ live.R[0].toFixed(0) }} N · ΣFy = {{ live.R[1].toFixed(0) }} N</template>
          <br />ค่าคงเหลือต้องเป็น 0 จึงจะสมดุล
        </div>
        <div class="act">
          <button class="go" @click="run">▶ ทดสอบ</button>
          <button @click="reset">↺ รีเซ็ต</button>
        </div>
        <div v-if="res" class="out" :class="res.ok ? 'ok' : 'bad'"><p v-for="(m, k) in msg" :key="k">{{ m }}</p></div>
      </aside>
    </main>
  </div>
</template>

<style>
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, 'Noto Sans Thai', sans-serif; background: #e2e8f0; color: #0f172a; }
header { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 10px 16px; background: #0f172a; color: #fff; }
h1 { font-size: 18px; margin: 0; }
nav { display: flex; flex-wrap: wrap; gap: 6px; }
button { font: inherit; padding: 6px 12px; border: 1px solid #94a3b8; border-radius: 8px; background: #fff; cursor: pointer; }
button.on { background: #2563eb; border-color: #2563eb; color: #fff; }
button.go { background: #16a34a; border-color: #16a34a; color: #fff; font-weight: 700; }
button.ghost { background: transparent; }
main { display: flex; gap: 12px; padding: 12px; align-items: flex-start; }
svg { flex: 1; min-width: 0; max-height: calc(100vh - 90px); border-radius: 12px; border: 1px solid #cbd5e1; user-select: none; }
aside { width: 340px; background: #fff; border-radius: 12px; padding: 14px; font-size: 14px; line-height: 1.5; }
aside h2 { margin: 0 0 6px; font-size: 17px; }
.note { font-size: 12px; color: #64748b; }
.hint { background: #fef9c3; padding: 8px; border-radius: 8px; }
.card { border: 1px solid #cbd5e1; border-left: 5px solid #2563eb; border-radius: 8px; padding: 8px 10px; margin: 8px 0; display: grid; gap: 6px; }
.card.empty { border-left-color: #dc2626; background: #fef2f2; }
.row { display: flex; gap: 6px; }
label { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
input, select { width: 130px; padding: 4px 6px; font: inherit; }
.fbd { background: #f1f5f9; padding: 8px; border-radius: 8px; font-family: ui-monospace, monospace; font-size: 12.5px; }
.act { display: flex; gap: 8px; margin: 10px 0; }
.out { padding: 8px 12px; border-radius: 8px; }
.out p { margin: 4px 0; }
.out.ok { background: #dcfce7; color: #14532d; }
.out.bad { background: #fee2e2; color: #7f1d1d; }
@media (max-width: 900px) { main { flex-direction: column; } aside { width: 100%; } }
</style>
