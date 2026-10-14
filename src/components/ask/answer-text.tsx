"use client";

import { segmentAnswer } from "@/lib/citations";
import { cn } from "@/lib/utils";

interface Props {
  text: string;
  sourceCount: number;
  streaming: boolean;
  activeIndex: number | null;
  onCite: (index: number) => void;
}

/** Renders answer text with inline, clickable citation chips. */
export function AnswerText({ text, sourceCount, streaming, activeIndex, onCite }: Props) {
  const segments = segmentAnswer(text, sourceCount);
  return (
    <div className={cn("whitespace-pre-wrap text-[15px] leading-7", streaming && "streaming-caret")}>
      {segments.map((segment, i) =>
        segment.type === "text" ? (
          <span key={i}>{segment.text}</span>
        ) : (
          <span key={i} className="mx-0.5 inline-flex -translate-y-px gap-0.5 align-middle">
            {segment.indices.map((index) => (
              <button
                key={index}
                type="button"
                data-testid="citation"
                onClick={() => onCite(index)}
                aria-label={`Show source ${index}`}
                className={cn(
                  "inline-grid h-5 min-w-5 place-items-center rounded px-1 font-mono text-[11px] leading-none font-semibold transition-colors",
                  activeIndex === index
                    ? "bg-primary text-primary-foreground"
                    : "bg-accent text-accent-foreground hover:bg-primary hover:text-primary-foreground",
                )}
              >
                {index}
              </button>
            ))}
          </span>
        ),
      )}
    </div>
  );
}
