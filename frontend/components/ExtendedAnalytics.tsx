"use client"

import React, { useEffect, useMemo, useState } from "react"
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  LabelList,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts"
import CountryLines from './CountryLines'

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

// Custom tooltip components using CSS variables for dynamic color
const CustomLineTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px" }}>
        <p style={{ color: "var(--text)", margin: "0", fontSize: "14px" }}>{`Year: ${label}`}</p>
        <p style={{ color: "var(--text)", margin: "4px 0 0 0", fontSize: "14px" }}>{`Reports: ${payload[0].value}`}</p>
      </div>
    )
  }
  return null
}

const CustomPieTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px" }}>
        <p style={{ color: "var(--text)", margin: "0", fontSize: "14px" }}>{payload[0].name}</p>
        <p style={{ color: "var(--text)", margin: "4px 0 0 0", fontSize: "14px" }}>{`Value: ${payload[0].value}`}</p>
      </div>
    )
  }
  return null
}

const CustomBarTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px" }}>
        <p style={{ color: "var(--text)", margin: "0", fontSize: "14px" }}>{payload[0].payload.name}</p>
        <p style={{ color: "var(--text)", margin: "4px 0 0 0", fontSize: "14px" }}>{`Value: ${payload[0].value}`}</p>
      </div>
    )
  }
  return null
}

// Clickable dot component for LineChart (declared at top-level to avoid render-time creation)
const CustomLineDot = (props: any) => {
  const { cx, cy, payload } = props
  if (typeof cx !== 'number' || typeof cy !== 'number') return null
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill="var(--text)"
      stroke="none"
      style={{ cursor: 'pointer' }}
      onClick={() => {
        const y = String(payload?.year)
        window.dispatchEvent(new CustomEvent('dashboard:selectYear', { detail: y }))
      }}
    />
  )
}

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
  const [diagnostic, setDiagnostic] = useState<{ total: number; parsed: number; filtered: number; issues: string[] }>({
    total: 0,
    parsed: 0,
    filtered: 0,
    issues: [],
  })

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

  if (loading) return <div className="p-6" style={{ color: "var(--text)" }}>Loading…</div>
  if (error) return <div className="p-6" style={{ color: "var(--destructive)" }}>Error: {error}</div>

  return (
    <div className="w-full h-full p-6 overflow-auto" style={{ fontFamily: "var(--font-geist-sans)", background: "var(--surface)", color: "var(--text)" }}>
      {/* Title row (like the sketch) */}
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <div className="text-4xl font-extrabold tracking-wide" style={{ color: "var(--text)" }}>INCIDENTS REPORT</div>
          <div className="h-[3px] w-28 mt-1" style={{ background: "var(--accent)" }} />
        </div>

        {/* Filters */}
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

          <div className="relative settings-dropdown">
            <button
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className="rounded-lg px-3 py-2 w-full text-left"
              style={{ background: "var(--card)", border: "1px solid", borderColor: "var(--border)" }}
            >
              <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>settings</div>
              <div className="text-sm" style={{ color: "var(--text)" }}>
                {selectedAreas.size === 0 ? "All" : `${selectedAreas.size} selected`}
              </div>
            </button>

            {isSettingsOpen && (
              <div
                className="absolute top-full left-0 mt-2 rounded-lg p-3 z-50 min-w-[200px]"
                style={{ background: "var(--card)", border: "1px solid", borderColor: "var(--border)" }}
              >
                <div className="space-y-2">
                  {AREA_COLS.map((a) => (
                    <label key={a} className="flex items-center gap-2 cursor-pointer" style={{ color: "var(--text)" }}>
                      <input
                        type="checkbox"
                        checked={selectedAreas.has(a)}
                        onChange={(e) => {
                          const newAreas = new Set(selectedAreas)
                          if (e.target.checked) {
                            newAreas.add(a)
                          } else {
                            newAreas.delete(a)
                          }
                          setSelectedAreas(newAreas)
                        }}
                        style={{ cursor: "pointer" }}
                      />
                      <span className="text-xs">{a}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main grid like the sketch: top country lines + big line chart + right "expectations" box + bottom donut + severity bar */}
      <div className="grid grid-cols-12 gap-4">
        {/* Country lines (TOP) */}
        <div className="col-span-12 rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid", borderColor: "var(--border)" }}>
          <div className="text-sm font-semibold mb-2" style={{ color: "var(--text)" }}>Incidents over time by country</div>
          <div className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>Top countries + Other</div>
          <CountryLines rows={rows} filtered={filtered} setCountry={setCountry} />
        </div>

        {/* Line chart */}
          <div className="col-span-12 lg:col-span-8 rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid", borderColor: "var(--border)" }}>
          <div className="text-sm font-semibold mb-2" style={{ color: "var(--text)" }}>Incidents over time</div>
          <div className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>Counts after filters</div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={lineData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="0" stroke="var(--border)" />
              <XAxis dataKey="year" stroke="var(--text-muted)" />
              <YAxis stroke="var(--text-muted)" allowDecimals={false} />
              <Tooltip content={<CustomLineTooltip />} />
              <Line type="monotone" dataKey="reports" stroke="var(--text)" strokeWidth={3} dot={<CustomLineDot />} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Right notes / summary box (matches the “EXPECT…” scribble block) */}
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

            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              Filters applied: country={country}, year={year}, settings={selectedAreas.size > 0 ? Array.from(selectedAreas).join(", ") : "All"}
            </div>
          </div>
        </div>

        {/* Primary classification (middle, full width) */}
        <div className="col-span-12 rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid", borderColor: "var(--border)" }}>
          <div className="text-sm font-semibold mb-2" style={{ color: "var(--text)" }}>Primary classification</div>
          <div className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>Count of incidents by primary_classification_std</div>
          <ResponsiveContainer width="100%" height={Math.max(120, Math.min(400, primaryData.length * 36))}>
            <BarChart data={primaryData} layout="vertical" margin={{ top: 6, right: 10, left: 10, bottom: 6 }}>
              <CartesianGrid strokeDasharray="0" stroke="var(--border)" />
              <XAxis type="number" stroke="var(--text-muted)" hide />
              <YAxis type="category" dataKey="name" stroke="var(--text-muted)" width={220} />
              <Tooltip content={<CustomBarTooltip />} />
              <Bar dataKey="value" isAnimationActive={false}>
                {primaryData.map((d, i) => (
                  <Cell
                    key={i}
                    fill={d.color}
                    fillOpacity={0.12}
                    stroke={d.color}
                    strokeWidth={2}
                    onClick={() => setSelectedPrimary((s) => (s === d.name ? null : d.name))}
                    style={{ cursor: 'pointer' }}
                  />
                ))}
                <LabelList
                  dataKey="label"
                  position="insideRight"
                  content={(props: any) => {
                    const { x, y, width, height, index } = props
                    const item = primaryData[index]
                    if (!item || !item.label) return null
                    const cx = x + width - 8
                    const cy = y + height / 2 + 4
                    return (
                      <text x={cx} y={cy} fill={item.color} fontSize={12} textAnchor="end">
                        {item.label}
                      </text>
                    )
                  }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Donut (risk distribution) */}
        <div className="col-span-12 lg:col-span-5 rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid", borderColor: "var(--border)" }}>
          <div className="text-sm font-semibold mb-2" style={{ color: "var(--text)" }}>Risk distribution</div>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={riskData} dataKey="value" nameKey="name" innerRadius={70} outerRadius={105} paddingAngle={2}>
                  {riskData.map((d, i) => (
                    <Cell
                      key={i}
                      fill={riskColors[d.name] || "#9AA0A6"}
                      fillOpacity={0.12}
                      stroke={riskColors[d.name] || "#9AA0A6"}
                      strokeWidth={2}
                      onClick={() => setSelectedRisk((s) => (s === d.name ? null : d.name))}
                      style={{ cursor: 'pointer' }}
                    />
                  ))}
                </Pie>
              <Tooltip content={<CustomPieTooltip />} />
            </PieChart>
          </ResponsiveContainer>

          {/* Small legend (sketch-like) */}
          <div className="mt-2 flex flex-wrap gap-3 text-xs" style={{ color: "var(--text)" }}>
            {riskData
              .slice()
              .sort((a, b) => b.value - a.value)
              .map((d) => (
                <div key={d.name} className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5" style={{ background: 'rgba(0,0,0,0)', border: `2px solid ${riskColors[d.name] || "#9AA0A6"}`, boxSizing: 'border-box' }} />
                  <span style={{ color: "var(--text-muted)" }}>
                    {d.name}: {Math.round((d.value / Math.max(1, summary.total)) * 100)}%
                  </span>
                </div>
              ))}
          </div>
        </div>

        {/* Severity bar (vertical list like the sketch) */}
        <div className="col-span-12 lg:col-span-7 rounded-xl p-4" style={{ background: "var(--card)", border: "1px solid", borderColor: "var(--border)" }}>
          <div className="text-sm font-semibold mb-2" style={{ color: "var(--text)" }}>Severity counts</div>
          <div className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>Ordered least → most severe</div>

          <ResponsiveContainer width="100%" height={260}>
            <BarChart
                data={severityData}
                layout="vertical"
                margin={{ top: 10, right: 20, left: 30, bottom: 0 }}
              >
              <CartesianGrid strokeDasharray="0" stroke="var(--border)" />
              <XAxis type="number" stroke="var(--text-muted)" allowDecimals={false} />
              <YAxis type="category" dataKey="name" stroke="var(--text-muted)" width={140} />
              <Tooltip content={<CustomBarTooltip />} />
                <Bar dataKey="value" isAnimationActive={false}>
                  {severityData.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d.name ? severityColors[d.name] || severityColors.Unknown : severityColors.Unknown}
                      fillOpacity={0.12}
                      stroke={d.name ? severityColors[d.name] || severityColors.Unknown : severityColors.Unknown}
                      strokeWidth={2}
                      onClick={() => setSelectedSeverity((s) => (s === d.name ? null : d.name))}
                      style={{ cursor: 'pointer' }}
                    />
                  ))}
                </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Footer */}
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
