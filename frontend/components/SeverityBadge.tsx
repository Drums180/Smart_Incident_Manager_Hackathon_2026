"use client"

import type { SeverityResult } from "@/lib/types"

interface SeverityBadgeProps {
  severity: SeverityResult
}

export default function SeverityBadge({ severity }: SeverityBadgeProps) {
  if (!severity.available) return null

  const bgWithAlpha = severity.color + "26"
  const borderWithAlpha = severity.color + "66"

  return (
    <span
      className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: bgWithAlpha,
        border: `1px solid ${borderWithAlpha}`,
        color: severity.color,
      }}
    >
      {severity.label}  ·  {Math.round(severity.confidence * 100)}% confidence
    </span>
  )
}
