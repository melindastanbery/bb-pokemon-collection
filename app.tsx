import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { PokemonSettings, rpcContract } from "./server";
import { starters } from "./pokemon";
import { Button } from "@/components/ui/button";
import { CaptureCard } from "./components/pokemon/capture-card";
import { EvolutionSprite, FloatingCompanion, ThreadCompanion } from "./components/pokemon/companions";
import { EvolutionExperience, previewPokemonExperience } from "./components/pokemon/evolution-experience";
import { CollectionFilterControls, defaultCollectionFilters, filterCaptures } from "./components/pokemon/collection-filters";
import { CollectionPagination, paginateCaptures } from "./components/pokemon/collection-pagination";
import { Modal } from "./components/pokemon/modal";
import { PokeballIcon } from "./components/pokemon/pokeball-icon";
import { StarterSetup } from "./components/pokemon/starter-setup";
import { useCollection } from "./hooks/use-collection";
import { shinySpriteUrl, spriteUrl } from "./lib/pokemon/media";
import "./app.css";

const milestoneLabels = {
  branch_opened: "Open a branch",
  commit_created: "Create a commit",
  pr_closed: "Close a pull request",
  ticket_completed: "Complete a ticket",
} as const;

type ConnectionName = "github" | "shortcut" | "jira";

function ConnectionBadge({ connection }: { connection: PokemonSettings["connections"][ConnectionName] }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${connection.authenticated ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border bg-muted text-muted-foreground"}`}>
      <span className={`size-1.5 rounded-full ${connection.authenticated ? "bg-emerald-500" : "bg-muted-foreground"}`} />
      {connection.authenticated ? "Authenticated" : "Not authenticated"}
    </span>
  );
}

function SettingsPage() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [settings, setSettings] = useState<PokemonSettings | null>(null);
  const [watchedRepositories, setWatchedRepositories] = useState<string[]>([]);
  const [projectManagementTool, setProjectManagementTool] = useState<PokemonSettings["projectManagementTool"]>("shortcut");
  const [showEvolutionAnimations, setShowEvolutionAnimations] = useState(true);
  const [bounceCompanionWhileRunning, setBounceCompanionWhileRunning] = useState(true);
  const [githubToken, setGithubToken] = useState("");
  const [shortcutToken, setShortcutToken] = useState("");
  const [jiraToken, setJiraToken] = useState("");
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const acceptSettings = useCallback((next: PokemonSettings) => {
    setSettings(next);
    setWatchedRepositories(next.watchedRepositories);
    setProjectManagementTool(next.projectManagementTool);
    setShowEvolutionAnimations(next.showEvolutionAnimations);
    setBounceCompanionWhileRunning(next.bounceCompanionWhileRunning);
    setJiraBaseUrl(next.jiraBaseUrl);
    setJiraEmail(next.jiraEmail);
    setError(null);
  }, []);

  useEffect(() => {
    rpc.call("settings_get").then(acceptSettings, (cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [acceptSettings, rpc]);

  const connect = async (service: ConnectionName) => {
    setPending(service);
    setSaved(false);
    try {
      const next = service === "github"
        ? await rpc.call("connection_save", { service, token: githubToken })
        : service === "shortcut"
          ? await rpc.call("connection_save", { service, token: shortcutToken })
          : await rpc.call("connection_save", { service, token: jiraToken, baseUrl: jiraBaseUrl, email: jiraEmail });
      acceptSettings(next);
      if (service === "github") setGithubToken("");
      else if (service === "shortcut") setShortcutToken("");
      else setJiraToken("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  };

  const disconnect = async (service: ConnectionName) => {
    setPending(service);
    setSaved(false);
    try {
      acceptSettings(await rpc.call("connection_disconnect", { service }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  };

  const save = async () => {
    setPending("settings");
    setSaved(false);
    try {
      acceptSettings(await rpc.call("settings_update", { watchedRepositories, projectManagementTool, showEvolutionAnimations, bounceCompanionWhileRunning }));
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  };

  if (settings === null) return <div className="p-5 text-sm text-muted-foreground">Loading settings...</div>;
  const inputClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-5 p-4 md:p-5">
        <div className="flex items-start justify-between gap-4">
          <div><h2 className="text-xl font-semibold">Pokemon Collection settings</h2><p className="mt-1 text-sm text-muted-foreground">Choose where engineering milestones come from.</p></div>
          <Button variant="outline" size="sm" onClick={() => navigate.toPluginPanel("collection")}>Back to collection</Button>
        </div>

        {error === null ? null : <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold">Pokemon experiences</h3>
          <p className="mt-1 text-sm text-muted-foreground">Choose whether evolutions, Egg hatches, and your companion animate on screen.</p>
          <label className="mt-4 flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 p-3">
            <span><strong className="block text-sm">Show evolution and hatching animations</strong><span className="mt-0.5 block text-xs text-muted-foreground">You can still skip any animation with Escape, the close button, or Skip.</span></span>
            <input aria-label="Show evolution and hatching animations" type="checkbox" className="size-4 accent-primary" checked={showEvolutionAnimations} onChange={(event) => setShowEvolutionAnimations(event.target.checked)} />
          </label>
          <label className="mt-3 flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 p-3">
            <span><strong className="block text-sm">Bounce companion while agents run</strong><span className="mt-0.5 block text-xs text-muted-foreground">When off, your companion stays in place. Its animated sprite still plays.</span></span>
            <input aria-label="Bounce companion while agents run" type="checkbox" className="size-4 accent-primary" checked={bounceCompanionWhileRunning} onChange={(event) => setBounceCompanionWhileRunning(event.target.checked)} />
          </label>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h3 className="font-semibold">GitHub repositories</h3><p className="mt-1 text-sm text-muted-foreground">Connect GitHub, then choose repositories from the dropdown.</p></div>
            <ConnectionBadge connection={settings.connections.github} />
          </div>
          {settings.connections.github.authenticated ? (
            <div className="mt-4 flex justify-end"><Button variant="outline" size="sm" disabled={pending === "github"} onClick={() => void disconnect("github")}>Disconnect GitHub</Button></div>
          ) : (
            <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4">
              <h4 className="text-sm font-semibold">Create a fine-grained personal access token</h4>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-5 text-muted-foreground">
                <li>Under <strong className="text-foreground">Repository access</strong>, choose only the repositories Pokemon Collection may watch.</li>
                <li>Under <strong className="text-foreground">Repository permissions</strong>, confirm <strong className="text-foreground">Metadata: Read-only</strong>. GitHub may enable it automatically.</li>
                <li>No Contents, Issues, Pull requests, or write permissions are needed.</li>
              </ol>
              <Button className="mt-2 h-auto px-0 py-1" variant="link" size="sm" onClick={() => navigate.openUrl("https://github.com/settings/personal-access-tokens/new")}>Create token on GitHub</Button>
              <div className="mt-3 flex gap-2"><input aria-label="GitHub fine-grained personal access token" type="password" autoComplete="off" className={inputClass} value={githubToken} onChange={(event) => setGithubToken(event.target.value)} placeholder="github_pat_..." /><Button disabled={githubToken.trim() === "" || pending === "github"} onClick={() => void connect("github")}>{pending === "github" ? "Checking..." : "Connect"}</Button></div>
              <p className="mt-2 text-xs text-muted-foreground">Organization-owned repositories may require an administrator to approve the token.</p>
            </div>
          )}
          {settings.connections.github.error === null ? null : <p className="mt-2 text-xs text-destructive">{settings.connections.github.error}</p>}
          <div className="mt-5 border-t border-border pt-4">
            <h4 className="text-sm font-semibold">Repositories to watch</h4>
            {settings.connections.github.authenticated && settings.repositories.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No repositories are available to this token.</p> : null}
            {!settings.connections.github.authenticated ? <p className="mt-2 text-sm text-muted-foreground">Connect GitHub to choose repositories.</p> : (
              <details className="group relative mt-3">
                <summary className="flex h-10 cursor-pointer list-none items-center justify-between rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                  <span>{watchedRepositories.length === 0 ? "Select repositories" : `${watchedRepositories.length} ${watchedRepositories.length === 1 ? "repository" : "repositories"} selected`}</span>
                  <svg viewBox="0 0 24 24" className="size-4 text-muted-foreground transition group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                </summary>
                <div className="absolute left-0 right-0 z-20 mt-1 rounded-lg border border-border bg-popover p-2 shadow-xl">
                  <div className="mb-2 flex items-center justify-between border-b border-border px-1 pb-2">
                    <span className="text-xs text-muted-foreground">Choose up to 100 repositories</span>
                    <div className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => setWatchedRepositories(settings.repositories.slice(0, 100).map((repository) => repository.fullName))}>Select all</Button><Button variant="ghost" size="sm" onClick={() => setWatchedRepositories([])}>Clear</Button></div>
                  </div>
                  <div className="grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2">
                    {settings.repositories.map((repository) => (
                      <label key={repository.fullName} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-accent">
                        <input type="checkbox" checked={watchedRepositories.includes(repository.fullName)} onChange={(event) => setWatchedRepositories((current) => event.target.checked ? [...current, repository.fullName] : current.filter((value) => value !== repository.fullName))} />
                        <span className="min-w-0 flex-1 truncate font-medium">{repository.fullName}</span>
                        {repository.private ? <span className="text-[10px] uppercase text-muted-foreground">Private</span> : null}
                      </label>
                    ))}
                  </div>
                </div>
              </details>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold">Project management</h3>
          <p className="mt-1 text-sm text-muted-foreground">Choose the system that should provide completed-ticket milestones.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {([['shortcut', 'Shortcut'], ['jira', 'Jira'], ['github_issues', 'GitHub Issues']] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={projectManagementTool === value} className={`rounded-lg border p-3 text-left text-sm transition ${projectManagementTool === value ? "border-primary bg-primary/10" : "border-border hover:bg-accent"}`} onClick={() => setProjectManagementTool(value)}>
                <strong className="block">{label}</strong>
                <span className="mt-1 block text-xs text-muted-foreground">{settings.connections[value === "github_issues" ? "github" : value].authenticated ? "Authenticated" : "Not authenticated"}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Shortcut connection</h3><p className="mt-1 text-sm text-muted-foreground">Use an API token from Shortcut settings.</p></div><ConnectionBadge connection={settings.connections.shortcut} /></div>
          {settings.connections.shortcut.authenticated ? <div className="mt-4 flex justify-end"><Button variant="outline" size="sm" disabled={pending === "shortcut"} onClick={() => void disconnect("shortcut")}>Disconnect Shortcut</Button></div> : <div className="mt-4 flex gap-2"><input aria-label="Shortcut API token" type="password" autoComplete="off" className={inputClass} value={shortcutToken} onChange={(event) => setShortcutToken(event.target.value)} /><Button disabled={shortcutToken.trim() === "" || pending === "shortcut"} onClick={() => void connect("shortcut")}>{pending === "shortcut" ? "Checking..." : "Connect"}</Button></div>}
          {settings.connections.shortcut.error === null ? null : <p className="mt-2 text-xs text-destructive">{settings.connections.shortcut.error}</p>}
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Jira connection</h3><p className="mt-1 text-sm text-muted-foreground">Use your Atlassian site URL, account email, and API token.</p></div><ConnectionBadge connection={settings.connections.jira} /></div>
          {settings.connections.jira.authenticated ? <div className="mt-4 flex justify-end"><Button variant="outline" size="sm" disabled={pending === "jira"} onClick={() => void disconnect("jira")}>Disconnect Jira</Button></div> : <div className="mt-4 grid gap-2 sm:grid-cols-2"><input aria-label="Jira site URL" type="url" className={inputClass} value={jiraBaseUrl} onChange={(event) => setJiraBaseUrl(event.target.value)} placeholder="https://company.atlassian.net" /><input aria-label="Jira account email" type="email" className={inputClass} value={jiraEmail} onChange={(event) => setJiraEmail(event.target.value)} placeholder="you@company.com" /><input aria-label="Jira API token" type="password" autoComplete="off" className={`${inputClass} sm:col-span-2`} value={jiraToken} onChange={(event) => setJiraToken(event.target.value)} /><div className="sm:col-span-2 flex justify-end"><Button disabled={jiraToken.trim() === "" || jiraBaseUrl.trim() === "" || jiraEmail.trim() === "" || pending === "jira"} onClick={() => void connect("jira")}>{pending === "jira" ? "Checking..." : "Connect"}</Button></div></div>}
          {settings.connections.jira.error === null ? null : <p className="mt-2 text-xs text-destructive">{settings.connections.jira.error}</p>}
        </section>

        <div className="flex items-center justify-end gap-3 pb-6">{saved ? <span className="text-sm text-emerald-600 dark:text-emerald-400">Settings saved</span> : null}<Button disabled={pending === "settings"} onClick={() => void save()}>{pending === "settings" ? "Saving..." : "Save settings"}</Button></div>
      </div>
    </div>
  );
}

function CollectionPage() {
  const { collection, error, selectStarter, selectCompanion, resetCollection, addDemoReward } = useCollection();
  const [filters, setFilters] = useState(defaultCollectionFilters);
  const [page, setPage] = useState(1);
  const [starterDismissed, setStarterDismissed] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const [developerOpen, setDeveloperOpen] = useState(false);
  const [demoPending, setDemoPending] = useState<"egg" | "shiny" | null>(null);
  const [lastDemoAdded, setLastDemoAdded] = useState<"egg" | "shiny" | null>(null);
  if (collection === null) {
    return <div className="p-5 text-sm text-muted-foreground">Loading your Pokedex...</div>;
  }
  const starter = starters.find((candidate) => candidate.id === collection.starter);
  const starterCapture = collection.captures.find((capture) => capture.milestone === "starter_selected");
  const companion = collection.companion;
  const levelProgress = companion === null || companion.level === 100 || companion.experienceForNextLevel === 0
    ? 100
    : Math.min(100, companion.experienceIntoLevel / companion.experienceForNextLevel * 100);
  const activeEggs = collection.captures.filter((capture) => capture.isEgg);
  const hatchedEggs = collection.captures.filter((capture) => capture.eggStepsRequired > 0 && !capture.isEgg);
  const caughtPokemon = collection.captures.filter((capture) => !capture.isEgg);
  const visibleCaptures = filterCaptures(caughtPokemon, filters);
  const paginatedCaptures = paginateCaptures(visibleCaptures, page);
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-5 md:px-6">
        <section className="pokemon-hero relative overflow-hidden rounded-xl border border-border bg-card p-5 md:p-7">
          <div className="relative z-10 flex items-center gap-5">
            {starter === undefined ? <div className="pokemon-ball size-16" /> : (
              <div className="relative flex size-24 shrink-0 items-center justify-center">
                <div className="absolute inset-2 rounded-full border border-dashed border-border bg-background/60" />
                {companion === null ? <img src={starterCapture?.spriteUrl ?? spriteUrl(starter.number)} alt={starter.name} className="relative size-24 object-contain [image-rendering:pixelated]" /> : (
                  <EvolutionSprite captureId={companion.captureId} pokemonName={companion.pokemonName} pokemonNumber={companion.pokemonNumber} spriteUrl={companion.spriteUrl} className="relative size-24" showMessage />
                )}
              </div>
            )}
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Trainer log</p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Ship code. Catch Pokemon.</h2>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                Open a branch, commit working code, close a PR, or complete a ticket. Your agent records the verified milestone and rewards it with a catch.
              </p>
              {companion === null ? null : (
                <div className="mt-4 max-w-md">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <strong className="text-foreground">{companion.pokemonName} · Lv. {companion.level}</strong>
                    <span className="text-muted-foreground">
                      {companion.level === 100 ? "Max level" : `${companion.experienceIntoLevel.toLocaleString()} / ${companion.experienceForNextLevel.toLocaleString()} EXP`}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${companion.pokemonName} level progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(levelProgress)}>
                    <div className="pokemon-exp-bar h-full rounded-full" style={{ width: `${levelProgress}%` }} />
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {companion.nextEvolution === null ? `${companion.tokensPerExperience} tokens = 1 EXP` : `Evolves into ${companion.nextEvolution.name}: ${companion.nextEvolution.method} · ${companion.tokensPerExperience} tokens = 1 EXP`}
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        {error === null ? null : <p className="mt-4 text-sm text-destructive">{error}</p>}

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-4"><strong className="block text-2xl">{collection.totalCaptures}</strong><span className="text-xs text-muted-foreground">Total catches</span></div>
          <div className="rounded-lg border border-border bg-card p-4"><strong className="block text-2xl">{collection.uniquePokemon}</strong><span className="text-xs text-muted-foreground">Unique Pokemon</span></div>
          <div className="rounded-lg border border-border bg-card p-4"><strong className="block text-2xl">{collection.shinyCaptures} ✨</strong><span className="text-xs text-muted-foreground">Shiny catches</span></div>
        </div>

        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setDeveloperOpen(true)}>
            Developer tools
          </Button>
          <Button variant="outline" size="sm" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setResetOpen(true)}>
            Reset collection
          </Button>
        </div>

        {resetOpen ? <Modal onClose={() => setResetOpen(false)}>
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold">Reset your Pokemon collection?</h2>
              <p className="text-sm text-muted-foreground">
                This permanently removes your starter, every catch and shiny, all EXP, and token progress. You will choose a new starter afterward.
              </p>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="outline" disabled={resetPending} onClick={() => setResetOpen(false)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={resetPending}
                onClick={() => {
                  setResetPending(true);
                  void resetCollection().then((reset) => {
                    if (reset) {
                      setFilters(defaultCollectionFilters);
                      setPage(1);
                      setStarterDismissed(false);
                      setResetOpen(false);
                    }
                  }).finally(() => setResetPending(false));
                }}
              >
                {resetPending ? "Resetting..." : "Reset everything"}
              </Button>
            </div>
        </Modal> : null}

        {developerOpen ? <Modal onClose={() => setDeveloperOpen(false)}>
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold">Developer tools</h2>
              <p className="text-sm text-muted-foreground">
                Populate deterministic demo rewards without recording an engineering milestone. These controls modify only this local collection.
              </p>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col items-center rounded-lg border border-violet-400/40 bg-violet-400/5 p-5 text-center">
                <div className="pokemon-egg pokemon-egg-small" aria-hidden="true" />
                <h3 className="mt-3 font-semibold text-foreground">Mystery Egg</h3>
                <p className="mt-1 flex-1 text-xs leading-5 text-muted-foreground">Adds a rare Egg with real incubation progress to the Incubator.</p>
                <Button
                  className="mt-4 w-full"
                  size="sm"
                  disabled={collection.starter === null || demoPending !== null}
                  onClick={() => {
                    setDemoPending("egg");
                    void addDemoReward("egg").then((added) => {
                      if (added) setLastDemoAdded("egg");
                    }).finally(() => setDemoPending(null));
                  }}
                >
                  {demoPending === "egg" ? "Adding Egg..." : "Add demo Egg"}
                </Button>
              </div>
              <div className="flex flex-col items-center rounded-lg border border-yellow-400/40 bg-yellow-400/5 p-5 text-center">
                <img src={shinySpriteUrl(77)} alt="Shiny Ponyta" className="size-16 object-contain [image-rendering:pixelated]" />
                <h3 className="mt-3 font-semibold text-foreground">Shiny Pokemon</h3>
                <p className="mt-1 flex-1 text-xs leading-5 text-muted-foreground">Adds a shiny Ponyta directly to the caught-Pokemon collection.</p>
                <Button
                  className="mt-4 w-full"
                  size="sm"
                  disabled={collection.starter === null || demoPending !== null}
                  onClick={() => {
                    setDemoPending("shiny");
                    void addDemoReward("shiny").then((added) => {
                      if (added) setLastDemoAdded("shiny");
                    }).finally(() => setDemoPending(null));
                  }}
                >
                  {demoPending === "shiny" ? "Adding Shiny..." : "Add demo Shiny"}
                </Button>
              </div>
            </div>
            {collection.starter === null ? <p className="text-sm text-destructive">Choose a starter before adding demo rewards.</p> : null}
            {lastDemoAdded === null ? null : <p className="text-sm text-muted-foreground">Added a demo {lastDemoAdded === "egg" ? "Egg to the Incubator" : "shiny Ponyta to the Pokédex"}.</p>}
            <div className="mt-5 border-t border-border pt-5">
              <h3 className="font-semibold text-foreground">Animation previews</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Play a sample experience without changing collection progress.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Button variant="outline" onClick={() => { setDeveloperOpen(false); previewPokemonExperience("evolution"); }}>
                  Preview evolution
                </Button>
                <Button variant="outline" onClick={() => { setDeveloperOpen(false); previewPokemonExperience("hatch"); }}>
                  Preview Egg hatch
                </Button>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <Button variant="outline" onClick={() => setDeveloperOpen(false)}>Done</Button>
            </div>
        </Modal> : null}

        <section className="mt-7">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div><p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Field guide</p><h2 className="text-lg font-semibold">Ways to earn a catch</h2></div>
            <code className="hidden text-xs text-muted-foreground sm:block">bb pokemon collection</code>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(milestoneLabels).map(([kind, label]) => (
              <div key={kind} className="flex items-center gap-3 rounded-lg border border-dashed border-border px-3 py-3 text-sm">
                <span className="text-primary" aria-hidden="true">{kind === "branch_opened" ? "⑂" : kind === "pr_closed" ? "✓" : "●"}</span>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-7">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Day care</p>
              <h2 className="text-lg font-semibold">Egg Incubator</h2>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border border-violet-400/40 bg-violet-400/10 px-2.5 py-1"><strong className="text-foreground">{activeEggs.length}</strong> incubating</span>
              <span className="rounded-full border border-border bg-muted px-2.5 py-1"><strong className="text-foreground">{hatchedEggs.length}</strong> hatched</span>
            </div>
          </div>
          {activeEggs.length === 0 ? (
            <div className="mt-3 rounded-lg border border-dashed border-violet-400/40 bg-violet-400/5 p-8 text-center">
              <div className="pokemon-egg pokemon-egg-small mx-auto" aria-hidden="true" />
              <p className="mt-4 text-sm font-medium text-foreground">No Eggs are incubating.</p>
              <p className="mt-1 text-xs text-muted-foreground">Rare encounters appear here as mystery Eggs. Every 2,500 tokens adds one step.</p>
            </div>
          ) : (
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {activeEggs.map((capture) => <CaptureCard key={capture.id} capture={capture} />)}
            </div>
          )}
        </section>

        <section className="mt-7">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Pokedex</p>
              <h2 className="text-lg font-semibold">Caught Pokemon</h2>
            </div>
            <CollectionFilterControls captures={caughtPokemon} filters={filters} onChange={(nextFilters) => {
              setFilters(nextFilters);
              setPage(1);
            }} />
          </div>
          {caughtPokemon.length === 0 ? (
            <div className="mt-3 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Choose a starter to begin your collection.</div>
          ) : visibleCaptures.length === 0 ? (
            <div className="mt-3 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No Pokemon match these filters.</div>
          ) : (
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {paginatedCaptures.captures.map((capture) => <CaptureCard key={capture.id} capture={capture} activeCompanion={capture.id === companion?.captureId} onSelectCompanion={(captureId) => void selectCompanion(captureId)} />)}
            </div>
          )}
          <CollectionPagination page={paginatedCaptures.currentPage} total={visibleCaptures.length} onPageChange={setPage} />
        </section>
      </div>
      {collection.starter === null && !starterDismissed ? <StarterSetup error={error} onClose={() => setStarterDismissed(true)} selectStarter={selectStarter} /> : null}
    </div>
  );
}

function CollectionPanel({ subPath }: { subPath: string }) {
  return subPath === "settings" ? <SettingsPage /> : <CollectionPage />;
}

function CollectionHeaderActions() {
  const navigate = useBbNavigate();
  return (
    <Button variant="ghost" size="icon" aria-label="Pokemon Collection settings" onClick={() => navigate.toPluginPanel("collection", { subPath: "settings" })}>
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.5v-.1A1.7 1.7 0 0 0 8.4 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2V9.5h.3A1.7 1.7 0 0 0 4 8.4a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.46 3.6l.06.06A1.7 1.7 0 0 0 8.4 4a1.7 1.7 0 0 0 1-.6A1.7 1.7 0 0 0 9.8 2.3V2h4.1v.3A1.7 1.7 0 0 0 15 4a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8.4a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.3v4.1h-.3A1.7 1.7 0 0 0 19.4 15Z" />
      </svg>
    </Button>
  );
}

export default definePluginApp((app) => {
  app.experimental_icons.register({ name: "PokemonCatcherPokeball", component: PokeballIcon });
  app.slots.navPanel({
    id: "collection",
    title: "Pokemon collection",
    icon: "PokemonCatcherPokeball",
    path: "collection",
    component: CollectionPanel,
    headerContent: CollectionHeaderActions,
  });
  app.slots.experimental_appOverlay({
    id: "floating-companion",
    component: FloatingCompanion,
  });
  app.slots.experimental_appOverlay({
    id: "evolution-experience",
    component: EvolutionExperience,
  });
  app.slots.experimental_threadHeaderAction({
    id: "companion",
    title: "Pokemon companion",
    component: ThreadCompanion,
  });
});
