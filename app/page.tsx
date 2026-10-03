import {
  ArrowRight,
  Blocks,
  Check,
  Command,
  Files,
  GitBranch,
  Search,
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
          {/* Mockup of the real editor: activity bar, explorer, code, terminal, AI agent, status bar. */}
          <div className="relative overflow-hidden rounded-xl border border-[#262626] bg-[#0a0a0a] shadow-2xl shadow-black/45 ring-1 ring-white/5">
            <div className="flex h-9 items-center border-b border-[#262626] bg-[#121212] px-3">
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#f14c4c]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#cca700]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#3fb950]" />
              </div>
              <div className="mx-auto rounded-md border border-[#262626] bg-[#000000] px-4 py-0.5 font-mono text-[10px] text-[#8b949e]">
                restaurant-pos — CodeClik
              </div>
              <Command size={13} className="text-[#8b949e]" />
            </div>

            <div className="flex h-[400px] sm:h-[440px]">
              {/* Activity bar */}
              <aside className="flex w-10 shrink-0 flex-col items-center gap-4 border-r border-[#262626] bg-[#0a0a0a] py-3 text-[#7f8791]">
                <span className="relative text-white">
                  <Files size={17} />
                  <span className="absolute -left-3 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-white" />
                </span>
                <Search size={17} />
                <span className="relative">
                  <GitBranch size={17} />
                  <span className="absolute -right-2 -top-1.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-[#1f6feb] px-0.5 text-[8px] font-semibold text-white">
                    3
                  </span>
                </span>
                <Blocks size={17} />
              </aside>

              {/* Explorer */}
              <aside className="hidden w-[132px] shrink-0 border-r border-[#262626] bg-[#0a0a0a] py-3 font-mono text-[10px] sm:block">
                <div className="mb-3 px-3 text-[9px] font-semibold tracking-[0.13em] text-[#aeb8c2]">EXPLORER</div>
                <div className="space-y-1 text-[#8b949e]">
                  <div className="px-3 text-[#c9d1d9]">⌄ RESTAURANT-POS</div>
                  <div className="px-4">⌄ src</div>
                  <div className="flex justify-between bg-[#1a1a1a] pl-6 pr-2 text-[#e6edf3]">
                    App.jsx <span className="text-[#e3b341]">M</span>
                  </div>
                  <div className="flex justify-between pl-6 pr-2">
                    store.jsx <span className="text-[#e3b341]">M</span>
                  </div>
                  <div className="pl-6">⌄ components</div>
                  <div className="flex justify-between pl-8 pr-2">
                    Menu.jsx <span className="text-[#3fb950]">U</span>
                  </div>
                  <div className="pl-8">Bill.jsx</div>
                  <div className="px-4">index.html</div>
                  <div className="px-4">package.json</div>
                </div>
              </aside>

              {/* Editor + terminal */}
              <div className="flex min-w-0 flex-1 flex-col bg-[#000000] font-mono text-[10px]">
                <div className="flex h-8 shrink-0 items-end border-b border-[#262626] bg-[#0a0a0a] text-[#c9d1d9]">
                  <span className="flex h-full items-center gap-2 border-t-2 border-white bg-[#000000] px-3">
                    App.jsx
                    <span className="text-[#6e7681]">×</span>
                  </span>
                  <span className="flex h-full items-center px-3 text-[#6e7681]">store.jsx</span>
                </div>

                <div className="grid min-h-0 flex-1 grid-cols-[24px_minmax(0,1fr)] overflow-hidden px-2 py-3 leading-[18px] text-[#c9d1d9]">
                  <div className="select-none text-right text-[#484f58]">
                    1<br />2<br />3<br />4<br />5<br />6<br />7<br />8<br />9<br />10
                  </div>
                  <div className="overflow-hidden whitespace-nowrap pl-3">
                    <div><span className="text-[#ff7b72]">import</span> {"{ useStore }"} <span className="text-[#ff7b72]">from</span> <span className="text-[#a5d6ff]">&quot;./store&quot;</span></div>
                    <div>&nbsp;</div>
                    <div><span className="text-[#ff7b72]">export default function</span> <span className="text-[#d2a8ff]">App</span>() {"{"}</div>
                    <div>&nbsp;&nbsp;<span className="text-[#ff7b72]">const</span> {"{ items, total }"} = <span className="text-[#d2a8ff]">useStore</span>()</div>
                    <div>&nbsp;&nbsp;<span className="text-[#ff7b72]">return</span> (</div>
                    <div>&nbsp;&nbsp;&nbsp;&nbsp;<span className="text-[#7ee787]">&lt;main</span> <span className="text-[#79c0ff]">className</span>=<span className="text-[#a5d6ff]">&quot;pos&quot;</span><span className="text-[#7ee787]">&gt;</span></div>
                    <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span className="text-[#7ee787]">&lt;Menu</span> <span className="text-[#79c0ff]">items</span>={"{items}"} <span className="text-[#7ee787]">/&gt;</span></div>
                    <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span className="text-[#7ee787]">&lt;Bill</span> <span className="text-[#79c0ff]">total</span>={"{total}"} <span className="text-[#7ee787]">/&gt;</span></div>
                    <div>&nbsp;&nbsp;&nbsp;&nbsp;<span className="text-[#7ee787]">&lt;/main&gt;</span></div>
                    <div>&nbsp;&nbsp;)</div>
                  </div>
                </div>

                <div className="shrink-0 border-t border-[#262626] bg-[#0a0a0a] px-3 py-2 leading-[17px]">
                  <div className="mb-1 flex items-center gap-1.5 text-[9px] font-semibold tracking-[0.1em] text-[#aeb8c2]">
                    <TerminalSquare size={11} /> TERMINAL
                  </div>
                  <div className="text-[#c9d1d9]"><span className="text-[#6e7681]">❯</span> npm run dev</div>
                  <div className="text-[#8b949e]">VITE ready in 812 ms</div>
                  <div className="truncate text-[#3fb950]">➜ Local: http://localhost:5173/</div>
                </div>
              </div>

              {/* AI agent */}
              <aside className="hidden w-[176px] shrink-0 flex-col border-l border-[#262626] bg-[#0a0a0a] md:flex">
                <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-[#262626] px-3 text-[9px] font-semibold tracking-[0.12em] text-[#c9d1d9]">
                  <Sparkles size={11} className="text-[#a371f7]" /> CODECLIK AI
                </div>
                <div className="flex-1 space-y-2.5 overflow-hidden p-2.5 text-[10px] leading-[15px]">
                  <div className="rounded-md border border-[#262626] bg-[#121212] px-2 py-1.5 text-[#e6edf3]">
                    Build a restaurant billing app
                  </div>
                  <div className="rounded-md border border-[#262626] bg-[#0d0d0d]">
                    <div className="border-b border-[#1f1f1f] px-2 py-1 text-[#8b949e]">
                      ▾ Worked for 42s <span className="text-[#6e7681]">· 4 steps</span>
                    </div>
                    <div className="space-y-0.5 px-2 py-1.5 font-mono text-[9px] text-[#8b949e]">
                      {["Writing package.json", "Writing src/App.jsx", "Running npm install", "Starting dev server"].map((step) => (
                        <div key={step} className="flex items-center gap-1.5 truncate">
                          <Check size={9} className="shrink-0 text-[#3fb950]" />
                          {step}
                        </div>
                      ))}
                    </div>
                  </div>
                  <p className="text-[#c9d1d9]">
                    Your billing app is ready — menu, cart, tax and split bill. It&apos;s running in the preview.
                  </p>
                </div>
                <div className="m-2.5 mt-0 rounded-md border border-[#262626] bg-[#000000] px-2 py-1.5 text-[10px] text-[#6e7681]">
                  Ask CodeClik AI…
                </div>
              </aside>
            </div>

            <div className="flex h-6 items-center justify-between bg-[#f5f5f5] px-3 font-mono text-[9px] text-black">
              <span className="flex items-center gap-1">
                <GitBranch size={10} /> main · 3 changes
              </span>
              <span className="hidden sm:inline">JavaScript React · UTF-8 · Ln 4, Col 18</span>
            </div>
          </div>
        </div>
      </section>

    </main>
  );
}

