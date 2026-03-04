"use client"

import React, { useEffect, useState } from "react"
import { ComposableMap, Geographies, Geography } from "react-simple-maps"

const TOPO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"

export default function MapPlaceholder({ height = 260 }: { height?: number }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <div 
      className="w-full relative overflow-hidden" 
      style={{ 
        minHeight: height,
        background: 'var(--surface)',
        borderRadius: '0.75rem',
      }}
    >
      {/* Animated background grid pattern */}
      <svg 
        className="absolute inset-0 w-full h-full opacity-5"
        style={{ pointerEvents: 'none' }}
      >
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#3b82f6" strokeWidth="0.5"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>

      {/* Title */}
      <div className="absolute top-4 left-4 z-10 text-sm font-semibold" style={{ color: '#000' }}>
        World incidents map
      </div>

      {/* Main map */}
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ 
          scale: 160,
          center: [0, 20]
        }}
        width={1200}
        height={height}
        style={{ width: '100%', height: '100%' }}
      >
        <defs>
          <linearGradient id="oceanGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style={{ stopColor: '#ffffff', stopOpacity: 1 }} />
            <stop offset="100%" style={{ stopColor: '#f5f5f5', stopOpacity: 1 }} />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        {/* Ocean/background */}
        <rect width="1200" height={height} fill="url(#oceanGradient)" />

        <Geographies geography={TOPO_URL}>
          {({ geographies }) => (
            <>
              {geographies.map((geo) => (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  style={{
                    default: {
                      fill: 'transparent',
                      stroke: '#374151',
                      strokeWidth: 0.8,
                      outline: 'none',
                      transition: 'all 250ms ease',
                      cursor: 'pointer',
                    },
                    hover: {
                      fill: '#eff6ff',
                      stroke: '#3b82f6',
                      strokeWidth: 1,
                      outline: 'none',
                      cursor: 'pointer',
                      filter: 'url(#glow)',
                    },
                    pressed: {
                      fill: '#dbeafe',
                      stroke: '#2563eb',
                      strokeWidth: 1,
                      outline: 'none',
                    },
                  }}
                />
              ))}

              {/* Decorative connection lines (animated) */}
              {mounted && (
                <g opacity="0.15" stroke="#3b82f6" strokeWidth="0.5" fill="none">
                  <line x1="20%" y1="30%" x2="80%" y2="35%" strokeDasharray="5,5" />
                  <line x1="30%" y1="60%" x2="75%" y2="55%" strokeDasharray="5,5" />
                  <line x1="40%" y1="20%" x2="70%" y2="75%" strokeDasharray="5,5" />
                </g>
              )}
            </>
          )}
        </Geographies>
      </ComposableMap>

      {/* Corner accent lights */}
      <div 
        className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-0" 
        style={{
          background: 'radial-gradient(circle, rgba(59,130,246,0.1) 0%, transparent 70%)',
          pointerEvents: 'none',
          animation: 'pulse 3s ease-in-out infinite'
        }}
      />
      <div 
        className="absolute bottom-0 left-0 w-32 h-32 rounded-full opacity-0" 
        style={{
          background: 'radial-gradient(circle, rgba(59,130,246,0.1) 0%, transparent 70%)',
          pointerEvents: 'none',
          animation: 'pulse 4s ease-in-out 1s infinite'
        }}
      />
    </div>
  )
}
