"use client"

import React, { useMemo } from 'react'
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from 'recharts'

type Row = Record<string, any>

const COLORS = ['#34A853','#FBBC05','#EA4335','#2563eb','#7c3aed','#06b6d4','#f97316']

const COUNTRY_COLORS: Record<string,string> = {
  "Canada": "#EA4335",
  "USA": "#4285F4",
  "Chile": "#FBBC05",
  "Belgium": "#34A853",
  "Egypt": "#A142F4",
  "New Zealand": "#00ACC1",
  "Remote": "#5F6368",
  "Trinidad & Tobago": "#FF8F00",
  "Other": "#C7C7C7",
}

const PREFERRED_ORDER = ["Canada","USA","Chile","Belgium","Egypt","New Zealand","Remote","Trinidad & Tobago"]

export default function CountryLines({ rows, filtered, setCountry }:{ rows:Row[], filtered:Row[], setCountry:(c:string)=>void }){
  // compute top countries by total in full rows
  const { data, countries } = useMemo(()=>{
    const totalByCountry = new Map<string, number>()
    rows.forEach(r=>{ const c = String(r.country||r.country_name||'Unknown'); if (!c) return; totalByCountry.set(c, (totalByCountry.get(c)||0)+1) })
    // Prefer the countries in PREFERRED_ORDER first if present
    const presentPreferred = PREFERRED_ORDER.filter(c=> totalByCountry.has(c))
    const remaining = Array.from(totalByCountry.entries()).filter(([c])=>!presentPreferred.includes(c)).sort((a,b)=>b[1]-a[1]).map(([c])=>c)
    const top = [...presentPreferred, ...remaining].slice(0,6)
    // years across all rows
    const yearsSet = new Set<number>()
    rows.forEach(r=>{ const y = Number(r.year); if (Number.isFinite(y)) yearsSet.add(y) })
    const years = Array.from(yearsSet).sort((a,b)=>a-b)
    const dat = years.map(y=>{
      const o:any = { year: y }
      // counts per country
      const cmap = new Map<string, number>()
      filtered.forEach(fr=>{ if (Number(fr.year)===y){ const k = top.includes(String(fr.country))?String(fr.country):'Other'; cmap.set(k, (cmap.get(k)||0)+1) } })
      top.forEach(t=> o[t] = cmap.get(t)||0 )
      o['Other'] = cmap.get('Other')||0
      return o
    })
    return { data: dat, countries: [...top,'Other'] }
  }, [rows, filtered])

  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={'var(--border)'} />
          <XAxis dataKey="year" stroke={'var(--text-muted)'} />
          <YAxis stroke={'var(--text-muted)'} />
          <Tooltip />
          <Legend onClick={(e:any)=>{ if(e && e.value) setCountry(e.value) }} />
          {countries.map((c,i)=> (
            <Line key={c} type="monotone" dataKey={c} stroke={COUNTRY_COLORS[c] || COLORS[i%COLORS.length]} strokeWidth={2} dot={{ r:3 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
