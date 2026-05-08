import * as fs from "fs";
import * as path from "path";

const BASE_PATH = path.join(__dirname, "../src");
const OUT_DIR_NAME = "out";
const PROJECT_NAME = "roblox-ts-game";
const APPEND_ROUTE_SUFFIX = false;
const WRAP_IN_TS_FOLDER = true;

/**
 * Directory keywords or file suffixes to Roblox services.
 */
const SERVICE_MAP: Record<string, string> = {
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
 * Parent-child relationships for specific services.
 */
const SERVICE_PARENTS: Record<string, string> = {
    StarterPlayerScripts: "StarterPlayer",
    StarterCharacterScripts: "StarterPlayer",
};

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
const toPascalCase = (str: string) =>
    str.toLowerCase() === "ui" ? "UI" : str.charAt(0).toUpperCase() + str.slice(1);

const isInitFile = (filename: string) => /^(init|index)([\.-][a-z0-9_]+)?\.(tsx?|luau|lua)$/i.test(filename);
const isScriptFile = (filename: string) => /\.(tsx?|luau|lua)$/i.test(filename);

function processFilePath(filepath: string, isInit: boolean) {
    const relativePath = path.relative(BASE_PATH, filepath);
    const parts = relativePath.split(path.sep);
    const filename = parts.pop()!;
    const ext = path.extname(filename);
    const basename = path.basename(filename, ext);
    const lowerName = basename.toLowerCase();

    let targetService = "ReplicatedStorage";
    const virtualParts: string[] = [];
    let lastRouteKeyword: string | null = null;

    // Route based on parent folder names
    for (const part of parts) {
        const lowerPart = part.toLowerCase();
        if (SERVICE_MAP[lowerPart]) {
            targetService = SERVICE_MAP[lowerPart];
            lastRouteKeyword = lowerPart;
        } else {
            virtualParts.push(part);
        }
    }

    // Override service if file has a specific suffix (.server, -client, etc.)
    const suffixMatch = lowerName.match(/[\.-]([a-z0-9_]+)$/);
    let foundSuffix: string | null = null;
    if (suffixMatch) {
        const suffix = suffixMatch[1];
        if (SERVICE_MAP[suffix]) {
            foundSuffix = suffix;
            // Only override the targetService if a parent folder hasn't already routed it.
            if (!lastRouteKeyword) {
                targetService = SERVICE_MAP[suffix];
            }
        }
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

        if (!APPEND_ROUTE_SUFFIX && foundSuffix) {
            const regex = new RegExp(`[\\.-]?${foundSuffix}$`, "i");
            nodeName = basename.replace(regex, "");
        }
    }

    return { targetService, virtualParts, nodeName, projectPath };
}

function walk(dir: string, callback: (filepath: string, isInit: boolean) => void) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    const initFile = entries.find(e => e.isFile() && isInitFile(e.name));
    if (initFile) {
        const fullPath = path.join(dir, initFile.name);
        callback(fullPath, true);
        return;
    }
    
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(fullPath, callback);
        } else if (entry.isFile() && isScriptFile(entry.name)) {
            callback(fullPath, isInitFile(entry.name));
        }
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
console.log("✅ default.project.json generated.");
