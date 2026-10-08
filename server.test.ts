import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin, { chooseFallbackPokemonNumber, rarityForEncounterChance, rarityForPokemon } from "./server";
import { starterEvolutionChains, starters } from "./pokemon";
import { generationForPokemon } from "./lib/pokemon/generation";

afterEach(() => vi.unstubAllGlobals());

describe("Pokemon Catcher server", () => {
	it("preserves National Pokedex fallback selection and encounter rarity thresholds", () => {
		const numbers = Array.from({ length: 256 }, (_, index) => chooseFallbackPokemonNumber(`milestone-${index}`));
		expect(Math.max(...numbers)).toBeGreaterThan(900);
		expect(numbers.every((number) => number >= 1 && number <= 1025)).toBe(true);
		expect([rarityForEncounterChance(30), rarityForEncounterChance(15), rarityForEncounterChance(5)]).toEqual([
			"common", "uncommon", "rare",
		]);
	});

	it("classifies starter evolution families independently from encounter rarity", () => {
		const familyNumbers = [
			...starters.map((starter) => starter.number),
			...Object.values(starterEvolutionChains).flatMap((chain) => chain.map((evolution) => evolution.number)),
		];
		expect(familyNumbers).toHaveLength(81);
		expect(familyNumbers.every((number) => rarityForPokemon(number, 100, false, false) === "rare")).toBe(true);
		expect(rarityForPokemon(25, 100, false, false)).toBe("common");
		expect(rarityForPokemon(25, 5, false, false)).toBe("rare");
		expect(rarityForPokemon(144, null, true, false)).toBe("legendary");
	});

	it("persists fetched National Pokedex identity and encounter metadata", async () => {
		vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			if (url.endsWith("/encounters")) return { ok: true, json: async () => [{
				location_area: { name: "test-grove-area" },
				version_details: [{ version: { name: "platinum" }, encounter_details: [{ chance: 15, min_level: 8, max_level: 10, method: { name: "walk" } }] }],
			}] };
			if (url.includes("pokemon-species")) return { ok: true, json: async () => ({ hatch_counter: 20, is_legendary: false, is_mythical: false, flavor_text_entries: [] }) };
			return { ok: true, json: async () => ({ name: "testmon", height: 12, weight: 34, types: [{ type: { name: "grass" } }], cries: { latest: "https://example.invalid/testmon.ogg" } }) };
		}));
		const { bb, harness } = createFakePluginHost({ pluginId: "pokemon-catcher", hasHostEntry: true, agentSkillIds: ["pokemon-catcher"] });
		await plugin(bb);
		await harness.behavior.callAgentTool("pokemon_record_milestone", {
			milestone: "commit_created", source: "git", reference: "national-dex", title: "National encounter",
		});
		const result = await harness.behavior.callRpc("collection_get", null) as { captures: Array<Record<string, unknown>> };
		expect(result.captures[0]).toMatchObject({
			pokemonId: "testmon", pokemonName: "Testmon", rarity: "uncommon",
			cryUrl: "https://example.invalid/testmon.ogg",
			encounterLocation: "Test Grove", encounterVersion: "Platinum", encounterMethod: "Walk",
		});
		expect(result.captures[0]?.generation).toBe(generationForPokemon(Number(result.captures[0]?.pokemonNumber)));
		await harness.lifecycle.dispose();
	});

	it("restores demo rewards, token progression, egg incubation, evolution, and reset", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
		let totalTokens = 10_000;
		let lastTokens = 10_000;
		const { bb, harness } = createFakePluginHost({
			pluginId: "pokemon-catcher",
			hasHostEntry: true,
			agentSkillIds: ["pokemon-catcher"],
			sdk: {
				threads: {
					events: {
						list: async () => [{
							id: "evt_tokens",
							threadId: "thr_tokens",
							seq: 1,
							createdAt: 1,
							scope: { kind: "thread" as const },
							type: "thread/tokenUsage/updated" as const,
							data: {
								tokenUsage: {
									last: { cachedInputTokens: 0, inputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: lastTokens },
									total: { cachedInputTokens: 0, inputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens },
									modelContextWindow: null,
								},
							},
						}],
					},
				},
			},
		});
		await plugin(bb);
		await harness.behavior.callRpc("starter_select", { starterId: "fennekin" });
		const starterCollection = await harness.behavior.callRpc("collection_get", null) as { captures: Array<{ pokemonId: string; rarity: string; isEgg: boolean }> };
		expect(starterCollection.captures.find((capture) => capture.pokemonId === "fennekin")).toMatchObject({ rarity: "rare", isEgg: false });
		await harness.behavior.callRpc("demo_reward_add", { kind: "egg" });
		await harness.behavior.callRpc("demo_reward_add", { kind: "shiny" });

		await harness.behavior.emitThreadEvent("experimental_thread.events", {
			thread: makeThreadResponse({ id: "thr_tokens" }),
			sequence: 1,
		});
		await vi.waitFor(async () => {
			const next = await harness.behavior.callRpc("collection_get", null) as { companion: { totalTokens: number }; captures: Array<{ isEgg: boolean; eggSteps: number; isShiny: boolean }> };
			expect(next.companion.totalTokens).toBe(10_000);
			expect(next.captures.find((capture) => capture.isEgg)?.eggSteps).toBe(4);
			expect(next.captures.some((capture) => capture.isShiny)).toBe(true);
		});

		const evolutionTokens = (16 ** 3 - 5 ** 3) * 5_000;
		lastTokens = evolutionTokens;
		totalTokens += evolutionTokens;
		await harness.behavior.emitThreadEvent("experimental_thread.events", {
			thread: makeThreadResponse({ id: "thr_tokens" }),
			sequence: 2,
		});
		await vi.waitFor(async () => {
			const next = await harness.behavior.callRpc("collection_get", null) as { companion: { pokemonName: string; level: number }; captures: Array<{ id: string; pokemonId: string; milestone: string; description: string; isEgg: boolean }> };
			expect(next.companion).toMatchObject({ pokemonName: "Braixen", level: 16 });
			expect(next.captures.find((capture) => capture.pokemonId === "braixen")).toMatchObject({
				milestone: "companion_evolved",
				description: "Evolved from Fennekin through the power of agentic coding!",
				isEgg: false,
			});
		});
		expect(harness.inspection.realtimeSignals.findLast((signal) => signal.channel === "collection-changed" && (signal.payload as { reason?: string }).reason === "companion_evolved")?.payload).toMatchObject({
			reason: "companion_evolved",
			evolutions: [{ fromName: "Fennekin", toName: "Braixen", toNumber: 654 }],
		});
		expect(harness.inspection.realtimeSignals.findLast((signal) => signal.channel === "collection-changed" && (signal.payload as { reason?: string }).reason === "egg_hatched")?.payload).toMatchObject({
			reason: "egg_hatched",
			hatches: [{
				captureId: expect.any(String),
				pokemonName: expect.any(String),
				pokemonNumber: expect.any(Number),
				spriteUrl: expect.any(String),
				isShiny: false,
			}],
		});
		const { harness: reloadedHarness } = await harness.lifecycle.reload(plugin);
		const afterReload = await reloadedHarness.behavior.callRpc("collection_get", null) as { captures: Array<{ pokemonId: string; isEgg: boolean; eggStepsRequired: number }> };
		expect(afterReload.captures.find((capture) => capture.pokemonId === "braixen")).toMatchObject({ isEgg: false, eggStepsRequired: 0 });

		const beforeSwap = await reloadedHarness.behavior.callRpc("collection_get", null) as { captures: Array<{ id: string; pokemonId: string }> };
		const ponyta = beforeSwap.captures.find((capture) => capture.pokemonId === "ponyta")!;
		const swapped = await reloadedHarness.behavior.callRpc("companion_select", { captureId: ponyta.id }) as { companion: { pokemonName: string; totalTokens: number } };
		expect(swapped.companion).toMatchObject({ pokemonName: "Ponyta", totalTokens: 0 });
		lastTokens = 5_000;
		totalTokens += lastTokens;
		await reloadedHarness.behavior.emitThreadEvent("experimental_thread.events", {
			thread: makeThreadResponse({ id: "thr_tokens" }),
			sequence: 3,
		});
		await vi.waitFor(async () => {
			const next = await reloadedHarness.behavior.callRpc("collection_get", null) as { companion: { pokemonName: string; totalTokens: number } };
			expect(next.companion).toMatchObject({ pokemonName: "Ponyta", totalTokens: 5_000 });
		});

		const reset = await reloadedHarness.behavior.callRpc("collection_reset", null) as { starter: string | null; captures: unknown[]; companion: unknown };
		expect(reset).toMatchObject({ starter: null, captures: [], companion: null });
		await reloadedHarness.lifecycle.dispose();
	});

	it("records concurrent reports of one milestone only once", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
		const { bb, harness } = createFakePluginHost({
			pluginId: "pokemon-catcher",
			hasHostEntry: true,
			agentSkillIds: ["pokemon-catcher"],
		});
		await plugin(bb);
		const milestone = {
			milestone: "commit_created" as const,
			source: "Git",
			reference: "abc123",
			title: "Concurrent milestone",
		};

		await Promise.all([
			harness.behavior.callAgentTool("pokemon_record_milestone", milestone),
			harness.behavior.callAgentTool("pokemon_record_milestone", milestone),
		]);

		expect((await harness.behavior.callRpc("collection_get", null) as { totalCaptures: number }).totalCaptures).toBe(1);
		await harness.lifecycle.dispose();
	});

	it("baselines Git state, then rewards a newly detected terminal branch once", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
		let scan = 0;
		const { bb, harness } = createFakePluginHost({
			pluginId: "pokemon-catcher",
			hasHostEntry: true,
			agentSkillIds: ["pokemon-catcher"],
			sdk: {
				projects: {
					list: async () => [{
						id: "proj_1", kind: "standard", name: "Repo", gitRemoteUrl: null,
						createdAt: 1, updatedAt: 1,
						sources: [{ id: "src_1", projectId: "proj_1", hostId: "host_1", type: "local_path", path: "/repo", isDefault: true, createdAt: 1, updatedAt: 1 }],
					}],
				},
				environments: { list: async () => [] },
			},
			experimental_callHostRpc: async () => ({
				repositories: [{
					root: "/repo", repoId: "/repo/.git",
					branches: scan++ === 0 ? ["main"] : ["feature/from-terminal", "main"],
					worktrees: [{ path: "/repo", branch: "main" }],
				}],
			}),
		});
		await plugin(bb);

		await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "thr_1" }) });
		await vi.waitFor(() => expect(scan).toBe(1));
		expect((await harness.behavior.callRpc("collection_get", null) as { totalCaptures: number }).totalCaptures).toBe(0);

		await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "thr_1" }) });
		await vi.waitFor(async () => expect((await harness.behavior.callRpc("collection_get", null) as { totalCaptures: number }).totalCaptures).toBe(1));

		await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "thr_1" }) });
		await vi.waitFor(() => expect(scan).toBe(3));
		expect((await harness.behavior.callRpc("collection_get", null) as { totalCaptures: number }).totalCaptures).toBe(1);
		await harness.lifecycle.dispose();
	});

	it("rewards a branch and its subsequently created worktree only once", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
		let scan = 0;
		const { bb, harness } = createFakePluginHost({
			pluginId: "pokemon-catcher",
			hasHostEntry: true,
			agentSkillIds: ["pokemon-catcher"],
			sdk: {
				projects: {
					list: async () => [{
						id: "proj_1", kind: "standard", name: "Repo", gitRemoteUrl: null,
						createdAt: 1, updatedAt: 1,
						sources: [{ id: "src_1", projectId: "proj_1", hostId: "host_1", type: "local_path", path: "/repo", isDefault: true, createdAt: 1, updatedAt: 1 }],
					}],
				},
				environments: { list: async () => [] },
			},
			experimental_callHostRpc: async () => {
				const currentScan = scan++;
				return {
					repositories: [{
						root: "/repo", repoId: "/repo/.git",
						branches: currentScan === 0 ? ["main"] : ["feature/bb-worktree", "main"],
						worktrees: currentScan < 2
							? [{ path: "/repo", branch: "main" }]
							: [{ path: "/repo", branch: "main" }, { path: "/worktree", branch: "feature/bb-worktree" }],
					}],
				};
			},
		});
		await plugin(bb);

		for (let expectedScan = 1; expectedScan <= 3; expectedScan += 1) {
			await harness.behavior.emitThreadEvent("thread.active", { thread: makeThreadResponse({ id: "thr_1" }) });
			await vi.waitFor(() => expect(scan).toBe(expectedScan));
		}

		expect((await harness.behavior.callRpc("collection_get", null) as { totalCaptures: number }).totalCaptures).toBe(1);
		await harness.lifecycle.dispose();
	});

	it("verifies GitHub credentials, persists repository selection, and baselines remote events", async () => {
		let eventBatch = 0;
		let eventRequests = 0;
		vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			if (url === "https://api.github.com/user") return { ok: true, json: async () => ({ login: "misty" }) };
			if (url.includes("/user/repos")) return { ok: true, json: async () => [{ full_name: "acme/pokedex", html_url: "https://github.com/acme/pokedex", private: false }] };
			if (url.includes("/repos/acme/pokedex/events")) {
				eventRequests += 1;
				return { ok: true, json: async () => eventBatch === 0
					? [{ id: "100", type: "WatchEvent", payload: {} }]
					: [
						{ id: "101", type: "PushEvent", payload: { commits: [{ sha: "abc123", message: "Complete the Pokedex" }] } },
						{ id: "100", type: "WatchEvent", payload: {} },
					] };
			}
			return { ok: false, status: 404, json: async () => ({}) };
		}));
		const { bb, harness } = createFakePluginHost({
			pluginId: "pokemon-catcher",
			hasHostEntry: true,
			agentSkillIds: ["pokemon-catcher"],
			settings: { githubToken: "secret-token" },
		});
		await plugin(bb);
		expect(harness.inspection.registrations.settingsDescriptors.githubToken).toMatchObject({ secret: true });
		const initial = await harness.behavior.callRpc("settings_get", null) as { repositories: Array<{ fullName: string }>; connections: { github: { account: string } } };
		expect(initial).toMatchObject({ repositories: [{ fullName: "acme/pokedex" }], connections: { github: { account: "misty" } } });
		await harness.behavior.callRpc("settings_update", { watchedRepositories: ["acme/pokedex"], projectManagementTool: "github_issues", showEvolutionAnimations: false, bounceCompanionWhileRunning: false });
		expect(await harness.behavior.callRpc("preferences_get", null)).toEqual({ showEvolutionAnimations: false, bounceCompanionWhileRunning: false });

		const baseline = harness.behavior.runService("github-milestone-detector");
		await vi.waitFor(() => expect(eventRequests).toBe(1));
		baseline.controller.abort();
		await baseline.done;
		expect((await harness.behavior.callRpc("collection_get", null) as { totalCaptures: number }).totalCaptures).toBe(0);

		eventBatch = 1;
		const update = harness.behavior.runService("github-milestone-detector");
		await vi.waitFor(async () => expect((await harness.behavior.callRpc("collection_get", null) as { totalCaptures: number }).totalCaptures).toBe(1));
		update.controller.abort();
		await update.done;
		const collection = await harness.behavior.callRpc("collection_get", null) as { captures: Array<{ milestone: string; reference: string; title: string }> };
		expect(collection.captures[0]).toMatchObject({ milestone: "commit_created", reference: "abc123", title: "Complete the Pokedex" });
		await harness.lifecycle.dispose();
	});
});
