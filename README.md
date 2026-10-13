# Pokemon Catcher

A BB plugin that rewards engineering milestones with Pokémon catches.

## Collection experience

The Pokémon collection panel includes all 27 starters from generations 1–9,
random encounters spanning the National Pokédex, an evolving companion,
animated sprites, grouped duplicate counts, encounter details, rarity, type,
and generation badges, shiny/type/rarity/generation filters, paginated Pokedex
entries, and an egg incubator. The companion also appears
in the thread header and as a draggable overlay that becomes more active while
agents are working. The overlay stays where you drop it after a refresh. Turn
off "Bounce companion while agents run" in Pokemon Collection settings to keep
the companion in place; its animated sprite still plays.

Agent usage awards one experience point per 5,000 tokens. Incubating eggs gain
one step per 2,500 tokens. Any caught or hatched Pokémon can become the active
companion and keeps its own experience when swapped out. Level evolutions use
the usual level threshold; item evolutions unlock at 500,000 tokens, other
special evolutions at 750,000 tokens, and trade evolutions at 1,000,000 tokens.
Every evolved form is also recorded as its own Pokédex catch. Developer tools
in the collection panel can add a demo Egg or shiny Pokémon, preview evolution
and Egg-hatch animations without changing progress, and reset the local
collection. Companion evolutions open a skippable, game-inspired animation
with an original synthesized chime. The animation can be disabled in Pokemon
Collection settings.

## Automatic Git detection

The plugin scans repositories registered as BB project sources or active environments every 15 seconds. Existing branches and worktrees are baselined without rewards. New branches and worktrees created in BB or a terminal receive one idempotent reward.

## Settings and integrations

Open the collection panel and use the gear button in its header to configure integrations.

- Connect GitHub with a fine-grained personal access token restricted to the desired repositories and with only `Metadata: Read-only` repository permission, then select up to 100 repositories from the dropdown. No Contents, Issues, Pull requests, or write permission is required. The token is stored as a secret plugin setting and is never returned to the frontend.
- Watched repositories are polled every 60 seconds. The first poll establishes a baseline; later GitHub events reward new branches, pushed commits, closed pull requests, and closed issues when GitHub Issues is the selected project-management tool.
- Select Shortcut, Jira, or GitHub Issues as the project-management tool. Shortcut and Jira tokens are verified and stored as secret plugin settings. Jira also requires the Atlassian site URL and account email.

The GitHub event feed exposes at most the latest 100 events. If the saved cursor falls outside that window, the plugin safely re-baselines instead of awarding old activity.

Local branch and worktree scanning remains limited to repositories known to BB. Remote activity is limited to the GitHub repositories explicitly selected in settings.

## Third-party services and rights

Pokemon Catcher is an unofficial fan project and is not affiliated with,
endorsed by, or sponsored by Nintendo, Game Freak, Creatures Inc., The Pokemon
Company, PokéAPI, Pokémon Showdown, Smogon, or Veekun.

The plugin requests data from [PokéAPI](https://pokeapi.co/) and loads sprites
and cries from the PokéAPI GitHub repositories at runtime. Pokémon names,
characters, images, audio, and related trademarks remain the property of their
respective rights holders. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)
for source and licensing details.

## Commands

```sh
bb pokemon collection --json
bb pokemon starter fennekin
bb pokemon companion <capture-id>
bb pokemon catch commit_created --source git --reference abc123 --title "Save progress"
```

## Development

```sh
npm install --include=dev
npm run typecheck
npm test
bb plugin build
```
