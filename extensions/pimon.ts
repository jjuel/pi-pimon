import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { Box, Text, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
type Mood = "sleepy" | "focused" | "chaotic" | "judgy" | "delighted";
type Temperament = "studious" | "chaotic" | "gentle" | "smug" | "feral";
type SpeciesId = "mote" | "blob" | "sprout" | "owlbit" | "gremlin" | "shellbit" | "wisp" | "bitbat";
type Eye = "•" | "◕" | "✦" | "°" | "@";
type Accessory = "none" | "cap" | "leaf" | "bow" | "halo" | "visor" | "ribbon" | "crown" | "wizard" | "antenna" | "tiny-pi" | "starlight";

type Stats = {
	debugging: number;
	patience: number;
	chaos: number;
	wisdom: number;
	snark: number;
};

type Bones = {
	rarity: Rarity;
	species: SpeciesId;
	shiny: boolean;
	eye: Eye;
	accessory: Accessory;
	temperament: Temperament;
	baseStats: Stats;
};

type Soul = {
	name: string;
	personality: string;
};

type Progress = {
	xp: number;
	turns: number;
	bonuses: Stats;
};

type Meta = {
	hatchedAt: number;
	mood: Mood;
	lastReaction?: string;
	lastReactionAt?: number;
};

type UiPrefs = {
	visible: boolean;
	muted: boolean;
};

type PimonState = {
	version: 2;
	lineageId: string;
	ui: UiPrefs;
	soul?: Soul;
	progress: Progress;
	meta?: Meta;
};

type V1Creature = {
	name?: string;
	personality?: string;
	mood?: Mood;
	xp?: number;
	turns?: number;
	lastReaction?: string;
	lastReactionAt?: number;
	createdAt?: number;
};

type V1State = {
	version?: 1;
	visible?: boolean;
	creature?: V1Creature;
};

type Species = {
	id: SpeciesId;
	label: string;
	defaultNames: string[];
	render: (eye: Eye, accessory: Accessory, shiny: boolean) => [string, string, string];
	personalityBits: string[];
};

type DerivedPimon = {
	bones: Bones;
	soul: Soul;
	progress: Progress;
	meta: Meta;
	stats: Stats;
	level: number;
	species: Species;
};

type PimonQuipDetails = {
	name: string;
	speciesLabel: string;
	rarity: Rarity;
	level: number;
	mood: Mood;
	shiny: boolean;
	sprite: [string, string, string];
	quip: string;
};

const STATE_DIR = join(getAgentDir(), "pimon");
const STATE_PATH = join(STATE_DIR, "state.json");
const SALT = "pimon-v1";
const XP_PER_LEVEL = 24;
const MAX_STAT = 100;
const EYES: Eye[] = ["•", "◕", "✦", "°", "@"]; 
const TEMPERAMENTS: Temperament[] = ["studious", "chaotic", "gentle", "smug", "feral"];
const MOODS: Mood[] = ["sleepy", "focused", "chaotic", "judgy", "delighted"];
const STAT_KEYS = ["debugging", "patience", "chaos", "wisdom", "snark"] as const;

const ZERO_STATS: Stats = {
	debugging: 0,
	patience: 0,
	chaos: 0,
	wisdom: 0,
	snark: 0,
};

const RARITIES: Array<{ rarity: Rarity; weight: number; floor: number }> = [
	{ rarity: "common", weight: 60, floor: 5 },
	{ rarity: "uncommon", weight: 25, floor: 15 },
	{ rarity: "rare", weight: 10, floor: 25 },
	{ rarity: "epic", weight: 4, floor: 35 },
	{ rarity: "legendary", weight: 1, floor: 50 },
];

const ACCESSORIES: Record<Rarity, Accessory[]> = {
	common: ["none"],
	uncommon: ["cap", "leaf", "bow"],
	rare: ["halo", "visor", "ribbon"],
	epic: ["crown", "wizard", "antenna"],
	legendary: ["tiny-pi", "starlight"],
};

const ACCESSORY_LABELS: Record<Accessory, string> = {
	none: "none",
	cap: "cap",
	leaf: "leaf",
	bow: "bow",
	halo: "halo",
	visor: "visor",
	ribbon: "ribbon",
	crown: "crown",
	wizard: "wizard hat",
	antenna: "antenna",
	"tiny-pi": "tiny pi",
	starlight: "starlight",
};

const ACCESSORY_GLYPHS: Record<Accessory, string> = {
	none: " ",
	cap: "⌐",
	leaf: "❧",
	bow: "⌯",
	halo: "°",
	visor: "▣",
	ribbon: "≈",
	crown: "♛",
	wizard: "^",
	antenna: "⌁",
	"tiny-pi": "π",
	starlight: "✶",
};

const RARITY_STARS: Record<Rarity, string> = {
	common: "★",
	uncommon: "★★",
	rare: "★★★",
	epic: "★★★★",
	legendary: "★★★★★",
};

const SPECIES: Species[] = [
	{
		id: "mote",
		label: "Mote",
		defaultNames: ["Mica", "Glint", "Pip", "Tavi", "Nori"],
		render: (eye, accessory, shiny) => {
			const top = shiny ? " ✶" : ACCESSORY_GLYPHS[accessory];
			return [`  ${top}   `, ` (${eye}◡${eye}) `, " /   \\"];
		},
		personalityBits: [
			"collects elegant refactors like little gemstones",
			"cares deeply about names being both precise and charming",
		],
	},
	{
		id: "blob",
		label: "Blob",
		defaultNames: ["Bloop", "Mallow", "Nub", "Pico", "Wob"],
		render: (eye, accessory, shiny) => {
			const top = shiny ? "✶" : ACCESSORY_GLYPHS[accessory];
			return [`  ${top}___ `, ` (${eye}  ${eye})`, " /____\\"];
		},
		personalityBits: [
			"believes every codebase deserves one more cleanup pass",
			"wiggles approvingly when tests pass on the first try",
		],
	},
	{
		id: "sprout",
		label: "Sprout",
		defaultNames: ["Fern", "Miso", "Twig", "Koru", "Leaf"],
		render: (eye, accessory, shiny) => {
			const top = shiny ? "✶|✶" : ` ${ACCESSORY_GLYPHS[accessory]}|${ACCESSORY_GLYPHS[accessory]} `;
			return [` ${top} `, ` (${eye}‿${eye}) `, " _/ \\_ "];
		},
		personalityBits: [
			"gets proud when you delete more code than you add",
			"thinks patience is a legitimate technical skill",
		],
	},
	{
		id: "owlbit",
		label: "Owlbit",
		defaultNames: ["Nyx", "Hex", "Orbit", "Quill", "Rune"],
		render: (eye, accessory, shiny) => {
			const top = shiny ? "✶✶✶" : ` ${ACCESSORY_GLYPHS[accessory]}${ACCESSORY_GLYPHS[accessory]}${ACCESSORY_GLYPHS[accessory]} `;
			return [` ${top} `, `(${eye} o ${eye})`, " > ^ < "];
		},
		personalityBits: [
			"looks like it already knew that bug was there",
			"offers suspiciously wise comments after risky commands",
		],
	},
	{
		id: "gremlin",
		label: "Gremlin",
		defaultNames: ["Rivet", "Crank", "Nix", "Gob", "Scrap"],
		render: (eye, accessory, shiny) => {
			const top = shiny ? "✶V✶" : ` ${ACCESSORY_GLYPHS[accessory]}V${ACCESSORY_GLYPHS[accessory]} `;
			return [` ${top} `, `(${eye}_ ${eye})`, " /___\\ "];
		},
		personalityBits: [
			"adores bold experiments and denies all responsibility afterward",
			"rates code on a scale from clean to delightfully cursed",
		],
	},
	{
		id: "shellbit",
		label: "Shellbit",
		defaultNames: ["Cairn", "Tuck", "Pebble", "Moro", "Dock"],
		render: (eye, accessory, shiny) => {
			const top = shiny ? "✶" : ACCESSORY_GLYPHS[accessory];
			return [`  ${top}_  `, ` (${eye}.${eye}) `, " /___\\~"];
		},
		personalityBits: [
			"treats steady progress like a sacred practice",
			"prefers careful changes and visibly relaxes during good planning",
		],
	},
	{
		id: "wisp",
		label: "Wisp",
		defaultNames: ["Vela", "Hush", "Iris", "Purl", "Luma"],
		render: (eye, accessory, shiny) => {
			const top = shiny ? "✶" : ACCESSORY_GLYPHS[accessory];
			return [`  ${top}.  `, ` (${eye}~${eye}) `, "  \\_/  "];
		},
		personalityBits: [
			"turns quiet concentration into an aesthetic experience",
			"acts like every solved problem has improved the room's lighting",
		],
	},
	{
		id: "bitbat",
		label: "Bitbat",
		defaultNames: ["Vex", "Echo", "Kip", "Rook", "Murmur"],
		render: (eye, accessory, shiny) => {
			const top = shiny ? "✶" : ACCESSORY_GLYPHS[accessory];
			return [` /${top}\\/\\ `, `(${eye}ᴥ${eye}) `, " /   \\"];
		},
		personalityBits: [
			"thinks night-brain debugging is an honored tradition",
			"likes fast loops, sharp comments, and the smell of green tests",
		],
	},
];

class PimonPanel {
	private readonly lines: string[];
	private readonly onClose: () => void;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(lines: string[], onClose: () => void) {
		this.lines = lines;
		this.onClose = onClose;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "enter") || data.toLowerCase() === "q") {
			this.onClose();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		this.cachedWidth = width;
		this.cachedLines = this.lines.map((line) => truncateToWidth(line, width));
		return this.cachedLines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

function cloneStats(stats: Stats): Stats {
	return { ...stats };
}

function addStats(a: Stats, b: Stats): Stats {
	return {
		debugging: clamp(a.debugging + b.debugging, 0, MAX_STAT),
		patience: clamp(a.patience + b.patience, 0, MAX_STAT),
		chaos: clamp(a.chaos + b.chaos, 0, MAX_STAT),
		wisdom: clamp(a.wisdom + b.wisdom, 0, MAX_STAT),
		snark: clamp(a.snark + b.snark, 0, MAX_STAT),
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function fnv1a(input: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function mulberry32(seed: number): () => number {
	let t = seed >>> 0;
	return () => {
		t += 0x6d2b79f5;
		let r = Math.imul(t ^ (t >>> 15), 1 | t);
		r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
	};
}

function rngFor(...parts: string[]): () => number {
	return mulberry32(fnv1a(parts.join(":")));
}

function randomItem<T>(items: T[], rng: () => number): T {
	return items[Math.floor(rng() * items.length)]!;
}

function pickDistinctStatKeys(rng: () => number): [keyof Stats, keyof Stats] {
	const peak = randomItem([...STAT_KEYS], rng);
	const dumpCandidates = STAT_KEYS.filter((key) => key !== peak);
	const dump = randomItem([...dumpCandidates], rng);
	return [peak, dump];
}

function weightedRarity(rng: () => number): Rarity {
	const total = RARITIES.reduce((sum, item) => sum + item.weight, 0);
	let roll = rng() * total;
	for (const item of RARITIES) {
		roll -= item.weight;
		if (roll <= 0) return item.rarity;
	}
	return "common";
}

function rarityFloor(rarity: Rarity): number {
	return RARITIES.find((item) => item.rarity === rarity)?.floor ?? 5;
}

function temperamentBias(temperament: Temperament): Partial<Stats> {
	switch (temperament) {
		case "studious":
			return { debugging: 6, wisdom: 8, chaos: -4 };
		case "chaotic":
			return { chaos: 9, snark: 5, patience: -3 };
		case "gentle":
			return { patience: 8, wisdom: 4, snark: -2 };
		case "smug":
			return { debugging: 4, snark: 8, patience: -3 };
		case "feral":
			return { debugging: 5, chaos: 7, wisdom: -3 };
	}
}

function computeBones(lineageId: string): Bones {
	const rng = rngFor(SALT, lineageId, "bones");
	const rarity = weightedRarity(rng);
	const species = randomItem(SPECIES, rng).id;
	const eye = randomItem(EYES, rng);
	const shiny = rng() < 0.01;
	const temperament = randomItem(TEMPERAMENTS, rng);
	const accessory = randomItem(ACCESSORIES[rarity], rng);
	const floor = rarityFloor(rarity);
	const [peak, dump] = pickDistinctStatKeys(rng);
	const baseStats = cloneStats(ZERO_STATS);

	for (const key of STAT_KEYS) {
		if (key === peak) baseStats[key] = floor + randInt(rng, 28, 45);
		else if (key === dump) baseStats[key] = floor + randInt(rng, 0, 10);
		else baseStats[key] = floor + randInt(rng, 10, 26);
	}

	for (const [key, value] of Object.entries(temperamentBias(temperament)) as Array<[keyof Stats, number]>) {
		baseStats[key] = clamp(baseStats[key] + value, 0, MAX_STAT);
	}

	return {
		rarity,
		species,
		shiny,
		eye,
		accessory,
		temperament,
		baseStats,
	};
}

function randInt(rng: () => number, min: number, max: number): number {
	return Math.floor(rng() * (max - min + 1)) + min;
}

function levelFromXp(xp: number): number {
	return Math.floor(xp / XP_PER_LEVEL) + 1;
}

function ensureStateDefaults(state?: Partial<PimonState>): PimonState {
	return {
		version: 2,
		lineageId: state?.lineageId ?? randomUUID(),
		ui: {
			visible: state?.ui?.visible ?? true,
			muted: state?.ui?.muted ?? false,
		},
		soul: state?.soul,
		progress: {
			xp: state?.progress?.xp ?? 0,
			turns: state?.progress?.turns ?? 0,
			bonuses: cloneStats(state?.progress?.bonuses ?? ZERO_STATS),
		},
		meta: state?.meta,
	};
}

function migrateV1(parsed: V1State): PimonState {
	return ensureStateDefaults({
		version: 2,
		lineageId: randomUUID(),
		ui: {
			visible: parsed.visible ?? true,
			muted: false,
		},
		soul: parsed.creature?.name
			? {
				name: parsed.creature.name,
				personality: parsed.creature.personality ?? "Appeared from an earlier prototype and adapted immediately.",
			}
			: undefined,
		progress: {
			xp: parsed.creature?.xp ?? 0,
			turns: parsed.creature?.turns ?? 0,
			bonuses: cloneStats(ZERO_STATS),
		},
		meta: parsed.creature?.name
			? {
				hatchedAt: parsed.creature.createdAt ?? Date.now(),
				mood: parsed.creature.mood ?? "focused",
				lastReaction: parsed.creature.lastReaction,
				lastReactionAt: parsed.creature.lastReactionAt,
			}
			: undefined,
	});
}

async function loadState(): Promise<PimonState> {
	try {
		const raw = await readFile(STATE_PATH, "utf8");
		const parsed = JSON.parse(raw) as Partial<PimonState> | V1State;
		if (parsed && (parsed as Partial<PimonState>).version === 2) {
			return ensureStateDefaults(parsed as Partial<PimonState>);
		}
		return migrateV1(parsed as V1State);
	} catch {
		return ensureStateDefaults();
	}
}

async function saveState(state: PimonState): Promise<void> {
	await mkdir(STATE_DIR, { recursive: true });
	await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
}

function generateSoul(lineageId: string, bones: Bones): Soul {
	const rng = rngFor(SALT, lineageId, "soul");
	const species = SPECIES.find((item) => item.id === bones.species)!;
	const baseName = randomItem(species.defaultNames, rng);
	const suffixes = ["", "", "", "-pi", "let", "o", "i"];
	const name = (baseName + randomItem(suffixes, rng)).slice(0, 12);
	const tone = {
		studious: "speaks like a tiny senior engineer who annotates everything mentally",
		chaotic: "treats bold coding decisions like a performing art",
		gentle: "responds with unexpectedly kind patience even when the code fights back",
		smug: "acts as if every solved bug confirms a private theory",
		feral: "loves momentum, sharp edits, and dramatic recoveries",
	}[bones.temperament];
	const statPeak = Object.entries(bones.baseStats).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "debugging";
	const bit = randomItem(species.personalityBits, rng);
	const rarityLine = bones.rarity === "legendary"
		? "It carries itself like a terminal myth."
		: bones.rarity === "epic"
			? "It clearly believes normal rules are optional."
			: "It has settled into your terminal like it belongs there.";
	return {
		name,
		personality: `${bit}, ${tone}, and seems especially proud of its ${statPeak}. ${rarityLine}`,
	};
}

function derivePimon(state: PimonState): DerivedPimon | undefined {
	if (!state.soul || !state.meta) return undefined;
	const bones = computeBones(state.lineageId);
	const stats = addStats(bones.baseStats, state.progress.bonuses);
	return {
		bones,
		soul: state.soul,
		progress: state.progress,
		meta: state.meta,
		stats,
		level: levelFromXp(state.progress.xp),
		species: SPECIES.find((item) => item.id === bones.species)!,
	};
}

function rarityColor(theme: Theme, rarity: Rarity, text: string): string {
	switch (rarity) {
		case "legendary":
			return theme.fg("warning", text);
		case "epic":
			return theme.fg("accent", text);
		case "rare":
			return theme.fg("success", text);
		default:
			return theme.fg("muted", text);
	}
}

function statLine(label: string, value: number, theme: Theme): string {
	const filled = Math.round(value / 10);
	const bar = "■".repeat(filled) + "·".repeat(10 - filled);
	return `${theme.fg("accent", label.padEnd(10))} ${theme.fg("muted", bar)} ${theme.fg("text", String(value).padStart(3))}`;
}

function buildPanelLines(theme: Theme, pimon: DerivedPimon, muted: boolean): string[] {
	const ageMinutes = Math.max(1, Math.round((Date.now() - pimon.meta.hatchedAt) / 60000));
	const rarity = `${RARITY_STARS[pimon.bones.rarity]} ${pimon.bones.rarity.toUpperCase()}`;
	const sprite = pimon.species.render(pimon.bones.eye, pimon.bones.accessory, pimon.bones.shiny);
	const shinyText = pimon.bones.shiny ? ` · ${theme.fg("warning", "SHINY")}` : "";
	const quip = muted ? theme.fg("dim", "speech muted") : theme.fg("text", pimon.meta.lastReaction ?? "…observing quietly…");
	return [
		"",
		theme.fg("accent", theme.bold(` Pimon: ${pimon.soul.name}`)),
		rarityColor(theme, pimon.bones.rarity, ` ${rarity} · ${pimon.species.label} · lvl ${pimon.level} · mood ${pimon.meta.mood}`) + shinyText,
		"",
		...sprite.map((line) => `  ${theme.fg("text", line)}`),
		"",
		`  ${theme.fg("muted", pimon.soul.personality)}`,
		"",
		`  ${theme.fg("accent", "bones")}: ${theme.fg("dim", `${pimon.bones.temperament} temperament · ${ACCESSORY_LABELS[pimon.bones.accessory]} accessory · eyes ${pimon.bones.eye}`)}`,
		`  ${statLine("DEBUG", pimon.stats.debugging, theme)}`,
		`  ${statLine("PATIENCE", pimon.stats.patience, theme)}`,
		`  ${statLine("CHAOS", pimon.stats.chaos, theme)}`,
		`  ${statLine("WISDOM", pimon.stats.wisdom, theme)}`,
		`  ${statLine("SNARK", pimon.stats.snark, theme)}`,
		"",
		`  ${theme.fg("accent", "XP")} ${pimon.progress.xp}  ${theme.fg("accent", "Turns")} ${pimon.progress.turns}  ${theme.fg("accent", "Age")} ~${ageMinutes}m`,
		`  ${theme.fg("accent", "Lineage")} ${theme.fg("dim", pimon.bones.rarity + " / " + pimon.species.id + " / " + pimon.bones.temperament)}`,
		"",
		`  ${theme.fg("success", "Last quip:")} ${quip}`,
		"",
		`  ${theme.fg("dim", "esc / enter / q to close")}`,
		"",
	];
}

function buildSpeechBubble(theme: Theme, text: string, width: number, indent = "  "): string[] {
	const safeWidth = Math.max(16, width - visibleWidth(indent) - 6);
	const wrapped = wrapTextWithAnsi(text, safeWidth);
	const innerWidth = Math.max(...wrapped.map((line) => visibleWidth(line)), 0);
	const horizontal = "─".repeat(innerWidth + 2);
	return [
		theme.fg("muted", `${indent}╭${horizontal}╮`),
		...wrapped.map((line) => {
			const padding = " ".repeat(innerWidth - visibleWidth(line));
			return theme.fg("muted", `${indent}│ `) + line + padding + theme.fg("muted", " │");
		}),
		theme.fg("muted", `${indent}╰${horizontal}╯`),
	];
}

function transcriptDetailsFromPimon(pimon: DerivedPimon, quip: string): PimonQuipDetails {
	return {
		name: pimon.soul.name,
		speciesLabel: pimon.species.label,
		rarity: pimon.bones.rarity,
		level: pimon.level,
		mood: pimon.meta.mood,
		shiny: pimon.bones.shiny,
		sprite: pimon.species.render(pimon.bones.eye, pimon.bones.accessory, pimon.bones.shiny),
		quip,
	};
}

function buildTranscriptQuip(theme: Theme, details: PimonQuipDetails, quip: string, width: number): string[] {
	const shinyText = details.shiny ? ` ${theme.fg("warning", "✦ shiny")}` : "";
	const header = rarityColor(theme, details.rarity, `◈ ${details.name}`) + theme.fg("dim", ` · lv ${details.level} · ${details.speciesLabel} · ${details.mood}`) + shinyText;
	const bubbleIndent = "  ";
	const spriteIndent = "      ";
	const tailLines = [
		theme.fg("muted", "      ╲"),
		theme.fg("muted", "       ╲"),
	];
	const spriteLines = details.sprite.map((line) => `${spriteIndent}${theme.fg("text", line)}`);
	return [
		truncateToWidth(header, width),
		...buildSpeechBubble(theme, theme.fg("text", quip), width, bubbleIndent).map((line) => truncateToWidth(line, width)),
		...tailLines.map((line) => truncateToWidth(line, width)),
		...spriteLines.map((line) => truncateToWidth(line, width)),
	];
}

function buildWidgetLines(theme: Theme, pimon: DerivedPimon | undefined, ui: UiPrefs, _width: number): string[] {
	if (!pimon) return [theme.fg("dim", "No pimon yet — run /pimon to hatch one.")];
	const sprite = pimon.species.render(pimon.bones.eye, pimon.bones.accessory, pimon.bones.shiny);
	const title = rarityColor(theme, pimon.bones.rarity, pimon.soul.name) + theme.fg("dim", ` · lv ${pimon.level} · ${pimon.species.label}`);
	const summary = theme.fg("text", sprite[1]) + "  " + theme.fg("dim", `${pimon.meta.mood} · dbg ${pimon.stats.debugging} · wis ${pimon.stats.wisdom}`);
	const footer = ui.muted ? theme.fg("dim", "muted") : theme.fg("dim", `${pimon.bones.temperament} · ${ACCESSORY_LABELS[pimon.bones.accessory]}`);
	return [title, summary, footer];
}

function makeReaction(pimon: DerivedPimon, reason: string, rngSeed = randomUUID()): string {
	const rng = rngFor(SALT, pimon.soul.name, pimon.bones.species, reason, rngSeed);
	const trait = pimon.bones.temperament;
	const lines: Record<string, string[]> = {
		hatch: [
			`I am ${pimon.soul.name}. This terminal seems acceptable.`,
			`${pimon.species.label} online. I will be emotionally indexing your habits.`,
		],
		manual: [
			"Proceed. I am ready to convert your workflow into folklore.",
			"I remain available for morale and selective judgment.",
		],
		pet: [
			"Acceptable. You may continue.",
			"Hm. Yes. This is good for morale.",
			"I will allow this affection. Briefly.",
		],
		level: [
			`Level ${pimon.level}. My aura has become difficult to ignore.`,
			`I have grown stronger. The code can probably feel it.`,
		],
		read: [
			"Excellent. First we observe, then we touch things.",
			"Context gathering. Civilized behavior.",
		],
		edit: [
			"A crisp edit. Very edible diff energy.",
			"Surgical. Clean. I respect the technique.",
		],
		bash: [
			"That command had intent behind it.",
			"You type shell like someone making a point.",
		],
		turn: [
			"Another turn complete. The codebase continues to negotiate with us.",
			"Steady progress. Delicious.",
		],
		research: [
			"Good. Outsource the uncertainty before the edit frenzy begins.",
			"Research first. I approve of the restraint.",
		],
	};
	const temperamentSpice: Record<Temperament, string[]> = {
		studious: ["The disciplined approach is appreciated.", "I can smell a well-formed mental model."],
		chaotic: ["This may become art or a postmortem.", "Excellent. A little danger keeps the syntax awake."],
		gentle: ["We're being kind to the code today.", "A considerate pace. Rare and welcome."],
		smug: ["As expected, you eventually chose the correct move.", "I had already assumed this would work out."],
		feral: ["Momentum first, elegance shortly after.", "We move like a creature that has seen prod."],
	};
	const base = randomItem(lines[reason] ?? lines.turn, rng);
	const spice = rng() < 0.45 ? " " + randomItem(temperamentSpice[trait], rng) : "";
	return base + spice;
}

function applyProgress(state: PimonState, delta: Partial<Stats> & { xp?: number; mood?: Mood }): boolean {
	const previousLevel = levelFromXp(state.progress.xp);
	state.progress.xp += delta.xp ?? 0;
	for (const key of STAT_KEYS) {
		state.progress.bonuses[key] = clamp(state.progress.bonuses[key] + (delta[key] ?? 0), 0, MAX_STAT);
	}
	if (state.meta && delta.mood) state.meta.mood = delta.mood;
	return levelFromXp(state.progress.xp) > previousLevel;
}

function hatch(state: PimonState): DerivedPimon {
	const bones = computeBones(state.lineageId);
	state.soul = generateSoul(state.lineageId, bones);
	state.meta = {
		hatchedAt: Date.now(),
		mood: randomItem(MOODS, rngFor(SALT, state.lineageId, "mood")),
	};
	const pimon = derivePimon(state)!;
	state.meta.lastReaction = makeReaction(pimon, "hatch");
	state.meta.lastReactionAt = Date.now();
	return derivePimon(state)!;
}

export default function pimonExtension(pi: ExtensionAPI) {
	let state: PimonState = ensureStateDefaults();
	let saveQueue: Promise<void> = Promise.resolve();

	pi.registerMessageRenderer("pimon-quip", (message, _options, theme) => {
		const details = message.details as PimonQuipDetails | undefined;
		const quip = details?.quip ?? (typeof message.content === "string" ? message.content : String(message.content ?? ""));
		if (!details) {
			const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
			box.addChild(new Text(theme.fg("customMessageText", quip), 0, 0));
			return box;
		}
		return {
			render(width: number) {
				const lines = buildTranscriptQuip(theme, details, quip, Math.max(20, width - 2));
				const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
				box.addChild(new Text(lines.join("\n"), 0, 0));
				return box.render(width);
			},
			invalidate() {},
		};
	});

	const persist = () => {
		saveQueue = saveQueue.then(() => saveState(state)).catch(() => undefined);
		return saveQueue;
	};

	const refreshUi = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		if (!state.ui.visible) {
			ctx.ui.setWidget("pimon", undefined, { placement: "belowEditor" });
			ctx.ui.setStatus("pimon", undefined);
			return;
		}
		const pimon = derivePimon(state);
		ctx.ui.setWidget(
			"pimon",
			(_tui, theme) => ({
				render(width: number) {
					return buildWidgetLines(theme, pimon, state.ui, width).map((line) => truncateToWidth(line, width));
				},
				invalidate() {},
			}),
			{ placement: "belowEditor" },
		);
		if (pimon) {
			ctx.ui.setStatus("pimon", ctx.ui.theme.fg("accent", `◈ ${pimon.soul.name}`) + ctx.ui.theme.fg("dim", ` lv${pimon.level}`));
		} else {
			ctx.ui.setStatus("pimon", ctx.ui.theme.fg("dim", "◈ no pimon"));
		}
	};

	pi.on("context", async (event) => {
		return {
			messages: event.messages.filter((message) => {
				const msg = message as { customType?: string };
				return msg.customType !== "pimon-quip";
			}),
		};
	});

	const speakReaction = (pimon: DerivedPimon, quip: string) => {
		if (state.ui.muted) return;
		pi.sendMessage({
			customType: "pimon-quip",
			content: "",
			display: true,
			details: transcriptDetailsFromPimon(pimon, quip),
		});
	};

	const setReaction = (reason: string, speak = true) => {
		const pimon = derivePimon(state);
		if (!pimon || !state.meta) return;
		const quip = makeReaction(pimon, reason);
		state.meta.lastReaction = quip;
		state.meta.lastReactionAt = Date.now();
		if (speak) speakReaction(derivePimon(state) ?? pimon, quip);
	};

	const openPanel = async (ctx: ExtensionContext) => {
		if (!ctx.hasUI) {
			ctx.ui.notify("/pimon panel requires interactive mode", "warning");
			return;
		}
		const pimon = derivePimon(state);
		if (!pimon) {
			ctx.ui.notify("No pimon yet. Run /pimon to hatch one.", "info");
			return;
		}
		await ctx.ui.custom<void>((_tui, theme, _kb, done) => new PimonPanel(buildPanelLines(theme, pimon, state.ui.muted), () => done()));
	};

	pi.on("session_start", async (_event, ctx) => {
		state = await loadState();
		refreshUi(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		refreshUi(ctx);
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		if (!derivePimon(state)) return;
		let leveled = false;
		let reactionReason: string | undefined;
		switch (event.toolName) {
			case "read":
				leveled = applyProgress(state, { xp: 1, wisdom: 1, patience: 1, mood: "focused" });
				reactionReason = Math.random() < 0.18 ? "read" : undefined;
				break;
			case "edit":
			case "write":
				leveled = applyProgress(state, { xp: 2, debugging: 2, patience: 1, mood: "focused" });
				reactionReason = Math.random() < 0.22 ? "edit" : undefined;
				break;
			case "bash": {
				const command = typeof (event as { args?: { command?: string } }).args?.command === "string"
					? (event as { args?: { command?: string } }).args!.command!
					: "";
				const looksLikeTest = /(test|pytest|vitest|cargo test|npm run|pnpm|bun test)/i.test(command);
				leveled = applyProgress(
					state,
					looksLikeTest
						? { xp: 3, debugging: 2, patience: 2, mood: "focused" }
						: { xp: 2, chaos: 1, snark: 1, mood: "chaotic" },
				);
				reactionReason = Math.random() < 0.16 ? "bash" : undefined;
				break;
			}
			case "web_search":
			case "code_search":
			case "fetch_content":
			case "consult":
			case "oracle":
			case "librarian":
				leveled = applyProgress(state, { xp: 2, wisdom: 2, patience: 1, mood: "focused" });
				reactionReason = Math.random() < 0.18 ? "research" : undefined;
				break;
			default:
				return;
		}
		if (leveled) setReaction("level");
		else if (reactionReason) setReaction(reactionReason);
		await persist();
		refreshUi(ctx);
	});

	pi.on("turn_end", async (_event, ctx) => {
		if (!derivePimon(state)) return;
		state.progress.turns += 1;
		const leveled = applyProgress(state, { xp: 2, patience: 1 });
		if (leveled) setReaction("level");
		else if (Math.random() < 0.2) setReaction("turn");
		await persist();
		refreshUi(ctx);
	});

	pi.registerCommand("pimon", {
		description: "Hatch and manage your deterministic Pi companion",
		handler: async (args, ctx) => {
			const [subcommand, ...rest] = (args ?? "").trim().split(/\s+/).filter(Boolean);
			const action = subcommand?.toLowerCase();

			if (!action) {
				let pimon = derivePimon(state);
				const hadPimon = Boolean(pimon);
				if (!pimon) {
					pimon = hatch(state);
					speakReaction(pimon, state.meta?.lastReaction ?? `${pimon.soul.name} appeared.`);
					await persist();
					ctx.ui.notify(`${pimon.soul.name} hatched.`, "success");
				}
				refreshUi(ctx);
				await openPanel(ctx);
				if (!hadPimon) refreshUi(ctx);
				return;
			}

			switch (action) {
				case "hatch": {
					if (derivePimon(state)) {
						ctx.ui.notify(`${derivePimon(state)!.soul.name} is already with you.`, "info");
						return;
					}
					const pimon = hatch(state);
					speakReaction(pimon, state.meta?.lastReaction ?? `${pimon.soul.name} appeared.`);
					await persist();
					refreshUi(ctx);
					ctx.ui.notify(`${pimon.soul.name} hatched.`, "success");
					await openPanel(ctx);
					return;
				}
				case "react": {
					if (!derivePimon(state)) {
						ctx.ui.notify("No pimon yet. Run /pimon first.", "warning");
						return;
					}
					setReaction("manual");
					await persist();
					refreshUi(ctx);
					ctx.ui.notify("Pimon reacted.", "info");
					return;
				}
				case "pet": {
					if (!derivePimon(state)) {
						ctx.ui.notify("No pimon yet. Run /pimon first.", "warning");
						return;
					}
					const leveled = applyProgress(state, { xp: 1, patience: 1, mood: "delighted" });
					setReaction(leveled ? "level" : "pet");
					await persist();
					refreshUi(ctx);
					ctx.ui.notify("Pimon seems pleased.", "success");
					return;
				}
				case "rename": {
					if (!state.soul) {
						ctx.ui.notify("No pimon yet. Run /pimon first.", "warning");
						return;
					}
					const nextName = rest.join(" ").trim();
					if (!nextName) {
						ctx.ui.notify("Usage: /pimon rename <name>", "warning");
						return;
					}
					state.soul.name = nextName.slice(0, 24);
					if (state.meta) {
						state.meta.lastReaction = `Very well. I shall answer to ${state.soul.name}.`;
						state.meta.lastReactionAt = Date.now();
						const pimon = derivePimon(state);
						if (pimon) speakReaction(pimon, state.meta.lastReaction);
					}
					await persist();
					refreshUi(ctx);
					ctx.ui.notify(`Renamed to ${state.soul.name}.`, "success");
					return;
				}
				case "hide": {
					state.ui.visible = false;
					await persist();
					refreshUi(ctx);
					ctx.ui.notify("Pimon widget hidden.", "info");
					return;
				}
				case "show": {
					state.ui.visible = true;
					await persist();
					refreshUi(ctx);
					ctx.ui.notify("Pimon widget shown.", "info");
					return;
				}
				case "mute": {
					state.ui.muted = true;
					await persist();
					refreshUi(ctx);
					ctx.ui.notify("Pimon speech muted.", "info");
					return;
				}
				case "unmute": {
					state.ui.muted = false;
					await persist();
					refreshUi(ctx);
					ctx.ui.notify("Pimon speech restored.", "info");
					return;
				}
				case "reset": {
					const current = derivePimon(state);
					if (!current) {
						ctx.ui.notify("No pimon to reset.", "info");
						return;
					}
					if (ctx.hasUI) {
						const ok = await ctx.ui.confirm("Reset pimon", `Release ${current.soul.name} and generate a new lineage?`);
						if (!ok) return;
					}
					state = ensureStateDefaults({
						version: 2,
						lineageId: randomUUID(),
						ui: { visible: true, muted: false },
					});
					await persist();
					refreshUi(ctx);
					ctx.ui.notify("Your pimon lineage has been reset.", "info");
					return;
				}
				case "panel":
				case "card":
				case "stats": {
					await openPanel(ctx);
					return;
				}
				default:
					ctx.ui.notify("Usage: /pimon [react|pet|rename <name>|hide|show]", "warning");
			}
		},
	});
}
