type Props = {
  text: string
  className?: string
  delayStep?: number
  baseDelay?: number
}

const NBSP = String.fromCharCode(160)

export function StaggeredText({ text, className, delayStep = 0.035, baseDelay = 0 }: Props) {
  return (
    <span className={className} aria-label={text}>
      {[...text].map((ch, i) => (
        <span
          key={i}
          className="stagger-char"
          style={{ animationDelay: `${baseDelay + i * delayStep}s` }}
          aria-hidden="true"
        >
          {ch === ' ' ? NBSP : ch}
        </span>
      ))}
    </span>
  )
}
