"use client"

import { useState, useEffect } from "react"
import { getStatus } from "@/lib/api"

const SUGGESTED_QUESTIONS = [
  "What are the most common root causes of Major incidents?",
  "How did incidents change from 2022 to 2024?",
  "What incidents happened in Vancouver?",
  "Which AI system failures caused the most damage?",
  "Give me a pre-shift brief for valve isolation work tomorrow",
  "What patterns keep repeating across all incidents?",
]

interface WelcomeScreenProps {
  onQuestion: (q: string) => void
}

export default function WelcomeScreen({ onQuestion }: WelcomeScreenProps) {
  const [chunkCount, setChunkCount] = useState(0)

  useEffect(() => {
    getStatus()
      .then((res) => setChunkCount(res.rag?.chunks ?? 0))
      .catch(() => setChunkCount(0))
  }, [])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-8">
      {/* Title block */}
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="relative h-16 w-16 shrink-0">
          <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-full w-full">
            <defs>
              <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#06b6d4" />
              </linearGradient>
            </defs>
            <circle cx="32" cy="32" r="28" fill="url(#logoGradient)" opacity="0.2" />
            <path
              d="M32 12 L42 18 L42 28 L50 32 L42 36 L42 46 L32 52 L22 46 L22 36 L14 32 L22 28 L22 18 Z"
              fill="url(#logoGradient)"
              stroke="url(#logoGradient)"
              strokeWidth="2"
            />
            <circle cx="32" cy="32" r="8" fill="white" opacity="0.9" />
          </svg>
        </div>
        <h2 className="text-2xl font-semibold" style={{ color: "var(--text)" }}>
          Safety AnalystBot
        </h2>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Ask anything about the safety incident records
        </p>
      </div>

      {/* Suggestion cards */}
      <div className="grid w-full max-w-lg grid-cols-2 gap-3">
        {SUGGESTED_QUESTIONS.map((q, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onQuestion(q)}
            className="
              cursor-pointer rounded-lg border p-3 text-left text-sm leading-snug
              transition-all duration-150
              hover:border-blue-500 hover:bg-[#1a2030]
              hover:shadow-[0_0_0_1px_rgba(59,130,246,0.4)]
              active:scale-[0.97] active:bg-[#151d2e]
            "
            style={{
              background:  "var(--card)",
              borderColor: "var(--border)",
              color:       "var(--text)",
            }}
          >
            {q}
          </button>
        ))}
      </div>

      <p className="text-center text-xs" style={{ color: "var(--text-muted)" }}>
        {chunkCount > 0 ? `${chunkCount} chunks indexed` : "Loading index…"}
      </p>
    </div>
  )
}
