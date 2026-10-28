import { SquashButton } from "@/ui/SquashButton";

export default function NotFound() {
  return (
    <section className="section-card bg-aqua-soft px-5 sm:px-12 pt-28 pb-16">
      <h1 className="display text-[clamp(2.6rem,6vw,5.6rem)]">Not here.</h1>
      <div className="mt-8">
        <SquashButton href="/">Try it on</SquashButton>
      </div>
    </section>
  );
}
