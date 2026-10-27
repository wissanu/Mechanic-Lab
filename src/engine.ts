// พิกัดโลก: หน่วยเมตร, แกน y ชี้ขึ้น, แรงเป็นนิวตัน, โมเมนต์เป็น N·m (ทวนเข็มนาฬิกา = บวก)
export type V = [number, number]
export type Kind = 'cable' | 'rod'
export interface Slot { label: string; at: V; wall: number; yr: V; lock?: number }
export interface Load { p: V; f: V; label: string }
export interface Level {
  title: string; story: string; hint: string; beam: boolean
  S: number; ox: number; oy: number; floor: number; yb: number; yt: number; fs: number
  walls: number[]; joint: V; L: number; loads: Load[]; slots: Slot[]
  cableMax: number; rodTen: number; kb: number; hinge: number
}
export interface Design { kind: Kind | null; qy: number; T: number; comp: boolean }
export interface Ev { i: number; m: 'snap' | 'slack' | 'buckle' | 'pullout' }
export interface Res { F: V[]; R: V; M: number; hr: number; ev: Ev[]; empty: boolean; un: boolean; ok: boolean }

export const g = 9.81
const D = Math.PI / 180
export const clampY = (s: Slot, y: number) => Math.min(s.yr[1], Math.max(s.yr[0], y))
export const ang = (s: Slot, qy: number) => Math.atan2(qy - s.at[1], Math.abs(s.wall - s.at[0])) / D
export const qyOf = (s: Slot, deg: number) => clampY(s, s.at[1] + Math.abs(s.wall - s.at[0]) * Math.tan(deg * D))
export const lenOf = (s: Slot, qy: number) => Math.hypot(s.wall - s.at[0], qy - s.at[1])
export const dirOf = (s: Slot, qy: number): V => {
  const l = lenOf(s, qy)
  return [(s.wall - s.at[0]) / l, (qy - s.at[1]) / l]
}

export function evaluate(lv: Level, ds: Design[]): Res {
  const ev: Ev[] = []
  let empty = false
  const F: V[] = ds.map((d, i) => {
    const s = lv.slots[i]
    const z: V = [0, 0]
    if (!d.kind || !(d.T > 0)) { empty = true; return z }
    const u = dirOf(s, d.qy)
    const T = d.comp ? -d.T : d.T // + = ดึงเข้าหาจุดยึด, - = ดันออก
    if (d.kind === 'cable' && T < 0) { ev.push({ i, m: 'slack' }); return z }
    if (T > 0 && T > (d.kind === 'cable' ? lv.cableMax : lv.rodTen)) { ev.push({ i, m: 'snap' }); return z }
    if (T < 0 && -T > lv.kb / lenOf(s, d.qy) ** 2) { ev.push({ i, m: 'buckle' }); return z }
    return [u[0] * T, u[1] * T]
  })
  let sx = 0, sy = 0, M = 0, ml = 0, fl = 0
  for (const l of lv.loads) {
    sx += l.f[0]; sy += l.f[1]
    M += l.p[0] * l.f[1] - l.p[1] * l.f[0]
    ml += Math.abs(l.p[0] * l.f[1]); fl += Math.hypot(l.f[0], l.f[1])
  }
  F.forEach((f, i) => {
    const a = lv.slots[i].at
    sx += f[0]; sy += f[1]
    M += a[0] * f[1] - a[1] * f[0]
  })
  const hr = Math.hypot(sx, sy)
  if (lv.beam && hr > lv.hinge) ev.push({ i: -1, m: 'pullout' })
  const un = lv.beam ? Math.abs(M) > 0.03 * ml + 20 : hr > 0.02 * fl + 5
  return { F, R: [sx, sy], M, hr, ev, empty, un, ok: !ev.length && !un && !empty }
}

const J: V = [2.5, 2.5]
export const levels: Level[] = [
  {
    title: 'ด่าน 1: สลิงเส้นเดียว',
    story: 'น้ำหนัก 100 kg (W = 981 N) แขวนที่จุดต่อ O และมีแรงดึงแนวนอน F = 981 N ไปทางขวา สลิงสีแดงที่ขาดหายไปต้องดึงจุด O ไปทางกำแพงซ้ายให้สมดุล ลากจุดหมุนบนกำแพง (หรือพิมพ์มุม) แล้วใส่แรงดึงให้ถูกต้อง',
    hint: 'ΣFx = 0: T cosθ = F และ ΣFy = 0: T sinθ = W  →  θ = tan⁻¹(W/F), T = √(F² + W²)',
    beam: false, S: 95, ox: 80, oy: 565, floor: 0, yb: 0, yt: 5.7, fs: 0.07, walls: [0], joint: J, L: 0,
    loads: [{ p: J, f: [981, 0], label: 'F = 981 N' }, { p: J, f: [0, -981], label: 'W = 981 N' }],
    slots: [{ label: 'สลิง A', at: J, wall: 0, yr: [0.4, 5.2] }],
    cableMax: 3000, rodTen: 5000, kb: 12000, hinge: 0,
  },
  {
    title: 'ด่าน 2: ทฤษฎีลามี',
    story: 'น้ำหนัก 500 N แขวนที่จุด O ยึดด้วยสลิงสองเส้นที่ขาดหายไป (สีแดง) มุมถูกกำหนดแล้ว: ซ้าย 40° ขวา 30° จากแนวนอน ใช้ทฤษฎีลามีหาแรงดึงของแต่ละเส้น แล้วใส่ค่าให้ถูก',
    hint: 'แตกแรง ΣFx = 0: T₁cos40° = T₂cos30° และ ΣFy = 0: T₁sin40° + T₂sin30° = 500 (หรือใช้ลามี)',
    beam: false, S: 95, ox: 80, oy: 565, floor: 0, yb: 0, yt: 5.7, fs: 0.07, walls: [0, 5], joint: J, L: 0,
    loads: [{ p: J, f: [0, -500], label: 'W = 500 N' }],
    slots: [
      { label: 'เส้น A (ซ้าย)', at: J, wall: 0, yr: [0.4, 5.4], lock: 40 },
      { label: 'เส้น B (ขวา)', at: J, wall: 5, yr: [0.4, 5.4], lock: 30 },
    ],
    cableMax: 1500, rodTen: 3000, kb: 12000, hinge: 0,
  },
  {
    title: 'ด่าน 3: จุดต่อซ้อนทับ',
    story: 'Case Study 01: มวล 65 kg (W = 637.65 N) และแรง 1,000 N ทำมุม 25° ใต้แนวนอน ชิ้นส่วนสีแดงมี 2 ชิ้น: A เลื่อนจุดหมุนบนกำแพงได้ B เป็นเหล็กแนวนอน (0°) ระวัง: สลิงรับแรง "ดัน" ไม่ได้ และทุกชิ้นส่วนทนแรงได้จำกัด',
    hint: 'ΣFy: T_A sinθ = W + P sin25°   |   ΣFx: T_A cosθ = P cos25° + C (C = แรงดันของเหล็ก B)   ลองหลายมุม ดูว่าสลิงขาดเมื่อไร',
    beam: false, S: 95, ox: 80, oy: 565, floor: 0, yb: 0, yt: 5.7, fs: 0.07, walls: [0], joint: J, L: 0,
    loads: [{ p: J, f: [0, -637.65], label: 'W = 637.65 N' }, { p: J, f: [906.31, -422.62], label: 'P = 1000 N (25°)' }],
    slots: [
      { label: 'ชิ้นส่วน A', at: J, wall: 0, yr: [2.7, 5.4] },
      { label: 'ชิ้นส่วน B', at: J, wall: 0, yr: [0.5, 5.4], lock: 0 },
    ],
    cableMax: 2800, rodTen: 3000, kb: 12000, hinge: 0,
  },
  {
    title: 'ด่าน 4: สะพานโครงถัก',
    story: 'คานโครงถักสามเหลี่ยมยึดบานพับที่จุด O บนกำแพง ลอยเหนือแม่น้ำ รับน้ำหนักสะพาน 3,000 N ที่ 3 m และรถ 4,000 N ที่ 5 m ใส่สลิงค้ำยัน (ดึง) ด้านบนและเหล็กค้ำยัน (ดัน) ด้านล่าง ให้ ΣM รอบจุด O = 0 (มุมติดลบ = ต่ำกว่าแนวนอน)',
    hint: 'ΣM_O = 0 → โมเมนต์ที่ชิ้นส่วนสร้างต้องเท่ากับ 3×3000 + 5×4000 = 29,000 N·m  (โมเมนต์ = x·Fy − y·Fx) สลิงตัวเดียวทนไม่ไหว ต้องให้เหล็กช่วยดัน',
    beam: true, S: 60, ox: 140, oy: 366, floor: -3.7, yb: -3.7, yt: 5.6, fs: 0.013, walls: [0], joint: [0, 0], L: 6,
    loads: [{ p: [3, 0], f: [0, -3000], label: 'สะพาน 3000 N' }, { p: [5, 0], f: [0, -4000], label: 'รถ 4000 N' }],
    slots: [
      { label: 'สลิงค้ำยัน', at: [4.5, 0.3], wall: 0, yr: [1.5, 5.2] },
      { label: 'เหล็กค้ำยัน', at: [1.5, 0], wall: 0, yr: [-3.4, -0.6] },
    ],
    cableMax: 6500, rodTen: 9000, kb: 100000, hinge: 6000,
  },
]
