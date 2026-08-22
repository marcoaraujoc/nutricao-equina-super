// src/pages/Home.tsx
//
// Página institucional pública — mostrada em "/" para quem NÃO está logado
// (RootGate, em App.tsx). Reconstrução, dentro do stack do S2Vet (React 18 +
// Tailwind v3 + react-router-dom), do rascunho visual feito no Lovable em
// `Página Principal/src/routes/index.tsx` — mesmos textos, fotos e animações,
// só trocando a marca "VetMind" por "S2Vet". Ver CLAUDE.md para o histórico
// da decisão.
//
// É uma página "solta", sem Sidebar/AppHeader do sistema interno — mesmo
// padrão de Login.tsx/Register.tsx.
import Nav from '../components/home/Nav';
import Hero from '../components/home/Hero';
import Marquee from '../components/home/Marquee';
import Features from '../components/home/Features';
import Workflow from '../components/home/Workflow';
import Differentiators from '../components/home/Differentiators';
import ClosingCTA from '../components/home/ClosingCTA';
import Footer from '../components/home/Footer';

export default function Home() {
  return (
    <main className="min-h-screen bg-cream text-ink">
      <Nav />
      <Hero />
      <Marquee />
      <Features />
      <Workflow />
      <Differentiators />
      <ClosingCTA />
      <Footer />
    </main>
  );
}
