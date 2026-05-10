import * as fs from "fs";
import * as path from "path";

const BASE_PATH = path.join(__dirname, "../src");
const OUT_DIR_NAME = "out";
const PROJECT_NAME = "roblox-ts-game";
const APPEND_ROUTE_SUFFIX = false;
const WRAP_IN_TS_FOLDER = true;

/**
 * Folder routing (case-insensitive)
 */
const FOLDER_MAP: Record<string, string> = {
    server: "ServerScriptService",
    client: "StarterPlayerScripts",
    shared: "ReplicatedStorage",
    serverscriptservice: "ServerScriptService",
    replicatedstorage: "ReplicatedStorage",
    replicatedfirst: "ReplicatedFirst",
    serverstorage: "ServerStorage",
    startergui: "StarterGui",
    starterpack: "StarterPack",
    starterplayerscripts: "StarterPlayerScripts",
    startercharacterscripts: "StarterCharacterScripts",
};

/**
 * PascalCase matching at the end of file names (case-sensitive)
 */
const EXACT_SUFFIX_MAP: Record<string, string> = {
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

/**
 * Parent-child relationships for specific services
 */
const SERVICE_PARENTS: Record<string, string> = {
    StarterPlayerScripts: "StarterPlayer",
    StarterCharacterScripts: "StarterPlayer",
};

const folderKeys = Object.keys(FOLDER_MAP).join("|");
const exactKeys = Object.keys(EXACT_SUFFIX_MAP).join("|");

// Matches separators (case-insensitive): -server, .client, _SHARED 
const SEPARATOR_REGEX = new RegExp(`[\\.\\-_](${folderKeys})$`, "i");

// Matches appended words (case-sensitive): DataServer, AuthClient 
const PASCAL_REGEX = new RegExp(`(${exactKeys})$`);

const PROJECT_TREE: any = {
    name: PROJECT_NAME,
    globIgnorePaths: [ "**/package.json", "**/tsconfig.json" ],
    tree: {
        $className: "DataModel",
        Workspace: { $className: "Workspace", "$properties": { "FilteringEnabled": true } },
        HttpService: { $className: "HttpService", "$properties": { "HttpEnabled": true } },
        SoundService: { $className: "SoundService", "$properties": { "RespectFilteringEnabled": true } },
        ReplicatedStorage: { 
            $className: "ReplicatedStorage", 
            $ignoreUnknownInstances: true,
            rbxts_include: {
                $path: "include",
                node_modules: { $className: "Folder", "@rbxts": { $path: "node_modules/@rbxts" } }
            }
        },
        ServerScriptService: { $className: "ServerScriptService", $ignoreUnknownInstances: true },
        StarterPlayer: {
            $className: "StarterPlayer",
            $ignoreUnknownInstances: true,
            StarterPlayerScripts: { $className: "StarterPlayerScripts", $ignoreUnknownInstances: true },
        },
    },
};

const toPosix = (p: string) => p.split(path.sep).join("/");
const isValidScript = (filename: string) => 
    /\.(tsx?|luau|lua)$/i.test(filename) && !filename.toLowerCase().endsWith(".d.ts");
const isInitFile = (filename: string) => 
    isValidScript(filename) && /^(index|init)([\.-][a-z0-9_]+)?\./i.test(filename);
const isScriptFile = (filename: string) => isValidScript(filename);

function processFilePath(filepath: string, isInit: boolean) {
    const relativePath = path.relative(BASE_PATH, filepath);
    const parts = relativePath.split(path.sep);
    const filename = parts.pop()!;
    const ext = path.extname(filename);
    const basename = path.basename(filename, ext);

    let targetService = "ReplicatedStorage";
    const virtualParts: string[] = [];
    let lastRouteKeyword: string | null = null;

    // Folder name routing
    for (const part of parts) {
        const lowerPart = part.toLowerCase();
        if (FOLDER_MAP[lowerPart]) {
            targetService = FOLDER_MAP[lowerPart];
            lastRouteKeyword = lowerPart;
        } else {
            virtualParts.push(part);
        }
    }

    // Suffix routing
    let foundSuffix: string | null = null;
    let matchedSuffixLength = 0;
    let mappedService: string | null = null;
    const sepMatch = basename.match(SEPARATOR_REGEX);
    if (sepMatch) {
        // Separator match
        foundSuffix = sepMatch[1]; 
        mappedService = FOLDER_MAP[foundSuffix.toLowerCase()];
        matchedSuffixLength = sepMatch[0].length;
    } else {
        // PascalCase
        const pascalMatch = basename.match(PASCAL_REGEX);
        if (pascalMatch) {
            foundSuffix = pascalMatch[1]; 
            mappedService = EXACT_SUFFIX_MAP[foundSuffix];
            matchedSuffixLength = pascalMatch[0].length;
        }
    }

    // Only override the targetService if a parent folder hasn't already routed it
    if (mappedService && !lastRouteKeyword) {
        targetService = mappedService;
    }

    let nodeName = basename;
    let projectPath = "";
    if (isInit) {
        // Init files represent their parent folder in Rojo
        const folderRelativePath = path.dirname(relativePath);
        projectPath = toPosix(path.join(OUT_DIR_NAME, folderRelativePath));

        if (virtualParts.length > 0) {
            nodeName = virtualParts.pop()!;
            if (APPEND_ROUTE_SUFFIX && lastRouteKeyword) {
                nodeName += `-${lastRouteKeyword}`; 
            }
        } else {
            nodeName = lastRouteKeyword ? lastRouteKeyword : "source";
        }
    } else {
        // Standard mapping
        const compiledFilename = filename.replace(/\.tsx?$/i, ".luau");
        const compiledRelativePath = path.join(path.dirname(relativePath), compiledFilename);
        projectPath = toPosix(path.join(OUT_DIR_NAME, compiledRelativePath));

        if (!APPEND_ROUTE_SUFFIX && mappedService) {
            nodeName = basename.slice(0, -matchedSuffixLength);
        }
    }

    return { targetService, virtualParts, nodeName, projectPath };
}

function walk(dir: string, callback: (filepath: string, isInit: boolean) => void) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    const files = entries.filter(e => e.isFile());
    const folders = entries.filter(e => e.isDirectory());

    const initFile = files.find(e => isInitFile(e.name));
    if (initFile) {
        callback(path.join(dir, initFile.name), true);
        return;
    }

    for (const file of files) {
        if (!initFile && isScriptFile(file.name)) {
            callback(path.join(dir, file.name), false);
        }
    }

    for (const folder of folders) {
        walk(path.join(dir, folder.name), callback);
    }
}

walk(BASE_PATH, (filepath, isInit) => {
    const { targetService, virtualParts, nodeName, projectPath } = processFilePath(filepath, isInit);
    let current = PROJECT_TREE.tree;
    const parentService = SERVICE_PARENTS[targetService];

    // Ensure parent services exist
    if (parentService) {
        current[parentService] ??= { $className: parentService, $ignoreUnknownInstances: true };
        current = current[parentService];
    }

    // Mount to the specific service
    current[targetService] ??= { $className: targetService, $ignoreUnknownInstances: true };
    current = current[targetService];
    
    if (WRAP_IN_TS_FOLDER) {
        current.TS ??= { $className: "Folder" };
        current = current.TS;
    }

    // Build virtual folder hierarchy
    for (const part of virtualParts) {
        current[part] ??= { $className: "Folder", $ignoreUnknownInstances: true };
        current = current[part];
    }

    current[nodeName] = { $path: projectPath };
});

fs.writeFileSync("default.project.json", JSON.stringify(PROJECT_TREE, null, 2));
console.log("Process complete: default.project.json has been successfully generated.");
