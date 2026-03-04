"use client"

import React, { useEffect, useMemo, useState } from "react"
import MapPlaceholder from "./MapPlaceholder"
import { ComposableMap, Marker } from "react-simple-maps"

type Row = Record<string, any>

const severityOrder = ["Minor", "Near Miss", "Potentially Significant", "Major", "Serious"]

const severityColors: Record<string, string> = {
  Minor: "var(--severity-minor)",
  "Near Miss": "var(--severity-nearmiss)",
  "Potentially Significant": "var(--severity-potential)",
  Major: "var(--severity-major)",
  Serious: "var(--severity-serious)",
  Unknown: "var(--severity-unknown)",
}

const riskColors: Record<string, string> = {
  Low: "var(--risk-low)",
  Medium: "var(--risk-medium)",
  High: "var(--risk-high)",
  Unknown: "var(--risk-unknown)",
}


const AREA_COLS = ["Remote", "Labs", "IT", "Digital", "PTW", "E&I", "Maint", "Process", "Office", "Logistics"] as const

// Country color palette (matches the R flag_palette)
const countryColors: Record<string, string> = {
  Canada: "#EA4335",
  USA: "#4285F4",
  Chile: "#FBBC05",
  Belgium: "#34A853",
  Egypt: "#A142F4",
  "New Zealand": "#00ACC1",
  "Trinidad & Tobago": "#FF8F00",
  Other: "#9CA3AF",
}

// Hardcoded country centroids (Lon, Lat). Used to override corrupted CSV coordinates.
const COUNTRY_COORDS: Record<string, [number, number]> = {
  "Trinidad & Tobago": [-61.2225, 10.6918],
  "Germany": [10.4515, 51.1657],
  "Canada": [-106.3468, 56.1304],
  "USA": [-95.7129, 37.0902],
  "Chile": [-71.5429, -35.6751],
  "Belgium": [4.4699, 50.5039],
  "Egypt": [30.8024, 26.8205],
  "New Zealand": [174.8859, -40.9006],
}

function normalizeCountry(c: any) {
  const s = String(c ?? "").trim()
  if (!s) return "Other"
  if (s === "United States" || s === "United States of America" || s === "US") return "USA"
  if (s === "Trinidad and Tobago") return "Trinidad & Tobago"
  return s
}

function toNum(v: any) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Overlay projection config (used by the transparent marker layer)
// Finalized constants for overlay alignment.
const OVERLAY_WIDTH = 1200
const OVERLAY_HEIGHT = 360
const OVERLAY_PROJECTION = "geoMercator" as const
const OVERLAY_SCALE = 159
const OVERLAY_CENTER: [number, number] = [2.5, 19.0]
const OVERLAY_TRANSLATE: [number, number] = [OVERLAY_WIDTH / 2, OVERLAY_HEIGHT / 2]

// Color helpers for "outline + lighter fill" markers
function hexToRgb(hex: string) {
  const h = hex.replace("#", "").trim()
  if (h.length !== 6) return null
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  if ([r, g, b].some((v) => Number.isNaN(v))) return null
  return { r, g, b }
}

function rgbToHex(r: number, g: number, b: number) {
  const to2 = (n: number) => n.toString(16).padStart(2, "0")
  return `#${to2(r)}${to2(g)}${to2(b)}`
}

// mix with white (t=0 -> original, t=1 -> white)
function lightenHex(hex: string, t: number) {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const tt = Math.min(1, Math.max(0, t))
  const r = Math.round(rgb.r + (255 - rgb.r) * tt)
  const g = Math.round(rgb.g + (255 - rgb.g) * tt)
  const b = Math.round(rgb.b + (255 - rgb.b) * tt)
  return rgbToHex(r, g, b)
}

// NOTE: Graph components removed — this view provides a lightweight
// summary and lists instead of interactive charts.

function toYear(d: any) {
  const dt = new Date(d)
  const y = dt.getFullYear()
  return Number.isFinite(y) ? y : null
}

function isTruthyCell(v: any) {
  if (v === true) return true
  if (v === 1) return true
  const s = String(v ?? "").trim().toLowerCase()
  return s === "1" || s === "true" || s === "yes" || s === "y" || s === "t"
}

/**
 * Robust CSV parser (same logic as LeftDashboard)
 */
function parseCsvRobust(csvText: string): Row[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []

  function splitCsv(line: string) {
    const out: string[] = []
    let cur = ""
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
        continue
      }
      if (ch === ',' && !inQuotes) {
        out.push(cur)
        cur = ''
        continue
      }
      cur += ch
    }
    out.push(cur)
    return out.map((s) => s.trim().replace(/^"|"$/g, '').replace(/""/g, '"'))
  }

  let headers = splitCsv(lines[0]).map((h) => String(h ?? '').trim())
  const n = headers.length

  const idxNActions = headers.indexOf('n_actions')
  const tailLen = idxNActions >= 0 ? n - idxNActions : 20

  const fixedLeftLen = 8
  const fixedMidLen = 6

  const rows: Row[] = []

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]
    const parts = splitCsv(raw)
    if (parts.length === n) {
      const obj: Row = {}
      headers.forEach((h, j) => (obj[h] = String(parts[j] ?? '').trim()))
      rows.push(obj)
      continue
    }
    if (parts.length < fixedLeftLen + fixedMidLen + 1 + tailLen) continue
    const tail = parts.slice(-tailLen).map((p) => String(p ?? '').trim())
    const head = parts.slice(0, fixedLeftLen).map((p) => String(p ?? '').trim())
    const middle = parts.slice(fixedLeftLen, parts.length - tailLen).map((p) => String(p ?? '').trim())
    const midFirst = middle.slice(0, fixedMidLen)
    const actions = middle.slice(fixedMidLen).join(',')
    const reconstructed: string[] = [...head, ...midFirst, actions, ...tail]
    if (reconstructed.length !== n) {
      const obj: Row = {}
      const fill = new Array(n).fill('')
      const start = Math.max(0, n - parts.length)
      for (let k = 0; k < parts.length && start + k < n; k++) fill[start + k] = parts[k]
      headers.forEach((h, j) => (obj[h] = fill[j]))
      rows.push(obj)
      continue
    }
    const obj: Row = {}
    headers.forEach((h, j) => (obj[h] = String(reconstructed[j] ?? '').trim()))
    rows.push(obj)
  }

  return rows
}

export default function ExtendedAnalytics() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [diagnostic, setDiagnostic] = useState(
    { total: 0, parsed: 0, filtered: 0, issues: [] as string[] }
  )

  const [country, setCountry] = useState<string>("All")
  const [year, setYear] = useState<string>("All")
  const [selectedAreas, setSelectedAreas] = useState<Set<string>>(new Set())
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [selectedPrimary, setSelectedPrimary] = useState<string | null>(null)
  const [selectedRisk, setSelectedRisk] = useState<string | null>(null)
  const [selectedSeverity, setSelectedSeverity] = useState<string | null>(null)


  useEffect(() => {
    setLoading(true)
    fetch("/data/dashboard_database.csv")
      .then((r) => r.text())
      .then((text) => {
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
        const allParsed = parseCsvRobust(text)

        // TEMP DEBUG: hunt rows that may have corrupted / swapped coordinates
        const debugRows = allParsed.filter((row) => {
          const c = String((row as any).country ?? "").toLowerCase()
          return c.includes("germany") || c.includes("berlin") || c.includes("trinidad")
        })
        if (debugRows.length > 0) {
          console.log("[DEBUG] Suspicious geo rows:", debugRows.length)
          debugRows.forEach((row) => {
            console.log({
              country: (row as any).country,
              lat_raw: (row as any).lat ?? (row as any).latitude,
              lon_raw: (row as any).lon ?? (row as any).lng ?? (row as any).longitude,
              row,
            })
          })
        }

        const issues: string[] = []

        const filtered = allParsed
          .filter((r) => {
            if (!(r as any).date) {
              issues.push(`Missing date: ${(r as any).title?.substring(0, 30) || "unknown"}`)
              return false
            }
            if (!(r as any).country) {
              issues.push(`Missing country: ${(r as any).title?.substring(0, 30) || "unknown"}`)
              return false
            }
            return true
          })
          .map((r) => ({
            ...r,
            year: toYear((r as any).date),
          }))
          .filter((r) => {
            if ((r as any).year === null) {
              issues.push(`Invalid year from date "${(r as any).date}": ${(r as any).title?.substring(0, 30) || "unknown"}`)
              return false
            }
            return true
          })

        setDiagnostic({
          total: lines.length - 1,
          parsed: allParsed.length,
          filtered: filtered.length,
          issues: issues.slice(0, 10),
        })
        setRows(filtered)
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (isSettingsOpen && !target.closest(".settings-dropdown")) {
        setIsSettingsOpen(false)
      }
    }
    if (isSettingsOpen) {
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [isSettingsOpen])

  const countries = useMemo(() => {
    const set = new Set<string>()
    rows.forEach((r) => set.add(String(r.country)))
    return ["All", ...Array.from(set).sort((a, b) => a.localeCompare(b))]
  }, [rows])

  const years = useMemo(() => {
    const set = new Set<number>()
    rows.forEach((r) => {
      const y = Number(r.year)
      if (Number.isFinite(y)) set.add(y)
    })
    return ["All", ...Array.from(set).sort((a, b) => a - b).map(String)]
  }, [rows])

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (country !== "All" && String(r.country) !== country) return false
      if (year !== "All" && String(r.year) !== year) return false
      if (selectedPrimary) {
        const v = String(r.primary_classification_std || r.primary_classification || "Unknown")
        if (v !== selectedPrimary) return false
      }
      if (selectedRisk) {
        const v = String(r.risk_level || "Unknown")
        if (v !== selectedRisk) return false
      }
      if (selectedSeverity) {
        const v = String(r.severity || r.severity_level || "Unknown")
        if (v !== selectedSeverity) return false
      }
      if (selectedAreas.size > 0) {
        const hasMatchingArea = Array.from(selectedAreas).some((area) => isTruthyCell(r[area]))
        if (!hasMatchingArea) return false
      }
      return true
    })
  }, [rows, country, year, selectedAreas, selectedPrimary, selectedRisk, selectedSeverity])

  const lineData = useMemo(() => {
    const byYear = new Map<number, number>()
    filtered.forEach((r) => {
      const y = Number(r.year)
      byYear.set(y, (byYear.get(y) || 0) + 1)
    })
    return Array.from(byYear.entries()).sort((a, b) => a[0] - b[0]).map(([y, n]) => ({ year: y, reports: n }))
  }, [filtered])

  useEffect(() => {
    const handler = (e: any) => {
      const y = String(e?.detail)
      setYear((prev) => (prev === y ? 'All' : y))
    }
    window.addEventListener('dashboard:selectYear', handler as any)
    return () => window.removeEventListener('dashboard:selectYear', handler as any)
  }, [])

  const riskData = useMemo(() => {
    const counts = new Map<string, number>()
    filtered.forEach((r) => {
      const k = String(r.risk_level || "Unknown")
      counts.set(k, (counts.get(k) || 0) + 1)
    })
    return Array.from(counts.entries()).map(([name, value]) => ({ name, value }))
  }, [filtered])

  const severityData = useMemo(() => {
    const counts = new Map<string, number>()
    filtered.forEach((r) => {
      const k = String(r.severity || r.severity_level || "Unknown")
      counts.set(k, (counts.get(k) || 0) + 1)
    })

    const ordered = [
      ...severityOrder.filter((k) => counts.has(k)).map((k) => ({ name: k, value: counts.get(k) || 0 })),
      ...Array.from(counts.entries())
        .filter(([k]) => !severityOrder.includes(k))
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) => ({ name, value })),
    ]

    return ordered
  }, [filtered])

  const primaryData = useMemo(() => {
    const counts = new Map<string, number>()
    filtered.forEach((r) => {
      const k = String(r.primary_classification_std || r.primary_classification || "Unknown")
      counts.set(k, (counts.get(k) || 0) + 1)
    })
    const arr = Array.from(counts.entries()).map(([name, value]) => ({ name, value }))
    arr.sort((a, b) => b.value - a.value)
    return arr.map((d, i) => ({
      ...d,
      color: i === 0 ? "var(--primary-top1)" : i === 1 ? "var(--primary-top2)" : "var(--primary-other)",
      label: i <= 1 ? String(d.value) : "",
    }))
  }, [filtered])

  const summary = useMemo(() => {
    const total = filtered.length
    const riskTop = [...riskData].sort((a, b) => b.value - a.value)[0]
    const sevTop = [...severityData].sort((a, b) => b.value - a.value)[0]
    return {
      total,
      riskTop: riskTop ? `${riskTop.name} (${Math.round((riskTop.value / Math.max(1, total)) * 100)}%)` : "—",
      sevTop: sevTop ? `${sevTop.name} (${Math.round((sevTop.value / Math.max(1, total)) * 100)}%)` : "—",
    }
  }, [filtered, riskData, severityData])

  // Markers for map overlay (keeps MapPlaceholder aesthetics intact)
  const markers = useMemo(() => {
    return filtered
      .map((r) => {
        const countryNorm = normalizeCountry((r as any).country)

        // Prefer hardcoded country centroids when available (CSV coords are sometimes corrupted)
        const override = COUNTRY_COORDS[countryNorm]
        let lonFixed: number | null = null
        let latFixed: number | null = null

        // Canada split: place Vancouver incidents separately from other Canada incidents
        if (countryNorm === "Canada") {
          const loc = String((r as any).site ?? (r as any).location ?? (r as any).city ?? "")
            .trim()
            .toLowerCase()
          if (loc.includes("vancouver")) {
            lonFixed = -123.1207
            latFixed = 49.2827
          } else {
            // Medicine Hat / Alberta area (adjust if needed)
            lonFixed = -110.6773
            latFixed = 50.0416
          }
        }

        if (lonFixed === null || latFixed === null) {
          if (override) {
            lonFixed = override[0]
            latFixed = override[1]
          } else {
            // Fallback to CSV parsing when no override exists
            const lat = toNum((r as any).lat ?? (r as any).latitude)
            const lon = toNum((r as any).lon ?? (r as any).lng ?? (r as any).longitude)
            console.log((r as any).country, lat, lon)

            // If values look swapped (lat outside [-90,90] but lon within), swap them
            latFixed = lat
            lonFixed = lon
            if (latFixed !== null && lonFixed !== null) {
              const latOut = Math.abs(latFixed) > 90 && Math.abs(lonFixed) <= 90
              if (latOut) {
                const tmp = latFixed
                latFixed = lonFixed
                lonFixed = tmp
              }
            }
          }
        }

        if (latFixed === null || lonFixed === null) return null

        const key = countryNorm
        const stroke = countryColors[key] ?? countryColors.Other
        const fill = lightenHex(stroke, 0.70)

        return { lon: lonFixed, lat: latFixed, stroke, fill, country: String((r as any).country ?? "") }
      })
      .filter(Boolean) as Array<{ lon: number; lat: number; stroke: string; fill: string; country: string }>
  }, [filtered])

  if (loading) return <div className="p-6" style={{ color: "var(--text)" }}>Loading…</div>
  if (error) return <div className="p-6" style={{ color: "var(--destructive)" }}>Error: {error}</div>

  return (
    <div className="w-full h-full p-6 overflow-auto font-sans" style={{ background: "var(--surface)", color: "var(--text)" }}>
      <div className="flex items-end justify-between gap-4 mb-4">
        <div>
          <div className="text-4xl font-extrabold tracking-wide" style={{ color: "var(--text)" }}>INCIDENTS REPORT</div>
          <div className="h-[3px] w-28 mt-1" style={{ background: "var(--accent)" }} />
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="rounded-lg px-3 py-2" style={{ background: "var(--card)", border: "1px solid", borderColor: "var(--border)" }}>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>country</div>
            <select
              className="text-sm outline-none"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              style={{ background: "transparent", color: "var(--text)" }}
            >
              {countries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-lg px-3 py-2" style={{ background: "var(--card)", border: "1px solid", borderColor: "var(--border)" }}>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>year</div>
            <select className="text-sm outline-none" value={year} onChange={(e) => setYear(e.target.value)} style={{ background: "transparent", color: "var(--text)" }}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>


      <div
        className="relative w-full rounded-xl mb-6 overflow-hidden"
        style={{
          background: "#fff",
          border: "1px solid",
          borderColor: "var(--border)",
        }}
      >
        <MapPlaceholder height={360} />

        {/* Overlay dots using a transparent projected map layer (keeps MapPlaceholder visuals) */}
        <div className="absolute inset-0 pointer-events-none">
          <ComposableMap
            projection={OVERLAY_PROJECTION}
            width={OVERLAY_WIDTH}
            height={OVERLAY_HEIGHT}
            projectionConfig={{ scale: OVERLAY_SCALE, center: OVERLAY_CENTER }}
            style={{ width: "100%", height: "100%", background: "transparent", display: "block" }}
          >
            {markers.map((m, i) => (
              <Marker key={i} coordinates={[m.lon, m.lat]}>
                <circle
                  r={5}
                  fill={m.fill}
                  stroke={m.stroke}
                  strokeWidth={2}
                />
                {/* subtle white halo to match card style */}
                <circle r={7} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth={2} />
              </Marker>
            ))}
          </ComposableMap>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-4 rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid", borderColor: "var(--border)" }}>
          <div className="text-sm font-semibold mb-2" style={{ color: "var(--text)" }}>Summary</div>
          <div className="space-y-3 text-sm">
            <div className="rounded-lg p-3" style={{ background: "var(--popover)", border: "1px solid", borderColor: "var(--border)" }}>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>Total records (filtered)</div>
              <div className="text-xl font-bold" style={{ color: "var(--text)" }}>{summary.total}</div>
            </div>

            <div className="rounded-lg p-3" style={{ background: "var(--popover)", border: "1px solid", borderColor: "var(--border)" }}>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>Top risk level</div>
              <div className="font-semibold" style={{ color: "var(--text)" }}>{summary.riskTop}</div>
            </div>

            <div className="rounded-lg p-3" style={{ background: "var(--popover)", border: "1px solid", borderColor: "var(--border)" }}>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>Top severity</div>
              <div className="font-semibold" style={{ color: "var(--text)" }}>{summary.sevTop}</div>
            </div>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-4 rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid", borderColor: "var(--border)" }}>
          <div className="text-sm font-semibold mb-2" style={{ color: "var(--text)" }}>Risk distribution</div>
          <div className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>Top categories</div>
          <ul className="space-y-2">
            {riskData.slice().sort((a,b)=>b.value-a.value).map((d)=> (
              <li key={d.name} style={{ color: 'var(--text)' }} className="flex justify-between">
                <span style={{ color: 'var(--text-muted)' }}>{d.name}</span>
                <span className="font-medium">{d.value}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="col-span-12 lg:col-span-4 rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid", borderColor: "var(--border)" }}>
          <div className="text-sm font-semibold mb-2" style={{ color: "var(--text)" }}>Severity counts</div>
          <div className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>Ordered least → most severe</div>
          <ul className="space-y-2">
            {severityData.map((d)=> (
              <li key={d.name} style={{ color: 'var(--text)' }} className="flex justify-between">
                <span style={{ color: 'var(--text-muted)' }}>{d.name}</span>
                <span className="font-medium">{d.value}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
        Loaded rows: {rows.length} • Filtered rows: {filtered.length}
        <br />
        <strong>Diagnostic:</strong> CSV lines: {diagnostic.total} | Parsed: {diagnostic.parsed} | Valid: {diagnostic.filtered}
        {diagnostic.issues.length > 0 && (
          <div className="mt-2 text-xs p-2 rounded" style={{ background: "var(--popover)", border: "1px solid", borderColor: "var(--border)" }}>
            <strong>Issues found:</strong>
            <ul style={{ margin: "4px 0", paddingLeft: "16px" }}>
              {diagnostic.issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
