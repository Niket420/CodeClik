import {
  ArrowRight,
  Braces,
  Check,
  Command,
  Files,
  Sparkles,
  TerminalSquare,
} from "lucide-react";
import {
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import Link from "next/link";
import BrandMark from "@/components/brand/BrandMark";

export default function HomePage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#000000] text-[#e6edf3]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-[radial-gradient(circle_at_50%_-15%,rgba(0,122,204,0.26),transparent_58%)]" />

      <nav className="relative z-10 mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="group flex items-center gap-3">
          <BrandMark size={36} className="transition group-hover:scale-105" />
          <span className="text-base font-semibold tracking-tight text-white">
            CodeClik
          </span>
        </Link>

        <div className="flex items-center gap-2 sm:gap-3">
          <Show when="signed-out">
            <SignInButton>
              <button className="hidden rounded-md px-3 py-2 text-sm font-medium text-[#c9d1d9] transition hover:bg-white/6 hover:text-white sm:inline-flex">
                Sign in
              </button>
            </SignInButton>
            <SignUpButton>
              <button className="inline-flex items-center gap-2 rounded-md bg-white px-3.5 py-2 text-sm font-semibold text-black shadow-lg shadow-black/30 transition hover:bg-[#d4d4d4] sm:px-4">
                Start coding
                <ArrowRight size={15} />
              </button>
            </SignUpButton>
          </Show>
          <Show when="signed-in">
            <Link
              href="/playground"
              className="hidden rounded-md px-3 py-2 text-sm font-medium text-[#c9d1d9] transition hover:bg-white/6 hover:text-white sm:inline-flex"
            >
              Open editor
            </Link>
            <UserButton />
          </Show>
        </div>
      </nav>

      <section className="relative z-10 mx-auto grid max-w-7xl items-center gap-14 px-5 pb-18 pt-16 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:pb-28 lg:pt-24">
        <div className="max-w-2xl">
          <div
            className="cf-fade-up mb-7 inline-flex items-center gap-2 rounded-full border border-[#262626] bg-[#0a0a0a]/85 px-3 py-1.5 text-xs font-medium text-[#c9d1d9] shadow-sm"
            style={{ animationDelay: "0ms" }}
          >
            <Sparkles size={14} className="text-white" />
            Your focused browser workspace
          </div>

          <h1
            className="cf-fade-up text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.045em] text-white sm:text-6xl lg:text-[4.25rem]"
            style={{ animationDelay: "80ms" }}
          >
            Make an idea real
            <span className="block bg-gradient-to-r from-white via-[#d4d4d4] to-[#8b949e] bg-clip-text text-transparent">
              without leaving flow.
            </span>
          </h1>

          <p
            className="cf-fade-up mt-6 max-w-xl text-pretty text-base leading-7 text-[#9da9b5] sm:text-lg"
            style={{ animationDelay: "160ms" }}
          >
            CodeClik pairs a familiar VS Code-inspired workspace with an in-browser terminal and a fast, distraction-free editor.
          </p>

          <div
            className="cf-fade-up mt-9 flex flex-col gap-3 sm:flex-row"
            style={{ animationDelay: "240ms" }}
          >
            {/* Signed out: sign in first, then land in the editor. */}
            <Show when="signed-out">
              <SignInButton forceRedirectUrl="/playground" signUpForceRedirectUrl="/playground">
                <button className="group inline-flex items-center justify-center gap-2 rounded-md bg-white px-5 py-3 text-sm font-semibold text-black shadow-xl shadow-black/30 transition hover:bg-[#d4d4d4]">
                  Open your workspace
                  <ArrowRight size={16} className="transition group-hover:translate-x-0.5" />
                </button>
              </SignInButton>
            </Show>
            <Show when="signed-in">
              <Link
                href="/playground"
                className="group inline-flex items-center justify-center gap-2 rounded-md bg-white px-5 py-3 text-sm font-semibold text-black shadow-xl shadow-black/30 transition hover:bg-[#d4d4d4]"
              >
                Open your workspace
                <ArrowRight size={16} className="transition group-hover:translate-x-0.5" />
              </Link>
            </Show>
          </div>

          <div
            className="cf-fade-up mt-10 grid w-fit gap-x-8 gap-y-3 text-sm text-[#8b949e] sm:grid-cols-2"
            style={{ animationDelay: "320ms" }}
          >
            {[
              "AI agent that builds and tests",
              "Bring your own AI model",
              "Node.js terminal in the browser",
              "Git & GitHub built in",
              "Live preview as you code",
              "Codebase-aware AI context",
            ].map((item) => (
              <span key={item} className="flex items-center gap-2">
                <Check size={15} className="text-[#3fb950]" />
                {item}
              </span>
            ))}
          </div>
        </div>

        <div
          id="workspace"
          className="cf-fade-up relative mx-auto w-full max-w-2xl lg:max-w-none"
          style={{ animationDelay: "160ms" }}
        >
          <div className="absolute -inset-6 rounded-[2rem] bg-white/5 blur-3xl" />
          <div className="relative overflow-hidden rounded-xl border border-[#262626] bg-[#0a0a0a] shadow-2xl shadow-black/45 ring-1 ring-white/5">
            <div className="flex h-10 items-center border-b border-[#262626] bg-[#121212] px-3">
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#f14c4c]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#cca700]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#3fb950]" />
              </div>
              <div className="mx-auto rounded-md border border-[#262626] bg-[#000000] px-4 py-1 font-mono text-[10px] text-[#8b949e]">
                portfolio.tsx — CodeClik
              </div>
              <Command size={14} className="text-[#8b949e]" />
            </div>

            <div className="grid min-h-[360px] grid-cols-[44px_140px_minmax(0,1fr)] sm:min-h-[420px] sm:grid-cols-[48px_170px_minmax(0,1fr)]">
              <aside className="flex flex-col items-center gap-5 border-r border-[#262626] bg-[#0a0a0a] py-4 text-[#7f8791]">
                <Files size={20} className="text-white" />
                <span className="relative">
                  <Braces size={19} />
                  <span className="absolute -left-3 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-white" />
                </span>
                <TerminalSquare size={19} />
                <Sparkles size={19} />
              </aside>

              <aside className="border-r border-[#262626] bg-[#0a0a0a] py-4 font-mono text-[10px] sm:text-xs">
                <div className="mb-4 flex items-center justify-between px-3 text-[10px] font-semibold tracking-[0.13em] text-[#aeb8c2]">
                  EXPLORER
                  <span className="text-base font-normal text-[#7f8791]">···</span>
                </div>
                <div className="px-3 text-[#c9d1d9]">⌄ &nbsp; MY-PORTFOLIO</div>
                <div className="mt-2 space-y-1 text-[#8b949e]">
                  <div className="px-5">⌄ &nbsp; app</div>
                  <div className="bg-[#1a1a1a] px-7 py-1 text-[#e6edf3]">⌘ &nbsp; page.tsx</div>
                  <div className="px-7"># &nbsp; globals.css</div>
                  <div className="px-5">⌄ &nbsp; components</div>
                  <div className="px-7">⌘ &nbsp; hero.tsx</div>
                  <div className="px-3 pt-2">◈ &nbsp; package.json</div>
                </div>
              </aside>

              <div className="min-w-0 bg-[#000000] font-mono text-[10px] leading-6 sm:text-xs sm:leading-7">
                <div className="flex h-9 items-end border-b border-[#262626] bg-[#0a0a0a] text-[#c9d1d9]">
                  <span className="flex h-full items-center gap-2 border-t-2 border-white bg-[#000000] px-3">
                    <span className="text-[#8b949e]">⌘</span>
                    page.tsx
                    <span className="hidden text-[#6e7681] sm:inline">×</span>
                  </span>
                </div>
                <div className="grid grid-cols-[28px_minmax(0,1fr)] px-2 py-4 text-[#c9d1d9] sm:grid-cols-[34px_minmax(0,1fr)]">
                  <div className="select-none text-right text-[#484f58]">1<br />2<br />3<br />4<br />5<br />6<br />7<br />8</div>
                  <div className="overflow-hidden pl-3 text-left">
                    <div><span className="text-[#ff7b72]">export default function</span> <span className="text-[#d2a8ff]">Portfolio</span>()</div>
                    <div className="text-[#c9d1d9]">&nbsp;&nbsp;<span className="text-[#ff7b72]">return</span> (</div>
                    <div>&nbsp;&nbsp;&nbsp;&nbsp;<span className="text-[#7ee787]">&lt;main</span> <span className="text-[#79c0ff]">className</span>=<span className="text-[#a5d6ff]">&quot;space-y-8&quot;</span><span className="text-[#7ee787]">&gt;</span></div>
                    <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span className="text-[#7ee787]">&lt;Hero</span> <span className="text-[#79c0ff]">title</span>=<span className="text-[#a5d6ff]">&quot;Hello, world&quot;</span> <span className="text-[#7ee787]">/&gt;</span></div>
                    <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span className="text-[#7ee787]">&lt;Projects</span> <span className="text-[#79c0ff]">featured</span> <span className="text-[#7ee787]">/&gt;</span></div>
                    <div>&nbsp;&nbsp;&nbsp;&nbsp;<span className="text-[#7ee787]">&lt;/main&gt;</span></div>
                    <div>&nbsp;&nbsp;)</div>
                  </div>
                </div>
                <div className="mt-auto flex items-center justify-between border-t border-[#262626] bg-[#0a0a0a] px-3 py-1.5 text-[9px] text-[#8b949e] sm:text-[10px]">
                  <span>main*</span>
                  <span>TypeScript React &nbsp; • &nbsp; UTF-8 &nbsp; • &nbsp; Ln 1, Col 1</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

    </main>
  );
}

