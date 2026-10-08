import { useCallback, useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { PokemonPreferences, rpcContract } from "../server";

const motionDisabled: PokemonPreferences = { showEvolutionAnimations: false, bounceCompanionWhileRunning: false };

/** Saved motion preferences; null while loading, and every animation off if they cannot be read. */
export function usePreferences() {
	const rpc = useRpc<typeof rpcContract>();
	const [preferences, setPreferences] = useState<PokemonPreferences | null>(null);

	const load = useCallback(() => {
		rpc.call("preferences_get").then(setPreferences, () => setPreferences(motionDisabled));
	}, [rpc]);

	useEffect(load, [load]);
	useRealtime("preferences-changed", load);

	return preferences;
}
