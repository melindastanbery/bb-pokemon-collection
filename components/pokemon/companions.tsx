import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { experimental_useSidebarThreads, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { starters, type StarterId } from "../../pokemon";
import { useCollection } from "../../hooks/use-collection";
import { usePreferences } from "../../hooks/use-preferences";
import { animatedSpriteUrl, spriteUrl } from "../../lib/pokemon/media";

type EvolutionSpriteProps = {
	captureId: string;
	pokemonName: string;
	pokemonNumber: number;
	spriteUrl: string;
	className: string;
	children?: ReactNode;
	showMessage?: boolean;
};

export function EvolutionSprite({ captureId, pokemonName, pokemonNumber, spriteUrl: currentSpriteUrl, className, children, showMessage = false }: EvolutionSpriteProps) {
	const previous = useRef({ captureId, pokemonName, pokemonNumber, spriteUrl: currentSpriteUrl });
	const [evolution, setEvolution] = useState<{ fromName: string; fromSpriteUrl: string; key: number } | null>(null);

	useEffect(() => {
		const prior = previous.current;
		previous.current = { captureId, pokemonName, pokemonNumber, spriteUrl: currentSpriteUrl };
		if (prior.captureId !== captureId || prior.pokemonNumber === pokemonNumber) return;
		setEvolution({ fromName: prior.pokemonName, fromSpriteUrl: prior.spriteUrl, key: pokemonNumber });
		const timeout = window.setTimeout(() => setEvolution(null), 1_800);
		return () => window.clearTimeout(timeout);
	}, [captureId, currentSpriteUrl, pokemonName, pokemonNumber]);

	return (
		<span className={`pokemon-evolution-stage ${className}`} data-evolving={evolution === null ? undefined : "true"}>
			{evolution === null ? (children ?? <img src={currentSpriteUrl} alt={pokemonName} className="pokemon-evolution-sprite" draggable={false} />) : (
				<>
					<img src={evolution.fromSpriteUrl} alt="" className="pokemon-evolution-sprite pokemon-evolution-from" draggable={false} />
					<img key={evolution.key} src={currentSpriteUrl} alt={pokemonName} className="pokemon-evolution-sprite pokemon-evolution-to" draggable={false} />
					{showMessage ? <span className="pokemon-evolution-message" role="status">{evolution.fromName} evolved into {pokemonName}!</span> : null}
				</>
			)}
		</span>
	);
}

const spritePatterns: Array<Array<[number, number, number, number]>> = [
	[[10, 2, 12, 5], [6, 6, 20, 5], [4, 11, 24, 11], [7, 22, 5, 6], [20, 22, 5, 6], [2, 14, 5, 6], [25, 14, 5, 6]],
	[[10, 3, 12, 7], [7, 9, 18, 13], [8, 21, 6, 7], [19, 21, 6, 7], [24, 17, 5, 5], [27, 12, 3, 5]],
	[[9, 3, 14, 7], [6, 9, 20, 14], [8, 22, 6, 6], [19, 22, 6, 6], [2, 12, 6, 5], [25, 12, 5, 5]],
];

function PixelStarter({ id, running = false }: { id: StarterId; running?: boolean }) {
	const starter = starters.find((candidate) => candidate.id === id)!;
	const pixels = spritePatterns[starter.number % spritePatterns.length]!;
	return (
		<svg viewBox="0 0 32 32" aria-hidden="true" className={`pokemon-sprite size-7 ${running ? "pokemon-sprite-running" : ""}`} shapeRendering="crispEdges">
			{pixels.map(([x, y, width, height], index) => <rect key={index} x={x} y={y} width={width} height={height} fill="currentColor" opacity={index === 0 ? 0.65 : 1} />)}
			<rect x="10" y="13" width="3" height="3" className="fill-background" />
			<rect x="20" y="13" width="3" height="3" className="fill-background" />
		</svg>
	);
}

function hasRunningThread(threads: ReturnType<typeof experimental_useSidebarThreads>["threads"]) {
	return threads.some((thread) => thread.indicator === "runtime" || Object.values(thread.activity).some((count) => count > 0));
}

type Position = { x: number; y: number };

const POSITION_STORAGE_KEY = "pokemon-catcher:floating-companion-position";
const FLOATING_COMPANION_SIZE = 64;

function isPosition(value: unknown): value is Position {
	if (typeof value !== "object" || value === null) return false;
	const { x, y } = value as Record<string, unknown>;
	return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y);
}

/** The last dropped position, kept inside the current window; the bottom-left corner when none is saved. */
function readSavedPosition(): Position {
	try {
		const saved: unknown = JSON.parse(window.localStorage.getItem(POSITION_STORAGE_KEY) ?? "null");
		if (isPosition(saved)) {
			return {
				x: Math.min(Math.max(saved.x, 0), Math.max(window.innerWidth - FLOATING_COMPANION_SIZE, 0)),
				y: Math.min(Math.max(saved.y, 0), Math.max(window.innerHeight - FLOATING_COMPANION_SIZE, 0)),
			};
		}
	} catch {
		// Unreadable storage falls back to the default corner.
	}
	return { x: 32, y: window.innerHeight - 120 };
}

function savePosition(position: Position) {
	try {
		window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position));
	} catch {
		// The companion still moves for this session when storage is unavailable.
	}
}

export function FloatingCompanion() {
	const { collection } = useCollection();
	const { threads } = experimental_useSidebarThreads();
	const preferences = usePreferences();
	const [position, setPosition] = useState(readSavedPosition);
	const [isDragging, setIsDragging] = useState(false);
	const isRunning = hasRunningThread(threads);
	const isBouncing = isRunning && preferences?.bounceCompanionWhileRunning === true;

	useEffect(() => {
		if (!isDragging) return;
		let dropped: Position | null = null;
		const handleMove = (event: MouseEvent) => {
			dropped = { x: event.clientX - 32, y: event.clientY - 32 };
			setPosition(dropped);
		};
		const handleUp = () => {
			setIsDragging(false);
			if (dropped !== null) savePosition(dropped);
		};
		window.addEventListener("mousemove", handleMove);
		window.addEventListener("mouseup", handleUp);
		return () => {
			window.removeEventListener("mousemove", handleMove);
			window.removeEventListener("mouseup", handleUp);
		};
	}, [isDragging]);

	if (collection?.starter === null || collection === null) return null;
	const starter = starters.find((candidate) => candidate.id === collection.starter)!;
	const starterCapture = collection.captures.find((capture) => capture.milestone === "starter_selected");
	const companion = collection.companion;
	const animated = companion?.animatedSpriteUrl ?? (companion === null ? starterCapture?.animatedSpriteUrl : null) ?? animatedSpriteUrl(companion?.pokemonNumber ?? starter.number);
	const fallback = companion?.spriteUrl ?? starterCapture?.spriteUrl ?? spriteUrl(companion?.pokemonNumber ?? starter.number);
	const companionName = companion?.pokemonName ?? starter.name;

	return createPortal(
		<div className={`pokemon-floating-companion fixed z-50 cursor-grab select-none ${isDragging ? "cursor-grabbing" : ""} ${isBouncing ? "pokemon-bouncing" : ""}`} style={{ left: position.x, top: position.y }} onMouseDown={() => setIsDragging(true)} title={`${companionName} · Lv. ${companion?.level ?? 5}${isRunning ? " - Running with your agent!" : ""}`}>
			{companion === null ? <img src={animated ?? fallback} alt={companionName} className="size-16 object-contain [image-rendering:pixelated] drop-shadow-lg" draggable={false} /> : (
				<EvolutionSprite captureId={companion.captureId} pokemonName={companionName} pokemonNumber={companion.pokemonNumber} spriteUrl={animated ?? fallback} className="size-16 drop-shadow-lg" showMessage />
			)}
		</div>,
		document.body,
	);
}

export function ThreadCompanion({ threadId, isCompactViewport }: { threadId: string; isCompactViewport: boolean }) {
	const { collection } = useCollection();
	const { threads } = experimental_useSidebarThreads();
	const preferences = usePreferences();
	const navigate = useBbNavigate();
	const thread = threads.find((candidate) => candidate.id === threadId);
	const running = thread !== undefined && (thread.indicator === "runtime" || Object.values(thread.activity).some((count) => count > 0));
	const bouncing = running && preferences?.bounceCompanionWhileRunning === true;
	if (collection?.starter === null || collection === null) return null;
	const starter = starters.find((candidate) => candidate.id === collection.starter)!;
	const companion = collection.companion;
	const companionName = companion?.pokemonName ?? starter.name;

	return (
		<Button variant="ghost" size={isCompactViewport ? "icon" : "sm"} className="h-7 gap-1.5 px-1.5" aria-label={`Open Pokemon collection. ${companionName} is level ${companion?.level ?? 5} and ${running ? "running with your agent" : "resting"}.`} onClick={() => navigate.toPluginPanel("collection")}>
			{companion === null ? <PixelStarter id={starter.id} running={bouncing} /> : (
				<EvolutionSprite captureId={companion.captureId} pokemonName={companionName} pokemonNumber={companion.pokemonNumber} spriteUrl={companion.spriteUrl ?? spriteUrl(companion.pokemonNumber)} className={`size-7 ${bouncing ? "pokemon-bouncing" : ""}`}>
					{companion.pokemonNumber === starter.number ? <PixelStarter id={starter.id} /> : undefined}
				</EvolutionSprite>
			)}
			{isCompactViewport ? null : <span className="max-w-28 truncate text-xs">{companionName} · Lv. {companion?.level ?? 5}</span>}
		</Button>
	);
}
