// components/home/Marquee.tsx
const items = [
  'Agenda inteligente',
  'Integração laboratorial',
];

export default function Marquee() {
  return (
    <section className="border-y border-hairline bg-cream py-8">
      <div className="mx-auto max-w-[1400px] overflow-hidden px-8">
        <div className="flex items-center gap-16 whitespace-nowrap text-sm uppercase tracking-[0.2em] text-ink-soft">
          {[...items, ...items].map((label, i) => (
            <span key={i} className="flex items-center gap-16">
              <span className="h-1 w-1 rounded-full bg-sage" />
              {label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
