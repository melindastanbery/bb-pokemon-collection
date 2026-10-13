import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { usePreferences } from "../../hooks/use-preferences";
import { spriteUrl } from "../../lib/pokemon/media";

const EXPERIENCE_PREVIEW_EVENT = "pokemon-catcher:preview-experience";

export function previewPokemonExperience(kind: "evolution" | "hatch") {
	window.dispatchEvent(new CustomEvent(EXPERIENCE_PREVIEW_EVENT, {
		detail: { kind, key: `preview-${kind}-${Date.now()}-${window.performance.now()}` },
	}));
}

type Evolution = {
	type: "evolution";
	fromName: string;
	fromSpriteUrl: string;
	toName: string;
	toSpriteUrl: string;
	key: string;
	preview?: true;
};

type Hatch = {
	type: "hatch";
	pokemonName: string;
	pokemonNumber: number;
	spriteUrl: string;
	isShiny: boolean;
	key: string;
	preview?: true;
};

type Experience = Evolution | Hatch;

function readPreview(detail: unknown): Experience | null {
	if (typeof detail !== "object" || detail === null) return null;
	const candidate = detail as { kind?: unknown; key?: unknown };
	if (typeof candidate.key !== "string") return null;
	if (candidate.kind === "evolution") {
		return {
			type: "evolution",
			fromName: "Fennekin",
			fromSpriteUrl: spriteUrl(653),
			toName: "Braixen",
			toSpriteUrl: spriteUrl(654),
			key: candidate.key,
			preview: true,
		};
	}
	if (candidate.kind === "hatch") {
		return {
			type: "hatch",
			pokemonName: "Dratini",
			pokemonNumber: 147,
			spriteUrl: spriteUrl(147),
			isShiny: false,
			key: candidate.key,
			preview: true,
		};
	}
	return null;
}

function readEvolutions(payload: unknown): Evolution[] {
	if (typeof payload !== "object" || payload === null) return [];
	const candidate = payload as { reason?: unknown; captureId?: unknown; evolutions?: unknown };
	if (candidate.reason !== "companion_evolved" || typeof candidate.captureId !== "string" || !Array.isArray(candidate.evolutions)) return [];
	return candidate.evolutions.flatMap((entry, index) => {
		if (typeof entry !== "object" || entry === null) return [];
		const evolution = entry as Record<string, unknown>;
		if (typeof evolution.fromName !== "string" || typeof evolution.fromSpriteUrl !== "string" || typeof evolution.toName !== "string" || typeof evolution.toSpriteUrl !== "string" || typeof evolution.toNumber !== "number") return [];
		return [{
			type: "evolution" as const,
			fromName: evolution.fromName,
			fromSpriteUrl: evolution.fromSpriteUrl,
			toName: evolution.toName,
			toSpriteUrl: evolution.toSpriteUrl,
			key: `${candidate.captureId}:${evolution.toNumber}:${index}`,
		}];
	});
}

function readHatches(payload: unknown): Hatch[] {
	if (typeof payload !== "object" || payload === null) return [];
	const candidate = payload as { reason?: unknown; hatches?: unknown };
	if (candidate.reason !== "egg_hatched" || !Array.isArray(candidate.hatches)) return [];
	return candidate.hatches.flatMap((entry) => {
		if (typeof entry !== "object" || entry === null) return [];
		const hatch = entry as Record<string, unknown>;
		if (typeof hatch.captureId !== "string" || typeof hatch.pokemonName !== "string" || typeof hatch.pokemonNumber !== "number" || typeof hatch.spriteUrl !== "string" || typeof hatch.isShiny !== "boolean") return [];
		return [{
			type: "hatch" as const,
			pokemonName: hatch.pokemonName,
			pokemonNumber: hatch.pokemonNumber,
			spriteUrl: hatch.spriteUrl,
			isShiny: hatch.isShiny,
			key: hatch.captureId,
		}];
	});
}

function playEvolutionChime() {
	type AudioContextConstructor = new () => AudioContext;
	const AudioContextClass = (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).AudioContext
		?? (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
	if (AudioContextClass === undefined) return;
	try {
		const context = new AudioContextClass();
		void context.resume();
		const master = context.createGain();
		master.gain.setValueAtTime(0.0001, context.currentTime);
		master.gain.exponentialRampToValueAtTime(0.13, context.currentTime + 0.04);
		master.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 3.45);
		master.connect(context.destination);
		[523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
			const oscillator = context.createOscillator();
			const gain = context.createGain();
			const start = context.currentTime + index * 0.18;
			oscillator.type = index === 3 ? "sine" : "triangle";
			oscillator.frequency.setValueAtTime(frequency, start);
			gain.gain.setValueAtTime(0.0001, start);
			gain.gain.exponentialRampToValueAtTime(0.8, start + 0.03);
			gain.gain.exponentialRampToValueAtTime(0.0001, start + (index === 3 ? 2.7 : 0.45));
			oscillator.connect(gain);
			gain.connect(master);
			oscillator.start(start);
			oscillator.stop(start + (index === 3 ? 2.75 : 0.5));
		});
		const timeout = window.setTimeout(() => void context.close(), 3_600);
		return () => {
			window.clearTimeout(timeout);
			if (context.state !== "closed") void context.close();
		};
	} catch {
		return;
	}
}

function EvolutionModal({ evolution, onClose }: { evolution: Evolution; onClose: () => void }) {
	const [complete, setComplete] = useState(false);

	useEffect(() => {
		const stopChime = playEvolutionChime();
		const completion = window.setTimeout(() => setComplete(true), 3_400);
		const dismissal = window.setTimeout(onClose, 6_500);
		return () => {
			stopChime?.();
			window.clearTimeout(completion);
			window.clearTimeout(dismissal);
		};
	}, [evolution.key, onClose]);

	useEffect(() => {
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("keydown", closeOnEscape);
		return () => document.removeEventListener("keydown", closeOnEscape);
	}, [onClose]);

	return (
		<div className="pokemon-evolution-modal fixed inset-0 z-[110] grid place-items-center bg-black/70 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
			<section className="pokemon-evolution-scene relative w-full max-w-2xl overflow-hidden rounded-xl border border-border shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="pokemon-evolution-title">
				<Button className="absolute right-3 top-3 z-20 border-white/30 bg-black/25 text-white hover:bg-black/45 hover:text-white" variant="outline" size="icon" aria-label="Close evolution" onClick={onClose}>
					<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
				</Button>
				<div className="pokemon-evolution-light" aria-hidden="true" />
				<div className="pokemon-evolution-arena relative flex min-h-[22rem] items-center justify-center px-8 pb-28 pt-12">
					<img src={evolution.fromSpriteUrl} alt="" className="pokemon-classic-evolution-sprite pokemon-classic-evolution-from" draggable={false} />
					<img src={evolution.toSpriteUrl} alt={evolution.toName} className="pokemon-classic-evolution-sprite pokemon-classic-evolution-to" draggable={false} />
				</div>
				<div className="pokemon-evolution-dialog absolute inset-x-3 bottom-3 z-10 rounded-lg border-4 border-double border-foreground bg-card p-4 pr-24 shadow-xl sm:inset-x-5 sm:bottom-5">
					<p id="pokemon-evolution-title" className="font-mono text-base font-semibold leading-7 text-foreground sm:text-lg">
						{complete ? <>Congratulations!<br />Your {evolution.fromName} evolved into {evolution.toName}!</> : <>What?<br />{evolution.fromName} is evolving!</>}
					</p>
					<Button className="absolute bottom-3 right-3" variant="outline" size="sm" onClick={onClose}>{complete ? "Continue" : "Skip"}</Button>
				</div>
			</section>
		</div>
	);
}

function HatchModal({ hatch, onClose }: { hatch: Hatch; onClose: () => void }) {
	const [phase, setPhase] = useState<"waiting" | "cracking" | "hatched">("waiting");
	const [visible, setVisible] = useState(false);
	const [closing, setClosing] = useState(false);
	const closeTimer = useRef<number | null>(null);
	const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
	const requestClose = useCallback(() => {
		if (closeTimer.current !== null) return;
		setClosing(true);
		setVisible(false);
		closeTimer.current = window.setTimeout(onClose, 160);
	}, [onClose]);

	useEffect(() => {
		const frame = window.requestAnimationFrame(() => setVisible(true));
		return () => window.cancelAnimationFrame(frame);
	}, [hatch.key]);

	useEffect(() => () => {
		if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
	}, []);

	useEffect(() => {
		const crack = window.setTimeout(() => setPhase("cracking"), reducedMotion ? 400 : 1_100);
		const reveal = window.setTimeout(() => setPhase("hatched"), reducedMotion ? 900 : 2_500);
		const dismissal = window.setTimeout(requestClose, reducedMotion ? 4_000 : 6_500);
		return () => {
			window.clearTimeout(crack);
			window.clearTimeout(reveal);
			window.clearTimeout(dismissal);
		};
	}, [hatch.key, reducedMotion, requestClose]);

	useEffect(() => {
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") requestClose();
		};
		document.addEventListener("keydown", closeOnEscape);
		return () => document.removeEventListener("keydown", closeOnEscape);
	}, [requestClose]);

	const hatched = phase === "hatched";
	return (
		<div className="pokemon-hatch-modal fixed inset-0 z-[110] grid place-items-center bg-black/70 p-4" data-visible={visible ? "true" : "false"} data-closing={closing ? "true" : undefined} onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
			<section className="pokemon-hatch-scene relative w-full max-w-2xl overflow-hidden rounded-xl border border-border shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="pokemon-hatch-title">
				<Button className="absolute right-3 top-3 z-20 border-white/30 bg-black/25 text-white hover:bg-black/45 hover:text-white" variant="outline" size="icon" aria-label="Close egg hatching" onClick={requestClose}>
					<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
				</Button>
				<div className="pokemon-hatch-rays" aria-hidden="true" />
				<div className="pokemon-hatch-arena relative flex min-h-[22rem] items-center justify-center px-8 pb-28 pt-12" data-phase={phase}>
					<div className="pokemon-hatching-egg pokemon-egg" aria-hidden="true">
						<svg className="pokemon-hatch-cracks" viewBox="0 0 116 144" fill="none" focusable="false">
							<g className="pokemon-hatch-crack-wave pokemon-hatch-crack-wave-one">
								<path d="M78 8 68 22 74 35 66 48" />
								<path d="M68 22 55 18 47 10" />
								<path d="M74 35 88 29 101 34" />
							</g>
							<g className="pokemon-hatch-crack-wave pokemon-hatch-crack-wave-two">
								<path d="M66 48 72 61 64 75" />
								<path d="M66 48 52 44 43 54 31 51" />
								<path d="M72 61 86 56 96 65 108 62" />
							</g>
							<g className="pokemon-hatch-crack-wave pokemon-hatch-crack-wave-three">
								<path d="M64 75 70 88 59 103 49 114" />
								<path d="M64 75 50 71 40 82 28 87" />
								<path d="M70 88 84 84 93 95 106 100" />
							</g>
						</svg>
					</div>
					<div className="pokemon-hatch-flash" aria-hidden="true" />
					<img src={hatch.spriteUrl} alt={hatched ? hatch.pokemonName : ""} className="pokemon-hatch-sprite" draggable={false} />
				</div>
				<div className="pokemon-evolution-dialog absolute inset-x-3 bottom-3 z-10 rounded-lg border-4 border-double border-foreground bg-card p-4 pr-24 shadow-xl sm:inset-x-5 sm:bottom-5">
					<p id="pokemon-hatch-title" className="font-mono text-base font-semibold leading-7 text-foreground sm:text-lg">
						{hatched ? <>{hatch.isShiny ? "A Shiny " : ""}{hatch.pokemonName} hatched from the Egg!</> : phase === "cracking" ? <>The Egg is cracking!</> : <>Oh?</>}
					</p>
					<Button className="absolute bottom-3 right-3" variant="outline" size="sm" onClick={requestClose}>{hatched ? "Continue" : "Skip"}</Button>
				</div>
			</section>
		</div>
	);
}

export function EvolutionExperience() {
	const enabled = usePreferences()?.showEvolutionAnimations ?? null;
	const [experiences, setExperiences] = useState<Experience[]>([]);

	useRealtime("collection-changed", (payload) => {
		const next = [...readEvolutions(payload), ...readHatches(payload)];
		if (next.length > 0) setExperiences((current) => [...current, ...next]);
	});
	useEffect(() => {
		const onPreview = (event: Event) => {
			const next = readPreview((event as CustomEvent<unknown>).detail);
			if (next !== null) setExperiences((current) => [...current, next]);
		};
		window.addEventListener(EXPERIENCE_PREVIEW_EVENT, onPreview);
		return () => window.removeEventListener(EXPERIENCE_PREVIEW_EVENT, onPreview);
	}, []);

	useEffect(() => {
		if (enabled === false) setExperiences((current) => current.filter(({ preview }) => preview === true));
	}, [enabled]);

	const current = experiences[0];
	if (current === undefined || (enabled !== true && current.preview !== true)) return null;
	const onClose = () => setExperiences((queued) => queued.slice(1));
	return current.type === "evolution" ? <EvolutionModal key={current.key} evolution={current} onClose={onClose} /> : <HatchModal key={current.key} hatch={current} onClose={onClose} />;
}
