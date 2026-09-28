/** The top row of a share card: the Q2DINK mark on the left and the date on the right. */
export function CardTop({ date }: { date: string }) {
  return (
    <div className="flex items-center justify-between text-sm font-semibold tracking-widest">
      <span>Q2DINK</span>
      <span className="opacity-80">{date}</span>
    </div>
  )
}

/** The club's card logo (see lib/cardLogos.ts), beside a card's title block. */
export function CardLogo({ src }: { src: string }) {
  return <img src={src} alt="Club logo" className="max-h-12 max-w-[120px] shrink-0 object-contain" />
}
