"use client"

import type { SeverityResult } from "@/lib/types"

interface SeverityBadgeProps {
  severity: SeverityResult
}

export default function SeverityBadge({ severity }: SeverityBadgeProps) {
  if (!severity.available) return null

  // Map label to CSS rgb variable names defined in globals.css
  function labelToKey(label: string) {
    const map: Record<string, string> = {
      "Near Miss": "nearmiss",
      "Potentially Significant": "potential",
    }
    if (map[label]) return map[label]
    return String(label ?? "unknown").toLowerCase().replace(/[^a-z]/g, '') || 'unknown'
  }

  const key = labelToKey(severity.label)
  const rgbVar = `--severity-${key}-rgb`

  return (
    <span
      className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: `rgba(var(${rgbVar}), 0.12)`,
        border: `1px solid rgba(var(${rgbVar}), 0.36)`,
        color: `rgb(var(${rgbVar}))`,
      }}
    >
      {severity.label}  ·  {Math.round(severity.confidence * 100)}% confidence
    </span>
  )
}
