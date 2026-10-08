import { createHash, randomUUID } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { hostContract } from "./host-contract";
import { diffGitSnapshots, type GitRepoSnapshot, type GitSnapshotEvent } from "./git-detector";
import {
	animatedSpriteUrl, cryUrl, milestoneKinds, pokemon, spriteUrl, starterEvolutionChains, starters,
	type MilestoneKind, type StarterId,
} from "./pokemon";
import { generationForPokemon } from "./lib/pokemon/generation";
import { fetchEvolutionPath, fetchPokemonDetails, fetchPokemonEncounter, type EvolutionStage, type PokemonCandidate } from "./api/pokeapi";

const starterIdSchema = z.enum(starters.map((starter) => starter.id));
const milestoneSchema = z.enum(milestoneKinds);
const raritySchema = z.enum(["common", "uncommon", "rare", "legendary"]);
const captureSchema = z.object({
	id: z.string(), pokemonId: z.string(), pokemonName: z.string(), pokemonNumber: z.number().int(),
	generation: z.number().int().min(1).max(9),
	spriteUrl: z.string().nullable(), shinySpriteUrl: z.string().nullable(), animatedSpriteUrl: z.string().nullable(),
	cryUrl: z.string(),
	isShiny: z.boolean(), heightDecimeters: z.number().int(), weightHectograms: z.number().int(),
	types: z.array(z.string()), flavorText: z.string().nullable(), rarity: raritySchema, isEgg: z.boolean(),
	eggSteps: z.number().int(), eggStepsRequired: z.number().int(), hatchedAt: z.string().nullable(),
	encounterLocation: z.string().nullable(), encounterVersion: z.string().nullable(), encounterMethod: z.string().nullable(),
	encounterChance: z.number().int().nullable(), encounterLevel: z.number().int().nullable(), milestone: z.string(),
	source: z.string(), reference: z.string(), title: z.string(), description: z.string(), url: z.string().nullable(), caughtAt: z.string(),
});
const companionSchema = z.object({
	captureId: z.string(), pokemonId: z.string(), pokemonName: z.string(), pokemonNumber: z.number().int(),
	spriteUrl: z.string(), animatedSpriteUrl: z.string().nullable(), level: z.number().int(), experience: z.number().int(),
	experienceIntoLevel: z.number().int(), experienceForNextLevel: z.number().int(), totalTokens: z.number().int(),
	tokensPerExperience: z.number().int(), nextEvolution: z.object({
		name: z.string(), method: z.string(), level: z.number().int().nullable(), tokenTarget: z.number().int().nullable(),
	}).nullable(),
});
const collectionSchema = z.object({
	starter: starterIdSchema.nullable(), companion: companionSchema.nullable(), captures: z.array(captureSchema),
	uniquePokemon: z.number().int(), totalCaptures: z.number().int(), shinyCaptures: z.number().int(),
});

const projectManagementToolSchema = z.enum(["shortcut", "jira", "github_issues"]);
const repositorySchema = z.object({
	fullName: z.string(), htmlUrl: z.string(), private: z.boolean(),
});
const connectionSchema = z.object({
	authenticated: z.boolean(), account: z.string().nullable(), error: z.string().nullable(),
});
const settingsSchema = z.object({
	repositories: z.array(repositorySchema), watchedRepositories: z.array(z.string()),
	projectManagementTool: projectManagementToolSchema,
	connections: z.object({ github: connectionSchema, shortcut: connectionSchema, jira: connectionSchema }),
	jiraBaseUrl: z.string(), jiraEmail: z.string(), showEvolutionAnimations: z.boolean(), bounceCompanionWhileRunning: z.boolean(),
});
const preferencesSchema = settingsSchema.pick({ showEvolutionAnimations: true, bounceCompanionWhileRunning: true });

export type Collection = z.infer<typeof collectionSchema>;
export type Capture = z.infer<typeof captureSchema>;
export type PokemonRarity = z.infer<typeof raritySchema>;
export type PokemonSettings = z.infer<typeof settingsSchema>;
export type PokemonPreferences = z.infer<typeof preferencesSchema>;
export const rpcContract = defineRpcContract({
	collection_get: { input: z.null(), output: collectionSchema },
	collection_reset: { input: z.null(), output: collectionSchema },
	demo_reward_add: { input: z.object({ kind: z.enum(["egg", "shiny"]) }).strict(), output: collectionSchema },
	starter_select: { input: z.object({ starterId: starterIdSchema }), output: collectionSchema },
	companion_select: { input: z.object({ captureId: z.string().uuid() }).strict(), output: collectionSchema },
	settings_get: { input: z.null(), output: settingsSchema },
	preferences_get: { input: z.null(), output: preferencesSchema },
	settings_update: {
		input: z.object({
			watchedRepositories: z.array(z.string().regex(/^[^/\s]+\/[^/\s]+$/u)).max(100),
			projectManagementTool: projectManagementToolSchema,
			showEvolutionAnimations: z.boolean(),
			bounceCompanionWhileRunning: z.boolean(),
		}).strict(),
		output: settingsSchema,
	},
	connection_save: {
		input: z.discriminatedUnion("service", [
			z.object({ service: z.literal("github"), token: z.string().trim().min(1).max(5_000) }).strict(),
			z.object({ service: z.literal("shortcut"), token: z.string().trim().min(1).max(5_000) }).strict(),
			z.object({
				service: z.literal("jira"), token: z.string().trim().min(1).max(5_000),
				baseUrl: z.url().refine((value) => new URL(value).protocol === "https:", "Jira site URL must use HTTPS"), email: z.email(),
			}).strict(),
		]),
		output: settingsSchema,
	},
	connection_disconnect: { input: z.object({ service: z.enum(["github", "shortcut", "jira"]) }).strict(), output: settingsSchema },
});
const recordInputSchema = z.object({
	milestone: milestoneSchema, source: z.string().trim().min(1).max(200), reference: z.string().trim().min(1).max(500),
	title: z.string().trim().min(1).max(500), url: z.url().max(1000).optional(),
});
const COLLECTION_CHANGED = "collection-changed";
const TOKENS_PER_EXPERIENCE = 5000;
const TOKENS_PER_EGG_STEP = 2500;
const STARTER_EXPERIENCE = 5 ** 3;
const NATIONAL_DEX_SIZE = 1025;
type Database = ReturnType<BbPluginApi["storage"]["database"]>;
export function chooseFallbackPokemonNumber(eventKey: string) {
	return createHash("sha256").update(eventKey).digest().readUInt32BE(0) % NATIONAL_DEX_SIZE + 1;
}

export function rarityForEncounterChance(chance: number): "common" | "uncommon" | "rare" {
	if (chance >= 20) return "common";
	if (chance >= 10) return "uncommon";
	return "rare";
}

const starterFamilyNumbers = new Set<number>([
	...starters.map((starter) => starter.number),
	...Object.values(starterEvolutionChains).flatMap((chain) => chain.map((evolution) => evolution.number)),
]);

export function rarityForPokemon(number: number, encounterChance: number | null, isLegendary: boolean, isMythical: boolean): PokemonRarity {
	if (isLegendary || isMythical) return "legendary";
	if (starterFamilyNumbers.has(number)) return "rare";
	return encounterChance === null ? "common" : rarityForEncounterChance(encounterChance);
}

function ensureTables(db: Database) {
	db.exec(`
		CREATE TABLE IF NOT EXISTS pokemon_details (
			pokemon_number INTEGER PRIMARY KEY, pokemon_id TEXT NOT NULL, pokemon_name TEXT NOT NULL,
			artwork_url TEXT, height_decimeters INTEGER NOT NULL, weight_hectograms INTEGER NOT NULL,
			types_json TEXT NOT NULL, flavor_text TEXT, fetched_at TEXT NOT NULL, sprite_url TEXT,
			shiny_sprite_url TEXT, animated_sprite_url TEXT, cry_url TEXT, hatch_counter INTEGER NOT NULL DEFAULT 0,
			is_legendary INTEGER NOT NULL DEFAULT 0, is_mythical INTEGER NOT NULL DEFAULT 0
		);
		CREATE TABLE IF NOT EXISTS captures (
			id TEXT PRIMARY KEY, event_key TEXT, pokemon_id TEXT NOT NULL, pokemon_name TEXT NOT NULL,
			pokemon_number INTEGER NOT NULL, milestone TEXT NOT NULL, source TEXT NOT NULL,
			reference TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, url TEXT,
			thread_id TEXT, project_id TEXT, caught_at TEXT NOT NULL, is_shiny INTEGER NOT NULL DEFAULT 0,
			rarity TEXT NOT NULL DEFAULT 'common', egg_steps INTEGER NOT NULL DEFAULT 0,
			egg_steps_required INTEGER NOT NULL DEFAULT 0, hatched_at TEXT, encounter_location TEXT,
			encounter_version TEXT, encounter_method TEXT, encounter_chance INTEGER, encounter_level INTEGER
		);
		CREATE TABLE IF NOT EXISTS companion_progress (id INTEGER PRIMARY KEY CHECK (id = 1), total_tokens INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE IF NOT EXISTS companion_roster (
			capture_id TEXT PRIMARY KEY, total_tokens INTEGER NOT NULL DEFAULT 0, evolution_path_json TEXT NOT NULL,
			FOREIGN KEY (capture_id) REFERENCES captures(id)
		);
		CREATE TABLE IF NOT EXISTS thread_token_usage (thread_id TEXT PRIMARY KEY, total_tokens INTEGER NOT NULL);
		CREATE TABLE IF NOT EXISTS incubator_state (id INTEGER PRIMARY KEY CHECK (id = 1), token_remainder INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE IF NOT EXISTS git_detector_snapshots (
			host_id TEXT NOT NULL, repo_id TEXT NOT NULL, snapshot_json TEXT NOT NULL,
			updated_at TEXT NOT NULL, PRIMARY KEY (host_id, repo_id)
		);
		CREATE TABLE IF NOT EXISTS github_event_cursors (
			repository TEXT PRIMARY KEY, event_id TEXT NOT NULL, updated_at TEXT NOT NULL
		);
		CREATE UNIQUE INDEX IF NOT EXISTS captures_event_key_unique
			ON captures(event_key) WHERE event_key IS NOT NULL;
	`);
	const detailColumns = db.prepare("PRAGMA table_info(pokemon_details)").all() as Array<{ name: string }>;
	if (!detailColumns.some((column) => column.name === "cry_url")) db.exec("ALTER TABLE pokemon_details ADD COLUMN cry_url TEXT");
	db.exec(`
		UPDATE captures SET
			rarity = 'rare',
			egg_steps_required = CASE
				WHEN milestone IN ('starter_selected', 'companion_evolved') THEN 0
				WHEN hatched_at IS NOT NULL OR egg_steps_required > 0 THEN egg_steps_required
				ELSE 255 * (COALESCE((SELECT hatch_counter FROM pokemon_details WHERE pokemon_number = captures.pokemon_number), 20) + 1)
			END
		WHERE pokemon_number IN (${[...starterFamilyNumbers].join(",")}) AND rarity != 'legendary'
	`);
}

function nullableString(value: unknown) {
	return typeof value === "string" && value !== "" ? value : null;
}

function rowToCapture(row: Record<string, unknown>): Capture {
	const number = Number(row.pokemon_number);
	return {
		id: String(row.id), pokemonId: String(row.pokemon_id), pokemonName: String(row.pokemon_name), pokemonNumber: number,
		generation: generationForPokemon(number),
		spriteUrl: nullableString(row.sprite_url) ?? spriteUrl(number), shinySpriteUrl: nullableString(row.shiny_sprite_url) ?? spriteUrl(number, true),
		animatedSpriteUrl: nullableString(row.animated_sprite_url) ?? animatedSpriteUrl(number), isShiny: Boolean(row.is_shiny),
		cryUrl: nullableString(row.cry_url) ?? cryUrl(number),
		heightDecimeters: Number(row.height_decimeters ?? 0), weightHectograms: Number(row.weight_hectograms ?? 0),
		types: JSON.parse(String(row.types_json ?? "[]")) as string[], flavorText: nullableString(row.flavor_text),
		rarity: raritySchema.catch("common").parse(row.rarity), isEgg: Number(row.egg_steps_required ?? 0) > 0 && row.hatched_at === null,
		eggSteps: Number(row.egg_steps ?? 0), eggStepsRequired: Number(row.egg_steps_required ?? 0), hatchedAt: nullableString(row.hatched_at),
		encounterLocation: nullableString(row.encounter_location), encounterVersion: nullableString(row.encounter_version),
		encounterMethod: nullableString(row.encounter_method), encounterChance: row.encounter_chance === null ? null : Number(row.encounter_chance),
		encounterLevel: row.encounter_level === null ? null : Number(row.encounter_level), milestone: String(row.milestone),
		source: String(row.source), reference: String(row.reference), title: String(row.title), description: String(row.description),
		url: nullableString(row.url), caughtAt: String(row.caught_at),
	};
}

function readCaptures(db: Database) {
	return db.prepare(`
		SELECT c.*, d.sprite_url, d.shiny_sprite_url, d.animated_sprite_url, d.cry_url,
			d.height_decimeters, d.weight_hectograms, d.types_json, d.flavor_text
		FROM captures c LEFT JOIN pokemon_details d ON d.pokemon_number = c.pokemon_number ORDER BY c.caught_at DESC
	`).all().map((row) => rowToCapture(row as Record<string, unknown>));
}

async function ensurePokemonDetails(db: Database, candidate: PokemonCandidate) {
	if (db.prepare("SELECT 1 FROM pokemon_details WHERE pokemon_number = ?").get(candidate.number) !== undefined) return;
	const details = await fetchPokemonDetails(candidate);
	db.prepare(`
		INSERT OR IGNORE INTO pokemon_details (
			pokemon_number, pokemon_id, pokemon_name, artwork_url, height_decimeters, weight_hectograms,
			types_json, flavor_text, fetched_at, sprite_url, shiny_sprite_url, animated_sprite_url, cry_url,
			hatch_counter, is_legendary, is_mythical
		) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run(candidate.number, details.id, details.name, details.height, details.weight, JSON.stringify(details.types),
		details.flavorText, new Date().toISOString(), spriteUrl(candidate.number), spriteUrl(candidate.number, true), animatedSpriteUrl(candidate.number),
		details.cryUrl, details.hatchCounter, details.isLegendary ? 1 : 0, details.isMythical ? 1 : 0);
}

function milestoneDescription(input: z.infer<typeof recordInputSchema>) {
	const action = input.milestone === "branch_opened" ? "opening" : input.milestone === "commit_created" ? "committing" : input.milestone === "pr_closed" ? "closing" : "finishing";
	return `Caught by ${action} ${input.source} ${input.reference} - ${input.title}`;
}

async function recordMilestone(db: Database, bb: BbPluginApi, input: z.infer<typeof recordInputSchema>, eventKey?: string) {
	const key = eventKey ?? createHash("sha256").update(JSON.stringify(input)).digest("hex");
	if (db.prepare("SELECT id FROM captures WHERE event_key = ? LIMIT 1").get(key) !== undefined) {
		return { caught: false as const, message: "This milestone was already rewarded." };
	}
	const number = chooseFallbackPokemonNumber(key);
	const candidate = { id: `pokemon-${number}`, name: `Pokémon #${number}`, number };
	await ensurePokemonDetails(db, candidate);
	const shiny = Math.floor(Math.random() * 4096) === 0;
	const encounter = await fetchPokemonEncounter(number, key);
	const detailRow = db.prepare(`SELECT pokemon_id, pokemon_name, hatch_counter, is_legendary, is_mythical
		FROM pokemon_details WHERE pokemon_number = ?`).get(number) as {
		pokemon_id?: string; pokemon_name?: string; hatch_counter?: number; is_legendary?: number; is_mythical?: number;
	} | undefined;
	const resolved = { id: detailRow?.pokemon_id ?? candidate.id, name: detailRow?.pokemon_name ?? candidate.name, number };
	const rarity = rarityForPokemon(number, encounter?.chance ?? null, detailRow?.is_legendary === 1, detailRow?.is_mythical === 1);
	const isEgg = rarity === "rare";
	const eggStepsRequired = isEgg ? 255 * (Number(detailRow?.hatch_counter ?? 20) + 1) : 0;
	const insertion = db.prepare(`
		INSERT OR IGNORE INTO captures (id, event_key, pokemon_id, pokemon_name, pokemon_number, milestone, source,
			reference, title, description, url, caught_at, is_shiny, rarity, egg_steps, egg_steps_required,
			encounter_location, encounter_version, encounter_method, encounter_chance, encounter_level)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
	`).run(randomUUID(), key, resolved.id, resolved.name, resolved.number, input.milestone, input.source, input.reference,
		input.title, `${isEgg ? "Found" : "Caught"}${milestoneDescription(input).slice("Caught".length)}`, input.url ?? null,
		new Date().toISOString(), shiny ? 1 : 0, rarity, eggStepsRequired, encounter?.location ?? null,
		encounter?.version ?? null, encounter?.method ?? null, encounter?.chance ?? null, encounter?.level ?? null);
	if (insertion.changes === 0) {
		return { caught: false as const, message: "This milestone was already rewarded." };
	}
	bb.realtime.publish(COLLECTION_CHANGED, { reason: input.milestone });
	return { caught: true as const, message: isEgg ? "A mysterious rare Egg appeared!" : `${shiny ? "Shiny " : ""}${resolved.name} was caught!` };
}

function fallbackEvolutionPath(candidate: PokemonCandidate): EvolutionStage[] {
	const starter = starters.find((entry) => entry.number === candidate.number);
	if (starter === undefined) return [{ ...candidate, requirement: null }];
	return [
		{ ...starter, requirement: null },
		...starterEvolutionChains[starter.id].map((entry) => ({ ...entry, requirement: { kind: "level" as const, level: entry.level, method: `Reach level ${entry.level}` } })),
	];
}

function companionState(capture: Capture, totalTokens: number, path: EvolutionStage[]) {
	const experience = Math.min(100 ** 3, Math.floor(totalTokens / TOKENS_PER_EXPERIENCE) + STARTER_EXPERIENCE);
	const level = Math.min(100, Math.max(1, Math.floor(Math.cbrt(experience))));
	let current = path[0] ?? { id: capture.pokemonId, name: capture.pokemonName, number: capture.pokemonNumber, requirement: null };
	let next: { stage: EvolutionStage; tokenTarget: number | null } | null = null;
	let tokenTarget = 0;
	for (const stage of path.slice(1)) {
		const requirement = stage.requirement;
		if (requirement?.kind === "tokens") tokenTarget += requirement.tokens;
		const unlocked = requirement?.kind === "level" ? level >= requirement.level : requirement?.kind === "tokens" ? totalTokens >= tokenTarget : true;
		if (!unlocked) { next = { stage, tokenTarget: requirement?.kind === "tokens" ? tokenTarget : null }; break; }
		current = stage;
	}
	const requirement = next?.stage.requirement ?? null;
	return {
		captureId: capture.id, pokemonId: current.id, pokemonName: current.name, pokemonNumber: current.number,
		spriteUrl: spriteUrl(current.number), animatedSpriteUrl: animatedSpriteUrl(current.number), level, experience,
		experienceIntoLevel: experience - level ** 3, experienceForNextLevel: level === 100 ? 0 : (level + 1) ** 3 - level ** 3,
		totalTokens, tokensPerExperience: TOKENS_PER_EXPERIENCE,
		nextEvolution: next === null || requirement === null ? null : {
			name: next.stage.name, method: requirement.kind === "tokens" ? `${requirement.method} at ${next.tokenTarget?.toLocaleString()} total tokens` : requirement.method,
			level: requirement.kind === "level" ? requirement.level : null,
			tokenTarget: next.tokenTarget,
		},
	};
}

async function ensureCompanionRoster(db: Database, capture: Capture, legacyTokens = 0) {
	const existing = db.prepare("SELECT capture_id FROM companion_roster WHERE capture_id = ?").get(capture.id);
	if (existing !== undefined) return;
	const fetched = await fetchEvolutionPath(capture.pokemonNumber);
	const path = fetched.length === 0 ? fallbackEvolutionPath({ id: capture.pokemonId, name: capture.pokemonName, number: capture.pokemonNumber }) : fetched;
	db.prepare("INSERT OR IGNORE INTO companion_roster (capture_id, total_tokens, evolution_path_json) VALUES (?, ?, ?)")
		.run(capture.id, legacyTokens, JSON.stringify(path));
}

async function activeCompanionCapture(db: Database, bb: BbPluginApi, captures: Capture[]) {
	let captureId = await bb.storage.kv.get<string>("activeCompanionCaptureId");
	let capture = captures.find((entry) => entry.id === captureId && !entry.isEgg) ?? null;
	if (capture === null) {
		capture = captures.find((entry) => entry.milestone === "starter_selected") ?? null;
		if (capture === null) return null;
		captureId = capture.id;
		await bb.storage.kv.set("activeCompanionCaptureId", captureId);
	}
	const legacy = db.prepare("SELECT total_tokens FROM companion_progress WHERE id = 1").get() as { total_tokens?: number } | undefined;
	await ensureCompanionRoster(db, capture, capture.milestone === "starter_selected" ? Number(legacy?.total_tokens ?? 0) : 0);
	const row = db.prepare("SELECT total_tokens, evolution_path_json FROM companion_roster WHERE capture_id = ?").get(capture.id) as { total_tokens: number; evolution_path_json: string };
	return companionState(capture, row.total_tokens, JSON.parse(row.evolution_path_json) as EvolutionStage[]);
}

async function readCollection(db: Database, bb: BbPluginApi): Promise<Collection> {
	const starter = await bb.storage.kv.get<StarterId>("starter") ?? null;
	let captures = readCaptures(db);
	const companion = starter === null ? null : await activeCompanionCapture(db, bb, captures);
	if (companion !== null) {
		await recordReachedEvolutions(db, bb, companion.captureId);
		captures = readCaptures(db);
	}
	return { starter, companion, captures,
		uniquePokemon: new Set(captures.map((capture) => capture.pokemonNumber)).size, totalCaptures: captures.length,
		shinyCaptures: captures.filter((capture) => capture.isShiny).length };
}

async function selectStarter(db: Database, bb: BbPluginApi, starterId: StarterId) {
	const current = await bb.storage.kv.get<StarterId>("starter");
	await bb.storage.kv.set("starter", starterId);
	if (current === undefined) {
		const starter = starters.find((entry) => entry.id === starterId)!;
		await ensurePokemonDetails(db, starter);
		const captureId = randomUUID();
		db.prepare(`
			INSERT INTO captures (id, event_key, pokemon_id, pokemon_name, pokemon_number, milestone, source,
				reference, title, description, url, caught_at, is_shiny, rarity)
			VALUES (?, ?, ?, ?, ?, 'starter_selected', 'Pokemon Catcher', 'starter', ?, ?, NULL, ?, 0, 'rare')
		`).run(captureId, `starter:${starterId}`, starter.id, starter.name, starter.number, `${starter.name} joined your journey`,
			`Chose ${starter.name} as your starter companion`, new Date().toISOString());
		await bb.storage.kv.set("activeCompanionCaptureId", captureId);
		const capture = readCaptures(db).find((entry) => entry.id === captureId)!;
		await ensureCompanionRoster(db, capture);
	}
	bb.realtime.publish(COLLECTION_CHANGED, { reason: "starter_selected" });
	return readCollection(db, bb);
}

async function selectCompanion(db: Database, bb: BbPluginApi, captureId: string) {
	const capture = readCaptures(db).find((entry) => entry.id === captureId);
	if (capture === undefined || capture.isEgg) throw new Error("Choose a caught or hatched Pokemon as your companion.");
	await ensureCompanionRoster(db, capture);
	await bb.storage.kv.set("activeCompanionCaptureId", capture.id);
	bb.realtime.publish(COLLECTION_CHANGED, { reason: "companion_selected" });
	return readCollection(db, bb);
}

async function recordReachedEvolutions(db: Database, bb: BbPluginApi, captureId: string) {
	const captures = readCaptures(db);
	const origin = captures.find((entry) => entry.id === captureId);
	if (origin === undefined) return;
	const row = db.prepare("SELECT total_tokens, evolution_path_json FROM companion_roster WHERE capture_id = ?").get(captureId) as { total_tokens: number; evolution_path_json: string } | undefined;
	if (row === undefined) return;
	const path = JSON.parse(row.evolution_path_json) as EvolutionStage[];
	const state = companionState(origin, row.total_tokens, path);
	const reachedIndex = path.findIndex((entry) => entry.number === state.pokemonNumber);
	const evolutions: Array<{ fromName: string; fromSpriteUrl: string; toName: string; toSpriteUrl: string; toNumber: number }> = [];
	for (let index = 1; index <= reachedIndex; index += 1) {
		const stage = path[index]!;
		const previous = path[index - 1]!;
		await ensurePokemonDetails(db, stage);
		const result = db.prepare(`
			INSERT OR IGNORE INTO captures (id, event_key, pokemon_id, pokemon_name, pokemon_number, milestone, source,
				reference, title, description, url, caught_at, is_shiny, rarity)
			VALUES (?, ?, ?, ?, ?, 'companion_evolved', 'Agentic coding', ?, ?, ?, NULL, ?, ?, ?)
		`).run(randomUUID(), `evolution:${captureId}:${stage.number}`, stage.id, stage.name, stage.number, captureId,
			`${previous.name} evolved into ${stage.name}`, `Evolved from ${previous.name} through the power of agentic coding!`,
			new Date().toISOString(), origin.isShiny ? 1 : 0, origin.rarity);
		if (result.changes > 0) {
			evolutions.push({
				fromName: previous.name,
				fromSpriteUrl: spriteUrl(previous.number),
				toName: stage.name,
				toSpriteUrl: spriteUrl(stage.number),
				toNumber: stage.number,
			});
		}
	}
	if (evolutions.length > 0) bb.realtime.publish(COLLECTION_CHANGED, { reason: "companion_evolved", captureId, evolutions });
}

async function resetCollection(db: Database, bb: BbPluginApi) {
	await bb.storage.kv.delete("starter");
	await bb.storage.kv.delete("activeCompanionCaptureId");
	db.transaction(() => {
		db.prepare("DELETE FROM companion_roster").run();
		db.prepare("DELETE FROM captures").run();
		db.prepare("DELETE FROM pokemon_details").run();
		db.prepare("DELETE FROM companion_progress").run();
		db.prepare("DELETE FROM thread_token_usage").run();
		db.prepare("DELETE FROM incubator_state").run();
	})();
	bb.realtime.publish(COLLECTION_CHANGED, { reason: "reset" });
	return readCollection(db, bb);
}

async function addDemoReward(db: Database, bb: BbPluginApi, kind: "egg" | "shiny") {
	if (await bb.storage.kv.get<StarterId>("starter") === undefined) throw new Error("Choose a starter before adding demo rewards.");
	const candidate: PokemonCandidate = kind === "egg"
		? { id: "dratini", name: "Dratini", number: 147 }
		: { id: "ponyta", name: "Ponyta", number: 77 };
	await ensurePokemonDetails(db, candidate);
	const row = db.prepare("SELECT hatch_counter FROM pokemon_details WHERE pokemon_number = ?").get(candidate.number) as { hatch_counter?: number } | undefined;
	const isEgg = kind === "egg";
	db.prepare(`
		INSERT INTO captures (id, event_key, pokemon_id, pokemon_name, pokemon_number, milestone, source,
			reference, title, description, url, caught_at, is_shiny, rarity, egg_steps, egg_steps_required,
			encounter_location, encounter_version, encounter_method, encounter_chance, encounter_level)
		VALUES (?, NULL, ?, ?, ?, 'demo_reward', 'Developer Tools', ?, ?, ?, NULL, ?, ?, ?, 0, ?,
			'Developer Tools', 'Demo', 'Demo', ?, ?)
	`).run(randomUUID(), candidate.id, candidate.name, candidate.number, `demo-${kind}-${randomUUID()}`,
		isEgg ? "Demo mystery Egg" : "Demo shiny Ponyta",
		isEgg ? "Added a mystery Egg for demo purposes" : "Added a shiny Pokemon for demo purposes",
		new Date().toISOString(), kind === "shiny" ? 1 : 0, isEgg ? "rare" : "uncommon",
		isEgg ? 255 * (Number(row?.hatch_counter ?? 40) + 1) : 0, isEgg ? 5 : 15, isEgg ? 10 : 12);
	bb.realtime.publish(COLLECTION_CHANGED, { reason: `demo-${kind}` });
	return readCollection(db, bb);
}

function sleep(ms: number, signal: AbortSignal) {
	return new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
	});
}

type ConnectionState = z.infer<typeof connectionSchema>;

const disconnected = (): ConnectionState => ({ authenticated: false, account: null, error: null });

async function githubConnection(token: string | undefined) {
	if (token === undefined) return { connection: disconnected(), repositories: [] };
	try {
		const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" };
		const userResponse = await fetch("https://api.github.com/user", { headers, signal: AbortSignal.timeout(10_000) });
		if (!userResponse.ok) throw new Error(`GitHub returned ${userResponse.status}`);
		const user = await userResponse.json() as { login?: unknown };
		if (typeof user.login !== "string") throw new Error("GitHub returned an invalid profile");
		const repositories: Array<{ full_name?: unknown; html_url?: unknown; private?: unknown }> = [];
		for (let page = 1; page <= 10; page += 1) {
			const response = await fetch(`https://api.github.com/user/repos?per_page=100&page=${page}&sort=full_name&affiliation=owner,collaborator,organization_member`, { headers, signal: AbortSignal.timeout(10_000) });
			if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
			const next = await response.json() as typeof repositories;
			repositories.push(...next);
			if (next.length < 100) break;
		}
		return {
			connection: { authenticated: true, account: user.login, error: null },
			repositories: repositories.flatMap((repository) => typeof repository.full_name === "string" && typeof repository.html_url === "string"
				? [{ fullName: repository.full_name, htmlUrl: repository.html_url, private: repository.private === true }]
				: []),
		};
	} catch (error) {
		return { connection: { authenticated: false, account: null, error: error instanceof Error ? error.message : "GitHub authentication failed" }, repositories: [] };
	}
}

async function shortcutConnection(token: string | undefined): Promise<ConnectionState> {
	if (token === undefined) return disconnected();
	try {
		const response = await fetch("https://api.app.shortcut.com/api/v3/member", {
			headers: { "Shortcut-Token": token }, signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) throw new Error(`Shortcut returned ${response.status}`);
		const member = await response.json() as { profile?: { name?: unknown; mention_name?: unknown } };
		const account = typeof member.profile?.name === "string" ? member.profile.name : typeof member.profile?.mention_name === "string" ? member.profile.mention_name : "Connected";
		return { authenticated: true, account, error: null };
	} catch (error) {
		return { authenticated: false, account: null, error: error instanceof Error ? error.message : "Shortcut authentication failed" };
	}
}

async function jiraConnection(token: string | undefined, baseUrl: string, email: string): Promise<ConnectionState> {
	if (token === undefined || baseUrl === "" || email === "") return disconnected();
	try {
		const response = await fetch(`${baseUrl.replace(/\/$/u, "")}/rest/api/3/myself`, {
			headers: { Accept: "application/json", Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}` },
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) throw new Error(`Jira returned ${response.status}`);
		const user = await response.json() as { displayName?: unknown; emailAddress?: unknown };
		const account = typeof user.displayName === "string" ? user.displayName : typeof user.emailAddress === "string" ? user.emailAddress : "Connected";
		return { authenticated: true, account, error: null };
	} catch (error) {
		return { authenticated: false, account: null, error: error instanceof Error ? error.message : "Jira authentication failed" };
	}
}

type GithubEvent = { id?: unknown; type?: unknown; payload?: Record<string, unknown> };
type GithubMilestone = z.infer<typeof recordInputSchema> & { eventKey: string };

function githubMilestones(repository: string, event: GithubEvent, projectManagementTool: z.infer<typeof projectManagementToolSchema>): GithubMilestone[] {
	if (typeof event.id !== "string" || typeof event.type !== "string" || event.payload === undefined) return [];
	const payload = event.payload;
	if (event.type === "CreateEvent" && payload.ref_type === "branch" && typeof payload.ref === "string") {
		return [{ milestone: "branch_opened", source: "GitHub", reference: payload.ref, title: `Opened ${payload.ref} in ${repository}`, url: `https://github.com/${repository}/tree/${encodeURIComponent(payload.ref)}`, eventKey: `github:${repository}:${event.id}` }];
	}
	if (event.type === "PushEvent" && Array.isArray(payload.commits)) {
		return payload.commits.flatMap((commit) => {
			if (typeof commit !== "object" || commit === null) return [];
			const candidate = commit as { sha?: unknown; message?: unknown };
			if (typeof candidate.sha !== "string") return [];
			return [{ milestone: "commit_created" as const, source: "GitHub", reference: candidate.sha, title: typeof candidate.message === "string" ? candidate.message.split("\n")[0]!.slice(0, 500) : `Commit in ${repository}`, url: `https://github.com/${repository}/commit/${candidate.sha}`, eventKey: `github:${repository}:${event.id}:${candidate.sha}` }];
		});
	}
	if (event.type === "PullRequestEvent" && payload.action === "closed" && typeof payload.pull_request === "object" && payload.pull_request !== null) {
		const pullRequest = payload.pull_request as { number?: unknown; title?: unknown; html_url?: unknown };
		if (typeof pullRequest.number !== "number") return [];
		return [{ milestone: "pr_closed", source: "GitHub", reference: `${repository}#${pullRequest.number}`, title: typeof pullRequest.title === "string" ? pullRequest.title.slice(0, 500) : `Closed pull request #${pullRequest.number}`, ...(typeof pullRequest.html_url === "string" ? { url: pullRequest.html_url } : {}), eventKey: `github:${repository}:${event.id}` }];
	}
	if (projectManagementTool === "github_issues" && event.type === "IssuesEvent" && payload.action === "closed" && typeof payload.issue === "object" && payload.issue !== null) {
		const issue = payload.issue as { number?: unknown; title?: unknown; html_url?: unknown; pull_request?: unknown };
		if (typeof issue.number !== "number" || issue.pull_request !== undefined) return [];
		return [{ milestone: "ticket_completed", source: "GitHub Issues", reference: `${repository}#${issue.number}`, title: typeof issue.title === "string" ? issue.title.slice(0, 500) : `Closed issue #${issue.number}`, ...(typeof issue.html_url === "string" ? { url: issue.html_url } : {}), eventKey: `github:${repository}:${event.id}` }];
	}
	return [];
}


function milestoneInput(event: GitSnapshotEvent): z.infer<typeof recordInputSchema> {
	const branch = event.branch ?? "detached worktree";
	const source = event.kind === "worktree_opened" ? "Git worktree" : event.kind === "branch_checked_out" ? "Git checkout" : "Git branch";
	const title = event.kind === "worktree_opened" ? `Created worktree at ${event.path}` : event.kind === "branch_checked_out" ? `Checked out ${branch}` : `Opened ${branch}`;
	return { milestone: "branch_opened", source, reference: branch, title };
}

export default async function plugin(bb: BbPluginApi) {
	const db = bb.storage.database();
	ensureTables(db);
	const settings = bb.settings.define({
		githubToken: { type: "string", label: "GitHub personal access token", secret: true },
		shortcutToken: { type: "string", label: "Shortcut API token", secret: true },
		jiraApiToken: { type: "string", label: "Jira API token", secret: true },
		jiraBaseUrl: { type: "string", label: "Jira site URL", default: "" },
		jiraEmail: { type: "string", label: "Jira account email", default: "" },
		projectManagementTool: { type: "select", label: "Project management tool", options: ["shortcut", "jira", "github_issues"], default: "shortcut" },
		showEvolutionAnimations: { type: "boolean", label: "Show evolution animations", default: true },
		bounceCompanionWhileRunning: { type: "boolean", label: "Bounce companion while agents run", default: true },
	});
	const host = bb.hosts.experimental_client({ contract: hostContract });
	const lifecycle = new AbortController();
	bb.onDispose(() => lifecycle.abort());

	async function readSettings(): Promise<PokemonSettings> {
		const values = await settings.get();
		const watchedRepositories = await bb.storage.kv.get<string[]>("watchedRepositories") ?? [];
		const [github, shortcut, jira] = await Promise.all([
			githubConnection(values.githubToken),
			shortcutConnection(values.shortcutToken),
			jiraConnection(values.jiraApiToken, values.jiraBaseUrl, values.jiraEmail),
		]);
		return {
			repositories: github.repositories,
			watchedRepositories,
			projectManagementTool: projectManagementToolSchema.parse(values.projectManagementTool),
			connections: { github: github.connection, shortcut, jira },
			jiraBaseUrl: values.jiraBaseUrl,
			jiraEmail: values.jiraEmail,
			showEvolutionAnimations: values.showEvolutionAnimations,
			bounceCompanionWhileRunning: values.bounceCompanionWhileRunning,
		};
	}
	bb.rpc.register(rpcContract, {
		collection_get: () => readCollection(db, bb),
		collection_reset: () => resetCollection(db, bb),
		demo_reward_add: ({ kind }) => addDemoReward(db, bb, kind),
		starter_select: ({ starterId }) => selectStarter(db, bb, starterId),
		companion_select: ({ captureId }) => selectCompanion(db, bb, captureId),
		settings_get: () => readSettings(),
		preferences_get: async () => {
			const { showEvolutionAnimations, bounceCompanionWhileRunning } = await settings.get();
			return { showEvolutionAnimations, bounceCompanionWhileRunning };
		},
		settings_update: async ({ watchedRepositories, projectManagementTool, showEvolutionAnimations, bounceCompanionWhileRunning }) => {
			const current = await bb.storage.kv.get<string[]>("watchedRepositories") ?? [];
			const additions = watchedRepositories.filter((repository) => !current.includes(repository));
			if (additions.length > 0) {
				const available = (await githubConnection((await settings.get()).githubToken)).repositories.map((repository) => repository.fullName);
				if (additions.some((repository) => !available.includes(repository))) throw new Error("One or more selected GitHub repositories are unavailable");
			}
			await Promise.all([
				bb.storage.kv.set("watchedRepositories", [...new Set(watchedRepositories)].sort()),
				settings.experimental_set({ projectManagementTool, showEvolutionAnimations, bounceCompanionWhileRunning }),
			]);
			bb.realtime.publish("preferences-changed", { showEvolutionAnimations, bounceCompanionWhileRunning });
			return readSettings();
		},
		connection_save: async (input) => {
			if (input.service === "github") {
				const result = await githubConnection(input.token);
				if (!result.connection.authenticated) throw new Error(result.connection.error ?? "GitHub authentication failed");
				await settings.experimental_set({ githubToken: input.token });
			} else if (input.service === "shortcut") {
				const result = await shortcutConnection(input.token);
				if (!result.authenticated) throw new Error(result.error ?? "Shortcut authentication failed");
				await settings.experimental_set({ shortcutToken: input.token });
			} else {
				const baseUrl = input.baseUrl.replace(/\/$/u, "");
				const result = await jiraConnection(input.token, baseUrl, input.email);
				if (!result.authenticated) throw new Error(result.error ?? "Jira authentication failed");
				await settings.experimental_set({ jiraApiToken: input.token, jiraBaseUrl: baseUrl, jiraEmail: input.email });
			}
			return readSettings();
		},
		connection_disconnect: async ({ service }) => {
			if (service === "github") {
				await settings.experimental_set({ githubToken: null });
				await bb.storage.kv.set("watchedRepositories", []);
			} else if (service === "shortcut") await settings.experimental_set({ shortcutToken: null });
			else await settings.experimental_set({ jiraApiToken: null });
			return readSettings();
		},
	});

	bb.events.on("experimental_thread.events", async ({ thread }) => {
		if (await bb.storage.kv.get<StarterId>("starter") === undefined) return;
		const captures = readCaptures(db);
		const activeCaptureId = await bb.storage.kv.get<string>("activeCompanionCaptureId")
			?? captures.find((capture) => capture.milestone === "starter_selected")?.id;
		if (activeCaptureId === undefined) return;
		const activeCapture = captures.find((capture) => capture.id === activeCaptureId);
		if (activeCapture === undefined) return;
		await ensureCompanionRoster(db, activeCapture);
		const events = await bb.sdk.threads.events.list({
			threadId: thread.id,
			types: ["thread/tokenUsage/updated"],
			order: "desc",
			limit: "1",
		});
		const event = events[0];
		if (event === undefined || event.type !== "thread/tokenUsage/updated") return;
		const reportedTotal = Math.max(0, Math.floor(event.data.tokenUsage.total.totalTokens));
		const reportedLast = Math.max(0, Math.floor(event.data.tokenUsage.last.totalTokens));
		const progress = db.transaction(() => {
			const previous = db.prepare("SELECT total_tokens FROM thread_token_usage WHERE thread_id = ?").get(thread.id) as { total_tokens: number } | undefined;
			const delta = previous === undefined ? reportedLast : reportedTotal >= previous.total_tokens ? reportedTotal - previous.total_tokens : reportedLast;
			db.prepare(`INSERT INTO thread_token_usage (thread_id, total_tokens) VALUES (?, ?)
				ON CONFLICT(thread_id) DO UPDATE SET total_tokens = excluded.total_tokens`).run(thread.id, reportedTotal);
			if (delta > 0) {
				db.prepare("UPDATE companion_roster SET total_tokens = total_tokens + ? WHERE capture_id = ?").run(delta, activeCaptureId);
			}
			db.prepare("INSERT OR IGNORE INTO incubator_state (id, token_remainder) VALUES (1, 0)").run();
			const incubator = db.prepare("SELECT token_remainder FROM incubator_state WHERE id = 1").get() as { token_remainder: number };
			const availableTokens = incubator.token_remainder + delta;
			const eggSteps = Math.floor(availableTokens / TOKENS_PER_EGG_STEP);
			db.prepare("UPDATE incubator_state SET token_remainder = ? WHERE id = 1").run(availableTokens % TOKENS_PER_EGG_STEP);
			const hatchedCaptureIds = eggSteps === 0 ? [] : (db.prepare(`
				SELECT id FROM captures
				WHERE egg_steps_required > 0 AND hatched_at IS NULL AND egg_steps + ? >= egg_steps_required
			`).all(eggSteps) as Array<{ id: string }>).map(({ id }) => id);
			if (eggSteps > 0) {
				db.prepare(`UPDATE captures
					SET egg_steps = MIN(egg_steps_required, egg_steps + ?),
						hatched_at = CASE WHEN egg_steps + ? >= egg_steps_required THEN COALESCE(hatched_at, ?) ELSE hatched_at END
					WHERE egg_steps_required > 0 AND hatched_at IS NULL`).run(eggSteps, eggSteps, new Date().toISOString());
			}
			return { addedTokens: delta, eggSteps, hatchedCaptureIds };
		})();
		if (progress.addedTokens > 0) await recordReachedEvolutions(db, bb, activeCaptureId);
		if (progress.addedTokens > 0) {
			const hatchedIds = new Set(progress.hatchedCaptureIds);
			const hatches = readCaptures(db).filter(({ id }) => hatchedIds.has(id)).map((capture) => ({
				captureId: capture.id,
				pokemonName: capture.pokemonName,
				pokemonNumber: capture.pokemonNumber,
				spriteUrl: capture.isShiny ? capture.shinySpriteUrl : capture.spriteUrl,
				isShiny: capture.isShiny,
			}));
			bb.realtime.publish(COLLECTION_CHANGED, hatches.length === 0 ? progress : { ...progress, reason: "egg_hatched", hatches });
		}
	});

	bb.agents.registerTool({
		name: "pokemon_record_milestone", description: "Record a verified engineering milestone and catch a Pokemon reward.",
		parameters: recordInputSchema,
		presentation: { label: { pending: "Catching a Pokemon", completed: "Caught a Pokemon" }, icon: { glyph: "Sparkles" }, tint: { light: "#fff7d6", dark: "#4a3900" } },
		execute: async (input) => (await recordMilestone(db, bb, input)).message,
	});
	bb.agents.configure(() => ({ tools: ["pokemon_record_milestone"], skills: ["pokemon-catcher"],
		instructions: "After personally verifying a successful commit, closed pull request, or completed ticket, call pokemon_record_milestone exactly once with the real source, reference, and title. Branches and BB worktrees are detected automatically." }));

	const usage = ["Usage:", "  bb pokemon collection [--json]", `  bb pokemon starter <${starters.map((starter) => starter.id).join("|")}> [--json]`,
		"  bb pokemon companion <capture-id> [--json]",
		"  bb pokemon catch <branch_opened|commit_created|pr_closed|ticket_completed> --source <system> --reference <id> --title <title> [--url <url>] [--json]"].join("\n");
	bb.cli.register({
		name: "pokemon", summary: "Catch Pokemon for verified engineering milestones",
		commands: [
			{ name: "collection", summary: "Show caught Pokemon", usage: "bb pokemon collection [--json]" },
			{ name: "starter", summary: "Choose a starter", usage: "bb pokemon starter <name> [--json]" },
			{ name: "companion", summary: "Choose any caught Pokemon as your companion", usage: "bb pokemon companion <capture-id> [--json]" },
			{ name: "catch", summary: "Reward a completed milestone", usage: usage.split("\n").at(-1)! },
		],
		async run(argv) {
			const json = argv.includes("--json"); const args = argv.filter((arg) => arg !== "--json");
			if (args[0] === "collection") {
				const collection = await readCollection(db, bb);
				const captures = collection.captures.slice(0, 100);
				return { exitCode: 0, stdout: json ? JSON.stringify({ ...collection, captures, capturesTruncated: captures.length < collection.captures.length }) : `${collection.totalCaptures} Pokemon caught (${collection.uniquePokemon} unique).` };
			}
			if (args[0] === "starter" && args[1] !== undefined && starters.some((starter) => starter.id === args[1])) {
				const collection = await selectStarter(db, bb, args[1] as StarterId);
				return { exitCode: 0, stdout: json ? JSON.stringify(collection) : `${collection.companion?.pokemonName ?? "Starter"} is now your companion.` };
			}
			if (args[0] === "companion" && args[1] !== undefined) {
				try {
					const collection = await selectCompanion(db, bb, args[1]);
					return { exitCode: 0, stdout: json ? JSON.stringify(collection) : `${collection.companion?.pokemonName ?? "Pokemon"} is now your companion.` };
				} catch (error) {
					return { exitCode: 1, stderr: error instanceof Error ? error.message : String(error) };
				}
			}
			if (args[0] === "catch" && milestoneKinds.includes(args[1] as MilestoneKind)) {
				const value = (flag: string) => { const index = args.indexOf(flag); return index === -1 ? undefined : args[index + 1]; };
				const parsed = recordInputSchema.safeParse({ milestone: args[1], source: value("--source"), reference: value("--reference"), title: value("--title"), url: value("--url") });
				if (parsed.success) {
					const result = await recordMilestone(db, bb, parsed.data);
					return { exitCode: 0, stdout: json ? JSON.stringify(result) : result.message };
				}
			}
			return { exitCode: args[0] === undefined || args[0] === "--help" || args[0] === "help" ? 0 : 1, stdout: usage };
		},
	});

	async function reconcile(signal: AbortSignal) {
		const [projects, environments] = await Promise.all([
			bb.sdk.projects.list({ signal }), bb.sdk.environments.list({ status: "ready", signal, limit: 500 }),
		]);
		const rootsByHost = new Map<string, Set<string>>();
		for (const project of projects) for (const source of project.sources) {
			const roots = rootsByHost.get(source.hostId) ?? new Set<string>(); roots.add(source.path); rootsByHost.set(source.hostId, roots);
		}
		for (const environment of environments) if (environment.path !== null) {
			const roots = rootsByHost.get(environment.hostId) ?? new Set<string>(); roots.add(environment.path); rootsByHost.set(environment.hostId, roots);
		}
		for (const [hostId, roots] of rootsByHost) {
			const { repositories } = await host.call("scanGitRoots", { roots: [...roots] }, { hostId, signal });
			for (const snapshot of repositories) {
				const row = db.prepare("SELECT snapshot_json FROM git_detector_snapshots WHERE host_id = ? AND repo_id = ?").get(hostId, snapshot.repoId) as { snapshot_json: string } | undefined;
				const previous = row === undefined ? [] : [JSON.parse(row.snapshot_json) as GitRepoSnapshot];
				for (const event of diffGitSnapshots(previous, [snapshot])) {
					const path = "path" in event ? event.path : "";
					const eventIdentity = (event.kind === "branch_opened" || event.kind === "worktree_opened") && event.branch !== null
						? `branch_opened:${event.branch}:`
						: `${event.kind}:${event.branch ?? ""}:${path}`;
					const eventKey = createHash("sha256").update(`${hostId}:${snapshot.repoId}:${eventIdentity}`).digest("hex");
					await recordMilestone(db, bb, milestoneInput(event), eventKey);
				}
				db.prepare(`INSERT INTO git_detector_snapshots (host_id, repo_id, snapshot_json, updated_at) VALUES (?, ?, ?, ?)
					ON CONFLICT(host_id, repo_id) DO UPDATE SET snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at`)
					.run(hostId, snapshot.repoId, JSON.stringify(snapshot), new Date().toISOString());
			}
		}
	}
	let reconciliation: Promise<void> | null = null;
	function runReconcile(signal?: AbortSignal) {
		if (reconciliation !== null) return reconciliation;
		const combinedSignal = signal === undefined ? lifecycle.signal : AbortSignal.any([lifecycle.signal, signal]);
		reconciliation = reconcile(combinedSignal).finally(() => { reconciliation = null; });
		return reconciliation;
	}

	bb.background.service("git-milestone-detector", {
		async start(signal) {
			while (!signal.aborted) {
				try { await runReconcile(signal); } catch (error) { if (!signal.aborted) bb.log.warn(`Git milestone scan failed: ${error instanceof Error ? error.message : String(error)}`); }
				await sleep(15_000, signal);
			}
		},
	});
	bb.events.on("thread.active", () => {
		void runReconcile().catch((error) => { if (!lifecycle.signal.aborted) bb.log.warn(`Immediate Git milestone scan failed: ${error instanceof Error ? error.message : String(error)}`); });
	});

	async function reconcileGithub(signal: AbortSignal) {
		const values = await settings.get();
		if (values.githubToken === undefined) return;
		const watchedRepositories = await bb.storage.kv.get<string[]>("watchedRepositories") ?? [];
		if (watchedRepositories.length === 0) return;
		const projectManagementTool = projectManagementToolSchema.parse(values.projectManagementTool);
		const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${values.githubToken}`, "X-GitHub-Api-Version": "2022-11-28" };
		for (const repository of watchedRepositories) {
			if (signal.aborted) return;
			const encodedRepository = repository.split("/").map(encodeURIComponent).join("/");
			const response = await fetch(`https://api.github.com/repos/${encodedRepository}/events?per_page=100`, { headers, signal });
			if (!response.ok) throw new Error(`GitHub events for ${repository} returned ${response.status}`);
			const events = await response.json() as GithubEvent[];
			const newestId = events.find((event) => typeof event.id === "string")?.id;
			if (typeof newestId !== "string") continue;
			const row = db.prepare("SELECT event_id FROM github_event_cursors WHERE repository = ?").get(repository) as { event_id: string } | undefined;
			if (row !== undefined) {
				const cursorIndex = events.findIndex((event) => event.id === row.event_id);
				if (cursorIndex === -1) bb.log.warn(`GitHub event cursor for ${repository} fell outside the latest 100 events; baselining current activity.`);
				else for (const event of events.slice(0, cursorIndex).reverse()) {
					for (const milestone of githubMilestones(repository, event, projectManagementTool)) {
						const { eventKey, ...input } = milestone;
						await recordMilestone(db, bb, input, eventKey);
					}
				}
			}
			db.prepare(`INSERT INTO github_event_cursors (repository, event_id, updated_at) VALUES (?, ?, ?)
				ON CONFLICT(repository) DO UPDATE SET event_id = excluded.event_id, updated_at = excluded.updated_at`)
				.run(repository, newestId, new Date().toISOString());
		}
	}

	bb.background.service("github-milestone-detector", {
		async start(signal) {
			while (!signal.aborted) {
				try { await reconcileGithub(signal); } catch (error) { if (!signal.aborted) bb.log.warn(`GitHub milestone scan failed: ${error instanceof Error ? error.message : String(error)}`); }
				await sleep(60_000, signal);
			}
		},
	});
}
