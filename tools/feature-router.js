const fs = require("fs");
const path = require("path");

const isTsProject = fs.existsSync(path.join(process.cwd(), "tsconfig.json"));

/**
 * SETTINGS
 * 
 * These settings dictate the structure of your Rojo project. 
 * Defaults are dynamically toggled based on whether a 'tsconfig.json' is detected.
 * 
 * OVERRIDES:
 * - If your TS project compiles to a folder other than 'out', change outputDirectory.
 * - If you want your Luau code wrapped in a specific folder, set wrapperFolder.
 */
const SETTINGS = {
	// The name of the file to be generated
	projectFileName: "default.project.json",

	// The folder containing your source code (relative to the root)
    sourceDirectory: "src",

	// TS compiles to 'out', while Luau generally references 'src' directly (relative to the root)
    outputDirectory: isTsProject ? "out" : "src",

	// TS typically wraps scripts in a 'TS' folder; Luau devs usually don't
	wrapperFolder: isTsProject ? "TS" : false,

	// 'true' keeps and adds suffixes (e.g. inventory-server); 'false' strips them (e.g. inventory)
	appendSuffix: false,
};

/**
 * ROJO PROJECT TEMPLATE
 * 
 * Compatible with roblox-ts and Luau (Wally).
 * The script dynamically injects paths into this tree and then 
 * prunes any nodes whose $path does not exist on your disk.
 * See Rojo Project Format for more details (https://rojo.space/docs/v7/)
 *
 * CONFIGURATION GUIDE:
 *  1. Services: Add services (Workspace, Lighting, etc.) here to set specific properties.
 *  2. Assets: Manually define paths to .rbxm models, sounds, or meshes.
 *  3. Packages: Includes default paths for node_modules and Wally.
 *     - Unused package folders are automatically pruned.
 *     - TS users: Some packages like React require specific node_module mappings to get them to work
 * 
 * NOTE:
 * Entries defined here take priority. If a file in 'src' maps to a node name already manually 
 * defined here, the script will merge the two (adding the $path to the existing node).
 */
const ROJO_TREE = `{
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
const rojoTree = JSON.parse(ROJO_TREE);
const sourcePath = path.resolve(process.cwd(), SETTINGS.sourceDirectory);

const toPosix = (p) => p.split(path.sep).join("/");
const isValidScript = (filename) =>
	/\.(tsx?|luau|lua)$/i.test(filename) && !filename.toLowerCase().endsWith(".d.ts");
const isInitFile = (filename) => isValidScript(filename) && /^(index|init)([\.-][a-z0-9_]+)?\./i.test(filename);

function getOrCreateNode(parent, key, className) {
	if (!parent[key]) {
        parent[key] = className == null ? {} : { "$className": className };
    }
    return parent[key];
}

function pruneObject(node) {
    Object.keys(node).forEach(key => {
        const value = node[key];
        if (typeof value === 'object' && value !== null) {
            if (value['$path']) {
                const fullPath = path.resolve(process.cwd(), value['$path']);
                if (!fs.existsSync(fullPath)) {
                    delete node[key];
					console.log(`pruned: ${fullPath}\n`);
                    return;
                }
            }
            pruneObject(value);
        }
    });
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

function processFilePath(filepath, isInit) {
	const relativePath = path.relative(sourcePath, filepath);
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
		// Scripts with non-legacy run context run incorrectly in StarterPlayer container.
		// Instead, always put them in ReplicatedStorage
        const emitLegacyScripts = rojoTree.emitLegacyScripts ?? true;
		if (emitLegacyScripts == false && mappedService == "StarterPlayerScripts") {
			targetService = "ReplicatedStorage";
		} else {
			targetService = mappedService;
			console.log(`suffix matched to: ${targetService}\n`);
		}
	}

	let nodeName = basename;
	let projectPath = "";

	if (isInit) {
		const folderRelativePath = path.dirname(relativePath);
		projectPath = toPosix(path.join(SETTINGS.outputDirectory, folderRelativePath));
		if (virtualParts.length > 0) {
			nodeName = virtualParts.pop();
			if (SETTINGS.appendSuffix && lastRouteKeyword) {
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
        
        projectPath = toPosix(path.join(SETTINGS.outputDirectory, compiledRelativePath));
        
        if (!SETTINGS.appendSuffix && mappedService) {
            nodeName = basename.slice(0, -matchedSuffixLength);
        }
	}

	return { targetService, virtualParts, nodeName, projectPath };
}

function walk(dir, callback) {
	if (!fs.existsSync(dir)) return;
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	const files = entries.filter((e) => e.isFile());
	const folders = entries.filter((e) => e.isDirectory());

	const initFile = files.find((e) => isInitFile(e.name));
	if (initFile) {
		callback(path.join(dir, initFile.name), true);
		// Rojo automatically syncs the entire directory when mapped to an init file.
        // Return early so we don't create duplicate explicit entries for children.
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

if (!fs.existsSync(sourcePath)) {
	console.error(`Error: src path not found: ${sourcePath}`);
	process.exit(1);
}

let fileCount = 0;
walk(sourcePath, (filepath, isInit) => {
	fileCount++;
	const { targetService, virtualParts, nodeName, projectPath } = processFilePath(filepath, isInit);
	let current = rojoTree.tree;

	// Mount to Service
	const parentService = serviceParents[targetService];
	if (parentService) {
		current = getOrCreateNode(current, parentService);
	}
	current = getOrCreateNode(current, targetService);

	// Mount to wrapper folder
	if (SETTINGS.wrapperFolder) {
		current = getOrCreateNode(current, SETTINGS.wrapperFolder, "Folder");
	}

	// Build virtual folders
	for (const part of virtualParts) {
		current = getOrCreateNode(current, part, "Folder");
	}

	// Merge path
	current[nodeName] = current[nodeName] || {};
    current[nodeName]["$path"] = projectPath;
	if (current[nodeName]["$className"] === "Folder") {
        delete current[nodeName]["$className"];
    }
});

const prunedTree = pruneObject(rojoTree);
const sortedTree = sortObject(prunedTree);
const newContent = JSON.stringify(sortedTree, null, 2);

if (fs.existsSync(SETTINGS.projectFileName)) {
    const existingContent = fs.readFileSync(SETTINGS.projectFileName, "utf-8");
    if (existingContent === newContent) {
        return;
    }
}

fs.writeFileSync(SETTINGS.projectFileName, newContent);

console.log(`\nRojo project ${rojoTree.name} generated successfully!`);
console.log(`Processed ${fileCount} source files.`);
console.log(`Output: ${SETTINGS.projectFileName}\n`);
