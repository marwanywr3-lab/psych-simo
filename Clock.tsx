import { clockText } from "../game/time";
export function Clock({
  minutes,
  day,
  en,
}: {
  minutes: number;
  day: number;
  en: boolean;
}) {
  return (
    <div
      className="clock"
      aria-label={`${en ? "Day" : "اليوم"} ${day}, ${clockText(minutes)}`}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="#f8f0df"
          stroke="#907452"
          strokeWidth="2"
        />
        {Array.from({ length: 12 }, (_, i) => (
          <line
            key={i}
            x1="50"
            y1="9"
            x2="50"
            y2={i % 3 === 0 ? 17 : 13}
            transform={`rotate(${i * 30} 50 50)`}
            stroke="#68503e"
            strokeWidth="2"
          />
        ))}
        <line
          x1="50"
          y1="50"
          x2="50"
          y2="28"
          stroke="#493b30"
          strokeWidth="4"
          strokeLinecap="round"
          transform={`rotate(${minutes / 2} 50 50)`}
        />
        <line
          x1="50"
          y1="50"
          x2="50"
          y2="18"
          stroke="#80454a"
          strokeWidth="2.5"
          strokeLinecap="round"
          transform={`rotate(${minutes * 6} 50 50)`}
        />
        <circle cx="50" cy="50" r="3" fill="#80454a" />
      </svg>
      <span dir="ltr">{clockText(minutes)}</span>
      <small>
        {en ? "Day" : "اليوم"} {day}
      </small>
    </div>
  );
}
