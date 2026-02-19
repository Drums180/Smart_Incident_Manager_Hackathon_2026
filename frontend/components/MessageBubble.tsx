"use client"

import { Bot } from "lucide-react"
import type { Message } from "@/lib/types"
import SeverityBadge from "@/components/SeverityBadge"
import SourcesPanel from "@/components/SourcesPanel"

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0
  while (remaining.length > 0) {
    const bold = remaining.match(/\*\*(.+?)\*\*/)
    const italic = remaining.match(/\*(.+?)\*/)
    let match: RegExpMatchArray | null = null
    let type: "bold" | "italic" | "plain" = "plain"
    if (bold && (italic === null || bold.index! <= italic.index!)) {
      match = bold
      type = "bold"
    } else if (italic) {
      match = italic
      type = "italic"
    }
    if (match) {
      if (match.index! > 0) {
        parts.push(
          <span key={key++}>{remaining.slice(0, match.index)}</span>
        )
      }
      if (type === "bold") {
        parts.push(<strong key={key++}>{match[1]}</strong>)
      } else {
        parts.push(<em key={key++}>{match[1]}</em>)
      }
      remaining = remaining.slice(match.index! + match[0].length)
    } else {
      parts.push(<span key={key++}>{remaining}</span>)
      break
    }
  }
  return <>{parts}</>
}

function renderSimpleMarkdown(content: string): React.ReactNode {
  const blocks = content.trim().split(/\n\n/)
  const out: React.ReactNode[] = []

  blocks.forEach((block, blockIdx) => {
    const lines = block.split("\n")
    let listItems: string[] = []
    let listOrdered: boolean | null = null

    const flushList = () => {
      if (listItems.length === 0) return
      const ListTag = listOrdered ? "ol" : "ul"
      out.push(
        <ListTag
          key={`${blockIdx}-list-${out.length}`}
          className={`list-inside mb-3 ${listOrdered ? "list-decimal" : "list-disc"}`}
        >
          {listItems.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ListTag>
      )
      listItems = []
      listOrdered = null
    }

    for (const line of lines) {
      const bulletMatch = line.match(/^[-•]\s+(.*)/s)
      const orderedMatch = line.match(/^(\d+)\.\s+(.*)/s)
      if (bulletMatch) {
        if (listOrdered === true) flushList()
        listOrdered = false
        listItems.push(bulletMatch[1].trim())
      } else if (orderedMatch) {
        if (listOrdered === false) flushList()
        listOrdered = true
        listItems.push(orderedMatch[2].trim())
      } else {
        flushList()
        out.push(
          <p key={`${blockIdx}-p-${out.length}`} className="mb-3">
            {renderInline(line)}
          </p>
        )
      }
    }
    flushList()
  })

  return <>{out}</>
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

interface MessageBubbleProps {
  message: Message
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  if (message.role === "user") {
    return (
      <div className="flex w-full justify-end">
        <div className="flex max-w-[80%] flex-col items-end gap-0.5">
          <div
            className="rounded-2xl rounded-br-sm px-4 py-3 text-sm whitespace-pre-wrap"
            style={{ background: "#1d2230", color: "var(--text)" }}
          >
            {message.content}
          </div>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {formatTime(message.created_at)}
          </span>
        </div>
      </div>
    )
  }

  // Assistant message (or loading)
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <Bot className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--text-muted)" }} />
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Safety AnalystBot
        </span>
      </div>
      {message.severity && <SeverityBadge severity={message.severity} />}
      {message.isLoading ? (
        <div className="flex gap-1">
          <span
            className="h-2 w-2 animate-bounce rounded-full"
            style={{ background: "var(--text-muted)", animationDelay: "0ms" }}
          />
          <span
            className="h-2 w-2 animate-bounce rounded-full"
            style={{ background: "var(--text-muted)", animationDelay: "100ms" }}
          />
          <span
            className="h-2 w-2 animate-bounce rounded-full"
            style={{ background: "var(--text-muted)", animationDelay: "200ms" }}
          />
        </div>
      ) : (
        <div
          className="text-sm leading-relaxed"
          style={{ color: "var(--text)" }}
        >
          {renderSimpleMarkdown(message.content)}
        </div>
      )}
      <SourcesPanel sources={message.sources ?? []} />
    </div>
  )
}
