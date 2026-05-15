const fs = require("fs");
const path = require("path");

/**
 * ENVIRONMENT PRESETS
 * Defaults based on the language used in your project.
 */
const TS_PRESETS = {
	outputDirectory: "out", // TS compiles to 'out'
	wrapperFolder: "TS",    // TS usually nests scripts under a 'TS' folder in-game
};

const LUAU_PRESETS = {
	outputDirectory: "src", // Luau projects usually reference 'src' directly
	wrapperFolder: false,   // Luau projects usually mount directly to services
};

/**
 * BASE CONFIGURATION
 * Core settings for the generator.
 */
const BASE_CONFIG = {
	// The name of the generated Rojo project file
	projectFileName: "default.project.json",

	// The root folder containing your source code
	sourceDirectory: "src",

	// 'true' keeps and adds suffixes (e.g. inventory-server); 'false' strips them (e.g. inventory)
	appendSuffix: false,
};

/**
 * ROJO PROJECT TEMPLATE
 * Edit this section to define your project's structure, services, and packages.
 * This script will automatically inject your source code into this tree, 
 * but you should manually define assets, models, and package folders here.
 * 
 * Common customizations:
 * - Packages: Add entry for a 'pesde` package folder.
 * - TS Tools: Map node_modules for React or Flamework.
 * - Services: Add 'SoundService' or 'Lighting' to set specific properties.
 * 
 * See Rojo's docs for more details (https://rojo.space/docs/v7/)
 */
const ROJO_TREE_TEMPLATE = `{
	"name": "roblox-project",
	"globIgnorePaths": [
		"**/package.json",
		"**/tsconfig.json"
	],
	"tree": {
		"$className": "DataModel",
		"ServerScriptService": {
			"ServerPackages": {
				"$path": "ServerPackages"
			}
		},
		"ReplicatedStorage": {
			"rbxts_include": {
				"$path": "include",
				"node_modules": { 
					"$className": "Folder", 
					"@rbxts": { 
						"$path": "node_modules/@rbxts" 
					}
				}
			},
			"Packages": {
				"$path": "Packages"
			}
		}
	}
}`;

const serviceMap = {
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
};

const serviceParents = {
	StarterPlayerScripts: "StarterPlayer",
	StarterCharacterScripts: "StarterPlayer",
};

const lowerServiceMap = Object.fromEntries(Object.entries(serviceMap).map(([k, v]) => [k.toLowerCase(), v]));
const separatorRegex = new RegExp(`[\\.\\-_](${Object.keys(lowerServiceMap).join("|")})$`, "i");
const pascalCaseRegex = new RegExp(`(${Object.keys(serviceMap).join("|")})$`);

const toPosix = (p) => p.split(path.sep).join("/");
const isValidScript = (filename) =>
	/\.(tsx?|luau|lua)$/i.test(filename) && !filename.toLowerCase().endsWith(".d.ts");
const isInitFile = (filename) => isValidScript(filename) && /^(index|init)([\.-][a-z0-9_]+)?\./i.test(filename);

function pruneObject(node) {
	for (const key in node) {
		const val = node[key];
		if (typeof val !== "object" || val === null) continue;

		if (val.$path) {
			if (val.$path.startsWith(TS_PRESETS.outputDirectory) || val.$path.startsWith(LUAU_PRESETS.outputDirectory)) {
                continue; 
            }
			
			if (!fs.existsSync(path.resolve(process.cwd(), val.$path))) {
				delete node[key];
				continue;
			}
		}
		pruneObject(val);
	}
	return node;
}

function sortObject(obj) {
	if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return obj;
	return Object.keys(obj)
		.sort()
		.reduce((acc, key) => {
			acc[key] = sortObject(obj[key]);
			return acc;
		}, {});
}

function resolveRoute(relativePath, isInit, { emitLegacyScripts, isTsProject, outputDirectory, appendSuffix }) {
	const parts = relativePath.split(path.sep);
	const filename = parts.pop();
	const basename = path.basename(filename, path.extname(filename));

	let targetService = "ReplicatedStorage";
	const virtualParts = [];
	let lastRouteKeyword = null;

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
	let mappedService = null;

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
		// Scripts with non-legacy RunContext run incorrectly in StarterPlayer container.
		// Instead, always put them in ReplicatedStorage
		if (emitLegacyScripts === false && mappedService === "StarterPlayerScripts") {
			targetService = "ReplicatedStorage";
		} else {
			targetService = mappedService;
		}
	}

	let nodeName = basename;
	let projectPath = "";

	if (isInit) {
		const folderRelativePath = path.dirname(relativePath);
		projectPath = toPosix(path.join(outputDirectory, folderRelativePath));
		if (virtualParts.length > 0) {
			nodeName = virtualParts.pop();
			if (appendSuffix && lastRouteKeyword) {
				nodeName += `-${lastRouteKeyword}`;
			}
		} else {
			nodeName = lastRouteKeyword ? lastRouteKeyword : "source";
		}
	} else {
		let compiledRelativePath = relativePath;
		
		// Roblox-ts projects need to swap .ts/.tsx extensions to .luau
		if (isTsProject) {
			const compiledFilename = filename.replace(/\.tsx?$/i, ".luau");
			compiledRelativePath = path.join(path.dirname(relativePath), compiledFilename);
		}
		
		projectPath = toPosix(path.join(outputDirectory, compiledRelativePath));
		
		if (!appendSuffix && mappedService) {
			nodeName = basename.slice(0, -matchedSuffixLength);
		}
	}

	return { targetService, virtualParts, nodeName, projectPath };
}

function getOrCreateNode(parent, key, className) {
	if (!parent[key]) {
		parent[key] = className == null ? {} : { "$className": className };
	}
	return parent[key];
}

function walk(dir, callback) {
	if (!fs.existsSync(dir)) return;
	
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	const initFile = entries.find((e) => e.isFile() && isInitFile(e.name));

	if (initFile) {
		callback(path.join(dir, initFile.name), true);
		// Rojo automatically syncs the entire directory when mapped to an init file.
		// Return early so we don't create duplicate explicit entries for children.
		return;
	}

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(fullPath, callback);
		} else if (isValidScript(entry.name)) {
			callback(fullPath, false);
		}
	}
}

async function main() {
	const sourcePath = path.resolve(process.cwd(), BASE_CONFIG.sourceDirectory);
	if (!fs.existsSync(sourcePath)) {
		throw new Error(`Source directory not found: ${sourcePath}`);
	}

	const isTsProject = fs.existsSync(path.join(process.cwd(), "tsconfig.json"));
	const rojoTree = JSON.parse(ROJO_TREE_TEMPLATE);
	const context = {
		...BASE_CONFIG,
		...(isTsProject ? TS_PRESETS : LUAU_PRESETS),
		isTsProject,
		emitLegacyScripts: rojoTree.emitLegacyScripts ?? true,
		name: rojoTree.name ?? "unknown",
	};

	let fileCount = 0;
	walk(sourcePath, (filepath, isInit) => {
		fileCount++;

		const relativePath = path.relative(sourcePath, filepath);
		const { targetService, virtualParts, nodeName, projectPath } = resolveRoute(relativePath,  isInit, context);
		
		let current = rojoTree.tree;

		// Mount to service
		const parentService = serviceParents[targetService];
		if (parentService) {
			current = getOrCreateNode(current, parentService);
		}
		current = getOrCreateNode(current, targetService);

		// Optional wrapper folder
		if (context.wrapperFolder) {
			current = getOrCreateNode(current, context.wrapperFolder, "Folder");
		}

		// Build virtual folders
		for (const part of virtualParts) {
			current = getOrCreateNode(current, part, "Folder");
		}

		// Merge path
		current[nodeName] = { ...current[nodeName], $path: projectPath };
		if (current[nodeName]["$className"] === "Folder") {
			delete current[nodeName]["$className"];
		}
	});

	const prunedTree = pruneObject(rojoTree);
	const sortedTree = sortObject(prunedTree);
	const newContent = JSON.stringify(sortedTree, null, 2);

	// Prevent unnecessary file system writes
	if (fs.existsSync(context.projectFileName)) {
		const existingContent = fs.readFileSync(context.projectFileName, "utf-8");
		if (existingContent === newContent) {
			return;
		}
	}

	fs.writeFileSync(context.projectFileName, newContent);

	console.log(`\nSuccess! Generated Rojo tree for "${context.name}"`);
	console.log(`   Processed: ${fileCount} source files`);
	console.log(`   Output:    ${context.projectFileName}\n`);
}

main().catch((error) => {
	console.error(`\nBuild Failed: ${error.message}\n`);
	process.exit(1);
});
