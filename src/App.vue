<script setup lang="ts">
import { ref, computed } from 'vue'
import { levels, evaluate, ang, qyOf, dirOf, g, type Design, type Res, type V } from './engine'

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
const tab = ref<'real' | 'fbd'>('real') // ใช้เฉพาะจอมือถือ: สลับดูทีละ panel
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
  tab.value = 'real'
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

const jp = computed(() => xy(lv.value.joint))
const bdx = computed(() => Math.max(-40, Math.min(55, pose.value.dx * lv.value.S))) // ตุ้มถ่วงลง/ขึ้นตามจุดต่อ
const spin = computed(() => (res.value ? t.value * 220 : 0))
const cap = [
  'ตุ้มเหล็ก 100 kg ห้อยที่ห่วง O · เชือกพาดรอกไปผูกตุ้มถ่วง 100 kg → ให้แรง F = 981 N ไปทางขวา · สลิงสีแดง = ตัวที่คุณต้องออกแบบ',
  'ป้ายร้านหนัก 500 N แขวนที่ O ด้วยสลิงสองเส้นจากกำแพงซ้าย–ขวา (มุม 40° และ 30°)',
  'คนงาน 65 kg ห้อยตัวที่ O · รถกว้านดึงเชือกลงเฉียง 25° ด้วยแรง P = 1,000 N · มีเหล็กค้ำแนวนอนดันจากกำแพง',
  'สะพานโครงถักยื่นจากหน้าผา ยึดบานพับที่ O · กล่องน้ำหนักสะพาน 3,000 N ที่ 3 m · รถบรรทุก 4,000 N ที่ 5 m',
]
const cols = ['#ea580c', '#2563eb', '#475569', '#16a34a', '#dc2626']
const fbd = computed(() => {
  const l = lv.value, r = live.value
  const k = 110 / Math.max(500, ...l.loads.map(a => Math.hypot(a.f[0], a.f[1])), ...r.F.map(f => Math.hypot(f[0], f[1])), l.beam ? r.hr : 0)
  const P = (p: V): V => (l.beam ? [90 + p[0] * 70, 300 - p[1] * 70] : [280, 300])
  const out: { x1: number; y1: number; x2: number; y2: number; label: string; c: string; dash: boolean; lx: number; ly: number; ta: string }[] = []
  const add = (p: V, f: V, label: string, c: string, dash = false) => {
    const a = P(p), x2 = a[0] + f[0] * k, y2 = a[1] - f[1] * k
    out.push({ x1: a[0], y1: a[1], x2, y2, label, c, dash, lx: x2 + (f[0] >= 0 ? 8 : -8), ly: y2 + (f[1] > 0 ? -8 : 16), ta: f[0] >= 0 ? 'start' : 'end' })
  }
  l.loads.forEach(a => add(a.p, a.f, a.label, '#ea580c'))
  l.slots.forEach((s, i) => {
    const d = ds.value[i], f = r.F[i]
    if (f[0] || f[1]) add(s.at, f, `${s.label}: ${d.comp ? 'ดัน' : 'ดึง'} ${d.T} N @ ${angOf(i)}°`, d.kind === 'cable' ? '#2563eb' : '#475569')
    else { const u = dirOf(s, d.qy); add(s.at, [u[0] * 90 / k, u[1] * 90 / k], `${s.label} = ?`, '#dc2626', true) }
  })
  if (l.beam) add([0, 0], [-r.R[0], -r.R[1]], `แรงบานพับ ${r.hr.toFixed(0)} N`, '#16a34a')
  return out
})

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
    <div class="tabs">
      <button :class="{ on: tab === 'real' }" @click="tab = 'real'">🏗 ภาพจริง</button>
      <button :class="{ on: tab === 'fbd' }" @click="tab = 'fbd'">📐 FBD</button>
      <span class="eq" :class="res ? (res.ok ? 'ok' : 'bad') : ''">
        <template v-if="res">{{ res.ok ? '✅ สมดุล' : '❌ ไม่ผ่าน' }}</template>
        <template v-else-if="lv.beam">ΣM {{ live.M.toFixed(0) }}</template>
        <template v-else>ΣFx {{ live.R[0].toFixed(0) }} · ΣFy {{ live.R[1].toFixed(0) }}</template>
      </span>
    </div>
    <main>
      <div class="stage">
        <!-- ครึ่งซ้าย: ภาพจริงก่อนสร้าง (การ์ตูน 2D) -->
        <section class="pn" :class="{ off: tab !== 'real' }">
          <h3>🏗 ภาพจริงก่อนสร้าง <small>{{ cap[li] }}</small></h3>
          <svg ref="svg" viewBox="0 0 560 600" @pointermove="move" @pointerup="drag = -1" @pointercancel="drag = -1" @pointerleave="drag = -1">
            <defs>
              <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bae6fd" /><stop offset="1" stop-color="#f0f9ff" /></linearGradient>
              <pattern id="brick" width="26" height="14" patternUnits="userSpaceOnUse"><rect width="26" height="14" fill="#c2410c" /><path d="M0 7H26M13 0V7M6 7V14M19 7V14" stroke="#7c2d12" stroke-width="1.5" /></pattern>
              <pattern id="wv" width="40" height="12" patternUnits="userSpaceOnUse"><path d="M0 6Q10 0 20 6T40 6" fill="none" stroke="#fff" stroke-width="2" opacity=".75" /></pattern>
            </defs>
            <rect width="560" height="600" fill="url(#sky)" />
            <g class="cloud"><ellipse cx="120" cy="60" rx="38" ry="14" fill="#fff" /><ellipse cx="146" cy="52" rx="26" ry="14" fill="#fff" /></g>
            <rect x="0" :y="sy(lv.floor)" width="560" height="600" :fill="lv.beam ? '#60a5fa' : '#a8a29e'" />
            <rect v-if="!lv.beam" x="0" :y="sy(0)" width="560" height="9" fill="#65a30d" stroke="#365314" stroke-width="2" />
            <rect v-else class="wv" x="-40" :y="sy(lv.floor) + 6" width="640" height="14" fill="url(#wv)" />
            <!-- กำแพงอิฐ + ราง (ลากจุดยึดขึ้นลงได้) -->
            <rect v-for="w in lv.walls" :key="w" :x="w <= 0 ? sx(w) - 24 : sx(w)" :y="sy(lv.yt)" width="24" :height="sy(lv.yb) - sy(lv.yt)" fill="url(#brick)" stroke="#1f2937" stroke-width="3" />
            <rect v-for="(s, i) in lv.slots" :key="'tr' + i" :x="s.wall <= 0 ? sx(s.wall) - 9 : sx(s.wall) + 1" :y="sy(s.yr[1]) - 8" width="8" :height="sy(s.yr[0]) - sy(s.yr[1]) + 16" rx="4" fill="#1f2937" opacity=".55" />

            <!-- ชิ้นส่วนที่ผู้เล่นออกแบบ: สลิง/เหล็ก (ยืด-หด-เอียงตามจุดยึดอัตโนมัติ) -->
            <g v-for="(s, i) in lv.slots" :key="i">
              <template v-for="(d, k) in paths(i)" :key="k">
                <template v-if="ds[i].kind === 'rod'">
                  <path :d="d" fill="none" stroke="#1f2937" stroke-width="15" stroke-linecap="round" />
                  <path :d="d" fill="none" :stroke="evOf(i) ? '#dc2626' : '#94a3b8'" stroke-width="9" stroke-linecap="round" />
                  <path :d="d" fill="none" stroke="#fff" stroke-width="2" opacity=".7" transform="translate(0 -2)" />
                </template>
                <template v-else-if="ds[i].kind === 'cable'">
                  <path :d="d" fill="none" stroke="#1f2937" stroke-width="8" stroke-linecap="round" />
                  <path :d="d" fill="none" :stroke="col(i)" stroke-width="5" stroke-linecap="round" />
                  <path :d="d" fill="none" stroke="#fff" stroke-width="5" stroke-dasharray="2 7" opacity=".55" />
                </template>
                <path v-else :d="d" fill="none" stroke="#dc2626" stroke-width="4" stroke-dasharray="9 6" stroke-linecap="round" />
              </template>
              <g v-if="ds[i].kind && !evOf(i)"><circle v-for="p in [xy(s.at), anchors[i]]" :key="p[0]" :cx="p[0]" :cy="p[1]" r="6" fill="#e2e8f0" stroke="#1f2937" stroke-width="3" /></g>
              <!-- แหวนเลื่อนบนราง (จุดจับลาก) -->
              <g :style="{ cursor: s.lock === undefined ? 'grab' : 'not-allowed', touchAction: 'none' }" @pointerdown.prevent="s.lock === undefined && (drag = i)">
                <circle :cx="anchors[i][0]" :cy="anchors[i][1]" r="28" fill="transparent" />
                <rect :x="anchors[i][0] - 15" :y="anchors[i][1] - 11" width="30" height="22" rx="6" :fill="ds[i].kind ? '#2563eb' : '#dc2626'" stroke="#fff" stroke-width="3" />
                <text :x="anchors[i][0]" :y="anchors[i][1] + 5" text-anchor="middle" font-size="13" fill="#fff">{{ s.lock === undefined ? '↕' : '🔒' }}</text>
              </g>
              <text :x="anchors[i][0] + (s.wall <= 0 ? 24 : -24)" :y="anchors[i][1] - 14" :text-anchor="s.wall <= 0 ? 'start' : 'end'" font-size="12" fill="#7f1d1d" font-weight="600">{{ s.label }} · {{ angOf(i) }}°</text>
            </g>

            <!-- ด่าน 1: ตุ้มเหล็ก 100 kg + รอก + ตุ้มถ่วง (ให้แรง F) -->
            <g v-if="li === 0">
              <rect :x="sx(4.9) - 5" :y="sy(2.5) + 16" width="10" :height="sy(0) - sy(2.5) - 16" fill="#a16207" stroke="#1f2937" stroke-width="3" />
              <path :d="`M${jp[0]},${jp[1]} L${sx(4.9)},${sy(2.5)} A16 16 0 0 1 ${sx(4.9) + 16},${sy(2.5) + 16} L${sx(4.9) + 16},${sy(2.5) + 96 + bdx}`" fill="none" stroke="#1f2937" stroke-width="6" />
              <path :d="`M${jp[0]},${jp[1]} L${sx(4.9)},${sy(2.5)} A16 16 0 0 1 ${sx(4.9) + 16},${sy(2.5) + 16} L${sx(4.9) + 16},${sy(2.5) + 96 + bdx}`" fill="none" stroke="#d97706" stroke-width="3" />
              <circle :cx="sx(4.9)" :cy="sy(2.5) + 16" r="16" fill="#e2e8f0" stroke="#1f2937" stroke-width="3" /><circle :cx="sx(4.9)" :cy="sy(2.5) + 16" r="4" fill="#1f2937" />
              <g :transform="`translate(${sx(4.9) + 16} ${sy(2.5) + 96 + bdx})`">
                <path d="M-26,0 h52 l6,50 h-64z" fill="#f97316" stroke="#1f2937" stroke-width="3" stroke-linejoin="round" /><text y="33" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">100 kg</text>
                <text y="70" text-anchor="middle" font-size="12" fill="#9a3412">ตุ้มถ่วง → F</text>
              </g>
            </g>

            <!-- วัตถุที่แขวนที่จุดต่อ O (เคลื่อนตามจุดต่อเมื่อพัง) -->
            <g v-if="!lv.beam" :transform="`translate(${jp[0]} ${jp[1]})`">
              <g :class="{ sw: true }">
                <path d="M0,0 V16" stroke="#1f2937" stroke-width="3" />
                <g v-if="li !== 2" :transform="'translate(0 16)'">
                  <template v-if="li === 0"><path d="M-30,0 h60 l8,58 h-76z" fill="#64748b" stroke="#1f2937" stroke-width="3" stroke-linejoin="round" /><text y="36" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">100 kg</text><text y="82" text-anchor="middle" font-size="12" fill="#334155">W = 981 N</text></template>
                  <template v-else><path d="M0,0 L-40,22 M0,0 L40,22" stroke="#1f2937" stroke-width="2.5" /><rect x="-46" y="22" width="92" height="50" rx="10" fill="#fef3c7" stroke="#1f2937" stroke-width="3" /><text y="44" text-anchor="middle" font-size="13" font-weight="700" fill="#92400e">ร้านลามี</text><text y="62" text-anchor="middle" font-size="12" fill="#92400e">W = 500 N</text></template>
                </g>
                <g v-else transform="translate(0 16)">
                  <path d="M-14,26 L-9,2 M14,26 L9,2" stroke="#fcd9b6" stroke-width="7" stroke-linecap="round" />
                  <path d="M-7,66 L-10,98 M7,66 L10,98" stroke="#1e3a8a" stroke-width="10" stroke-linecap="round" />
                  <rect x="-15" y="22" width="30" height="46" rx="9" fill="#f97316" stroke="#1f2937" stroke-width="3" />
                  <circle cy="12" r="13" fill="#fcd9b6" stroke="#1f2937" stroke-width="3" transform="translate(0 4)" /><path d="M-15,14 a15 15 0 0 1 30 0z" fill="#facc15" stroke="#1f2937" stroke-width="3" /><circle cx="-5" cy="19" r="2" /><circle cx="5" cy="19" r="2" /><path d="M-5,25 q5,5 10,0" fill="none" stroke="#1f2937" stroke-width="2" />
                  <text y="122" text-anchor="middle" font-size="12" fill="#334155">65 kg (W = 637.65 N)</text>
                </g>
              </g>
              <circle r="8" fill="#e2e8f0" stroke="#1f2937" stroke-width="4" /><text x="-18" y="-10" font-size="14" font-weight="700">O</text>
            </g>

            <!-- ด่าน 3: รถกว้านดึงเชือกลงเฉียง 25° (P = 1000 N) -->
            <g v-if="li === 2">
              <path :d="`M${jp[0]},${jp[1]} L${sx(5.13)},${sy(1.27)}`" stroke="#1f2937" stroke-width="6" /><path :d="`M${jp[0]},${jp[1]} L${sx(5.13)},${sy(1.27)}`" stroke="#d97706" stroke-width="3" />
              <rect :x="sx(5.13) - 5" :y="sy(1.27)" width="10" :height="sy(0) - sy(1.27)" fill="#a16207" stroke="#1f2937" stroke-width="3" />
              <g :transform="`translate(${sx(5.13)} ${sy(1.27)})`"><rect x="-6" y="-20" width="58" height="40" rx="8" fill="#ef4444" stroke="#1f2937" stroke-width="3" /><g :transform="`translate(18 0) rotate(${spin})`"><circle r="14" fill="#e2e8f0" stroke="#1f2937" stroke-width="3" /><path d="M-14,0H14M0,-14V14" stroke="#1f2937" stroke-width="3" /></g><text x="20" y="38" text-anchor="middle" font-size="12" fill="#7f1d1d">กว้าน P = 1000 N</text></g>
            </g>

            <!-- ด่าน 4: สะพานโครงถัก + กล่องน้ำหนักสะพาน + รถบรรทุก -->
            <g v-if="truss">
              <path :d="truss.d" stroke="#1f2937" stroke-width="7" fill="none" stroke-linecap="round" /><path :d="truss.d" stroke="#f59e0b" stroke-width="4" fill="none" stroke-linecap="round" />
              <path :d="truss.deck" stroke="#1f2937" stroke-width="12" stroke-linecap="round" /><path :d="truss.deck" stroke="#64748b" stroke-width="8" /><path :d="truss.deck" stroke="#fde047" stroke-width="2" stroke-dasharray="10 8" />
              <g :transform="`translate(${xy([3, 0])[0]} ${xy([3, 0])[1]}) rotate(${(-pose.a * 180) / Math.PI})`"><rect x="-26" y="-48" width="52" height="42" rx="4" fill="#a16207" stroke="#1f2937" stroke-width="3" /><path d="M-26,-34H26M-26,-20H26" stroke="#713f12" stroke-width="2" /><text y="-54" text-anchor="middle" font-size="12" fill="#713f12">สะพาน 3000 N</text></g>
              <g :transform="`translate(${xy([5, 0])[0]} ${xy([5, 0])[1]}) rotate(${(-pose.a * 180) / Math.PI})`">
                <rect x="-34" y="-38" width="46" height="26" rx="4" fill="#ef4444" stroke="#1f2937" stroke-width="3" /><path d="M12,-34 h14 l8,14 v8 h-22z" fill="#fca5a5" stroke="#1f2937" stroke-width="3" stroke-linejoin="round" />
                <circle v-for="x in [-20, 18]" :key="x" :cx="x" cy="-9" r="9" fill="#1f2937" /><circle v-for="x in [-20, 18]" :key="'h' + x" :cx="x" cy="-9" r="3.5" fill="#e2e8f0" />
                <text x="0" y="-44" text-anchor="middle" font-size="12" fill="#7f1d1d">รถ 4000 N</text>
              </g>
              <circle :cx="fx([0, 0])[0]" :cy="fx([0, 0])[1]" r="11" fill="#facc15" stroke="#0f172a" stroke-width="3" /><text :x="fx([0, 0])[0] + 14" :y="fx([0, 0])[1] + 30" font-size="12">O (บานพับ)</text>
            </g>
          </svg>
        </section>

        <!-- ครึ่งขวา: Free Body Diagram ของฝั่งซ้าย -->
        <section class="pn" :class="{ off: tab !== 'fbd' }">
          <h3>📐 FBD <small>{{ lv.beam ? 'คานโครงถัก (แยกชิ้นออกมา) ที่บานพับ O' : 'จุดต่อ O (แยกชิ้นออกมา)' }}</small></h3>
          <svg viewBox="0 0 560 600">
            <defs>
              <marker v-for="c in cols" :key="c" :id="'m' + c.slice(1)" markerUnits="userSpaceOnUse" markerWidth="14" markerHeight="14" refX="11" refY="6" orient="auto"><path d="M0,0L12,6L0,12z" :fill="c" /></marker>
              <pattern id="gr" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke="#e2e8f0" /></pattern>
            </defs>
            <rect width="560" height="600" fill="#fff" /><rect width="560" height="600" fill="url(#gr)" />
            <g v-if="lv.beam">
              <rect x="64" y="200" width="26" height="200" fill="url(#brick)" stroke="#1f2937" stroke-width="2" />
              <path d="M90,300 H510" stroke="#1f2937" stroke-width="8" stroke-linecap="round" />
              <circle cx="90" cy="300" r="9" fill="#facc15" stroke="#0f172a" stroke-width="2" /><text x="76" y="330" font-size="13">O</text>
            </g>
            <g v-else><circle cx="280" cy="300" r="52" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="6 5" stroke-width="2" /><circle cx="280" cy="300" r="8" fill="#0f172a" /><text x="262" y="326" font-size="14" font-weight="700">O</text></g>
            <g v-for="(a, i) in fbd" :key="i">
              <line :x1="a.x1" :y1="a.y1" :x2="a.x2" :y2="a.y2" :stroke="a.c" stroke-width="4" stroke-linecap="round" :stroke-dasharray="a.dash ? '8 6' : ''" :marker-end="`url(#m${a.c.slice(1)})`" />
              <text :x="a.lx" :y="a.ly" :text-anchor="a.ta" font-size="13" font-weight="600" :fill="a.c">{{ a.label }}</text>
            </g>
            <text x="20" y="560" font-size="14" font-family="ui-monospace, monospace" fill="#0f172a">
              <template v-if="lv.beam">ΣM_O = {{ live.M.toFixed(0) }} N·m (ต้อง = 0)</template>
              <template v-else>ΣFx = {{ live.R[0].toFixed(0) }} N · ΣFy = {{ live.R[1].toFixed(0) }} N (ต้อง = 0)</template>
            </text>
          </svg>
        </section>
      </div>

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
body { -webkit-text-size-adjust: 100%; margin: 0; font-family: system-ui, 'Noto Sans Thai', sans-serif; background: #e2e8f0; color: #0f172a; }
header { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 10px 16px; background: #0f172a; color: #fff; }
h1 { font-size: 18px; margin: 0; }
nav { display: flex; flex-wrap: wrap; gap: 6px; }
button { font: inherit; padding: 6px 12px; border: 1px solid #94a3b8; border-radius: 8px; background: #fff; cursor: pointer; }
button.on { background: #2563eb; border-color: #2563eb; color: #fff; }
button.go { background: #16a34a; border-color: #16a34a; color: #fff; font-weight: 700; }
button.ghost { background: transparent; }
main { display: flex; gap: 12px; padding: 12px; align-items: flex-start; }
.stage { flex: 1; min-width: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.pn { background: #fff; border-radius: 12px; border: 1px solid #cbd5e1; overflow: hidden; min-width: 0; }
.pn h3 { margin: 0; padding: 6px 12px; font-size: 14px; background: #f1f5f9; }
.pn h3 small { display: block; font-weight: 400; font-size: 11.5px; color: #475569; line-height: 1.35; }
.pn svg { display: block; width: 100%; height: auto; max-height: calc(100vh - 150px); user-select: none; }
.sw { animation: sw 2.4s ease-in-out infinite alternate; transform-origin: 0 0; }
@keyframes sw { from { transform: rotate(-2.5deg); } to { transform: rotate(2.5deg); } }
.wv { animation: wv 2.2s linear infinite; }
@keyframes wv { to { transform: translateX(40px); } }
.cloud { animation: cl 14s ease-in-out infinite alternate; }
@keyframes cl { to { transform: translateX(300px); } }
aside { width: 320px; background: #fff; border-radius: 12px; padding: 14px; font-size: 14px; line-height: 1.5; }
aside h2 { margin: 0 0 6px; font-size: 17px; }
.note { font-size: 12px; color: #64748b; }
.hint { background: #fef9c3; padding: 8px; border-radius: 8px; }
.card { border: 1px solid #cbd5e1; border-left: 5px solid #2563eb; border-radius: 8px; padding: 8px 10px; margin: 8px 0; display: grid; gap: 6px; }
.card.empty { border-left-color: #dc2626; background: #fef2f2; }
.row { display: flex; gap: 6px; }
label { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
input, select { width: 120px; padding: 4px 6px; font: inherit; }
.act { display: flex; gap: 8px; margin: 10px 0; }
.out { padding: 8px 12px; border-radius: 8px; }
.out p { margin: 4px 0; }
.out.ok { background: #dcfce7; color: #14532d; }
.out.bad { background: #fee2e2; color: #7f1d1d; }
.tabs { display: none; }
input, select { min-height: 36px; }

/* iPad / จอกลาง: panel คู่อยู่บน แผงควบคุมอยู่ล่างเป็น 2 คอลัมน์ */
@media (max-width: 1150px) {
  main { flex-direction: column; align-items: stretch; padding: 10px; }
  aside { width: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; align-content: start; }
  aside > h2, aside > p, aside > .ghost, aside > .act, aside > .out { grid-column: 1 / -1; }
  aside > .ghost { justify-self: start; }
  .card { margin: 6px 0; }
  .pn svg { max-height: none; }
  .act { position: sticky; bottom: 0; z-index: 5; background: #fff; padding: 8px 0 calc(8px + env(safe-area-inset-bottom)); border-top: 1px solid #e2e8f0; }
  .act button { flex: 1; min-height: 44px; font-size: 16px; }
  button { min-height: 40px; }
}

/* มือถือ: ดูทีละ panel ผ่านแท็บ, แผงควบคุมเป็นคอลัมน์เดียว */
@media (max-width: 700px) {
  header { padding: 8px 10px; gap: 6px; }
  h1 { font-size: 16px; }
  nav { flex-wrap: nowrap; overflow-x: auto; width: 100%; padding-bottom: 4px; -webkit-overflow-scrolling: touch; }
  nav button { white-space: nowrap; flex: none; }
  .tabs { display: flex; gap: 6px; align-items: center; padding: 8px 10px 0; position: sticky; top: 0; z-index: 6; background: #e2e8f0; }
  .tabs button { flex: 1; min-height: 44px; font-weight: 600; }
  .eq { flex: none; font: 600 12px ui-monospace, monospace; padding: 6px 8px; border-radius: 8px; background: #fff; }
  .eq.ok { background: #dcfce7; color: #14532d; }
  .eq.bad { background: #fee2e2; color: #7f1d1d; }
  .stage { grid-template-columns: 1fr; }
  .pn.off { display: none; }
  .pn h3 small { font-size: 11px; }
  main { padding: 8px; }
  aside { display: block; padding: 12px; }
  .card { padding: 10px; }
  input, select { width: 140px; font-size: 16px; min-height: 44px; } /* 16px กัน iOS ซูมเอง */
  .row button { flex: 1; min-height: 44px; }
}
@media (hover: none) { button:active { filter: brightness(.92); } }
</style>
