import * as fs from "fs";
import * as path from "path";

/**
 * These variables control build behavior.
 */
const SETTINGS = {
	projectFile: "default.project.json",
	srcPath: path.join(__dirname, "../src"),
	outDir: "out",

	// see Rojo project format docs
	emitLegacyScripts: true as boolean,

	// Name of wrapper folder (e.g. "TS") or 'false' to disable nesting
	wrapInFolder: "TS" as string | false,

	// 'true' keeps/adds suffixes (inventory-server); 'false' strips them (inventory)
	appendSuffix: false,

	// add your modules here
	nodeModules: {
		"@rbxts": "node_modules/@rbxts", // base module, do not remove
	},
};

/**
 * This template uses the exact JSON format of a standard Rojo 'default.project.json'.
 * The script parses this base structure and dynamically injects your source
 * code from 'src' into the tree.
 *
 * WARNING:
 * If you manually define a script path here that also exists in your 'src'
 * folder, the generator will overwrite your manual entry.
 *
 * USE THIS SECTION FOR:
 *  1. Services: Workspace, Lighting, HttpService (with properties).
 *  2. Assets: Manual paths to .rbxm models, sounds, or meshes.
 */

const nodeModulesInline = Object.entries(SETTINGS.nodeModules)
	.map(([module, path]) => `"${module}": { "$path": "${path}" }`)
	.join(",\n");

const CONFIG_PROJECT_JSON = `{
  "emitLegacyScripts": ${SETTINGS.emitLegacyScripts},
  "name": "roblox-ts-game",
  "globIgnorePaths": [
    "**/package.json",
    "**/tsconfig.json"
  ],
  "tree": {
    "$className": "DataModel",
    "ServerScriptService": {
      "$className": "ServerScriptService"
    },
    "ReplicatedStorage": {
      "$className": "ReplicatedStorage",
      "rbxts_include": {
        "$path": "include",
        "node_modules": {
          "$className": "Folder",
          ${nodeModulesInline}
        }
      }
    },
    "StarterPlayer": {
      "$className": "StarterPlayer",
      "StarterPlayerScripts": {
        "$className": "StarterPlayerScripts"
      }
    },
    "Workspace": {
      "$className": "Workspace"
    },
    "HttpService": {
      "$className": "HttpService"
    },
    "SoundService": {
      "$className": "SoundService",
      "$properties": {
        "RespectFilteringEnabled": true
      }
    }
  }
}`;

const projectTree: RojoProject = JSON.parse(CONFIG_PROJECT_JSON);

const serviceMap: Record<string, string> = {
	Server: "ServerScriptService",
	Client: "StarterPlayerScripts",
	Shared: "ReplicatedStorage",
	ServerScriptService: "ServerScriptService",
	ReplicatedStorage: "ReplicatedStorage",
	ReplicatedFirst: "ReplicatedFirst",
	ServerStorage: "ServerStorage",
	StarterGui: "StarterGui",
	StarterPack: "StarterPack",
	StarterPlayerScripts: "StarterPlayerScripts",
	StarterCharacterScripts: "StarterCharacterScripts",
} as const;

const serviceParents: Record<string, string> = {
	StarterPlayerScripts: "StarterPlayer",
	StarterCharacterScripts: "StarterPlayer",
} as const;

const lowerServiceMap = Object.fromEntries(Object.entries(serviceMap).map(([k, v]) => [k.toLowerCase(), v]));

const separatorRegex = new RegExp(`[\\.\\-_](${Object.keys(lowerServiceMap).join("|")})$`, "i");
const pascalCaseRegex = new RegExp(`(${Object.keys(serviceMap).join("|")})$`);

const toPosix = (p: string) => p.split(path.sep).join("/");
const isValidScript = (filename: string) =>
	/\.(tsx?|luau|lua)$/i.test(filename) && !filename.toLowerCase().endsWith(".d.ts");
const isInitFile = (filename: string) => isValidScript(filename) && /^(index|init)([\.-][a-z0-9_]+)?\./i.test(filename);

function getOrCreateNode(parent: RojoNode, key: string, className: string): RojoNode {
	return (parent[key] ??= { $className: className }) as RojoNode;
}

function sortObject(obj: any): any {
	if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return obj;
	return Object.keys(obj)
		.sort()
		.reduce((acc: any, key) => {
			acc[key] = sortObject(obj[key]);
			return acc;
		}, {});
}

function processFilePath(filepath: string, isInit: boolean) {
	const relativePath = path.relative(SETTINGS.srcPath, filepath);
	const parts = relativePath.split(path.sep);
	const filename = parts.pop()!;
	const basename = path.basename(filename, path.extname(filename));

	let targetService = "ReplicatedStorage";
	const virtualParts: string[] = [];
	let lastRouteKeyword: string | null = null;

	// Folder routing
	for (const part of parts) {
		const lowerPart = part.toLowerCase();
		if (lowerServiceMap[lowerPart]) {
			targetService = lowerServiceMap[lowerPart];
			lastRouteKeyword = lowerPart;
		} else {
			virtualParts.push(part);
		}
	}

	let matchedSuffixLength = 0;
	let mappedService: string | null = null;

	const sepMatch = basename.match(separatorRegex);
	const pascalMatch = basename.match(pascalCaseRegex);

	// Suffix routing
	if (sepMatch) {
		mappedService = lowerServiceMap[sepMatch[1].toLowerCase()];
		matchedSuffixLength = sepMatch[0].length;
	} else if (pascalMatch) {
		mappedService = serviceMap[pascalMatch[1]];
		matchedSuffixLength = pascalMatch[0].length;
	}
	if (mappedService && !lastRouteKeyword) {
		// Scripts with non-legacy run context run incorrectly in StarterPlayer container.
		// Instead, always put them in ReplicatedStorage
		if (SETTINGS.emitLegacyScripts == false && mappedService == "StarterPlayerScripts") {
			targetService = "ReplicatedStorage";
		} else {
			targetService = mappedService;
		}
	}

	let nodeName = basename;
	let projectPath = "";

	if (isInit) {
		const folderRelativePath = path.dirname(relativePath);
		projectPath = toPosix(path.join(SETTINGS.outDir, folderRelativePath));
		if (virtualParts.length > 0) {
			nodeName = virtualParts.pop()!;
			if (SETTINGS.appendSuffix && lastRouteKeyword) {
				nodeName += `-${lastRouteKeyword}`;
			}
		} else {
			nodeName = lastRouteKeyword ? lastRouteKeyword : "source";
		}
	} else {
		const compiledFilename = filename.replace(/\.tsx?$/i, ".luau");
		const compiledRelativePath = path.join(path.dirname(relativePath), compiledFilename);
		projectPath = toPosix(path.join(SETTINGS.outDir, compiledRelativePath));
		if (!SETTINGS.appendSuffix && mappedService) {
			nodeName = basename.slice(0, -matchedSuffixLength);
		}
	}

	return { targetService, virtualParts, nodeName, projectPath };
}

function walk(dir: string, callback: (filepath: string, isInit: boolean) => void) {
	if (!fs.existsSync(dir)) return;
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	const files = entries.filter((e) => e.isFile());
	const folders = entries.filter((e) => e.isDirectory());

	const initFile = files.find((e) => isInitFile(e.name));
	if (initFile) {
		callback(path.join(dir, initFile.name), true);
		return;
	}

	for (const file of files) {
		if (!initFile && isValidScript(file.name)) {
			callback(path.join(dir, file.name), false);
		}
	}

	for (const folder of folders) {
		walk(path.join(dir, folder.name), callback);
	}
}

if (!fs.existsSync(SETTINGS.srcPath)) {
	console.error(`Error: src path not found: ${SETTINGS.srcPath}`);
	process.exit(1);
}

let fileCount = 0;
walk(SETTINGS.srcPath, (filepath, isInit) => {
	fileCount++;
	const { targetService, virtualParts, nodeName, projectPath } = processFilePath(filepath, isInit);
	let current: RojoNode = projectTree.tree;

	// Mount to Service
	const parentService = serviceParents[targetService];
	if (parentService) {
		current = getOrCreateNode(current, parentService, parentService);
	}
	current = getOrCreateNode(current, targetService, targetService);

	// Mount to TS folder
	if (SETTINGS.wrapInFolder) {
		current = getOrCreateNode(current, SETTINGS.wrapInFolder, "Folder");
	}

	// Build virtual folders
	for (const part of virtualParts) {
		current = getOrCreateNode(current, part, "Folder");
	}

	current[nodeName] = { $path: projectPath };
});

const sortedTree = sortObject(projectTree);
fs.writeFileSync(SETTINGS.projectFile, JSON.stringify(sortedTree, null, 2));

console.log(`\nRojo project ${projectTree.name} generated successfully!`);
console.log(`Processed ${fileCount} source files.`);
console.log(`Output: ${SETTINGS.projectFile}\n`);

interface RojoNode {
	$className?: string;
	$path?: string;
	$ignoreUnknownInstances?: boolean;
	$properties?: Record<string, unknown>;
	[key: string]: any;
}

interface RojoProject {
	name: string;
	servePort?: number;
	servePlaceIds?: number[];
	placeId?: number;
	gameId?: number;
	serveAddress?: string;
	globIgnorePaths?: string[];
	emitLegacyScripts?: boolean;
	tree: RojoNode;
}
