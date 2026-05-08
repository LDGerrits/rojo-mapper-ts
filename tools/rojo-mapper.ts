import * as fs from "fs";
import * as path from "path";

const BASE_PATH = path.join(__dirname, "../src");
const OUT_DIR_NAME = "out";
const PROJECT_NAME = "roblox-ts-game";
const APPEND_ROUTE_SUFFIX = false;

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

const SERVICE_PARENTS: Record<string, string> = {
    StarterPlayerScripts: "StarterPlayer",
    StarterCharacterScripts: "StarterPlayer",
};

const toPosix = (p: string) => p.split(path.sep).join("/");
const toPascalCase = (str: string) =>
    str.toLowerCase() === "ui" ? "UI" : str.charAt(0).toUpperCase() + str.slice(1);

const isInitFile = (filename: string) => /^(init|index)(\.(server|client))?\.(luau|lua|tsx?)$/i.test(filename);
const isScriptFile = (filename: string) => /\.(luau|lua|tsx?)$/i.test(filename);

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

    for (const part of parts) {
        const lowerPart = part.toLowerCase();
        if (SERVICE_MAP[lowerPart]) {
            targetService = SERVICE_MAP[lowerPart];
            lastRouteKeyword = lowerPart;
        } else {
            virtualParts.push(part);
        }
    }

    if (!isInit) {
        if (lowerName.endsWith(".server") || lowerName.endsWith("server")) {
            targetService = "ServerScriptService";
        } else if (lowerName.endsWith(".client") || lowerName.endsWith("client")) {
            targetService = "StarterPlayerScripts";
        }
    }

    let nodeName = basename;
    const compiledRelativePath = relativePath.replace(/\.tsx?$/i, ".luau");
    let projectPath = toPosix(path.join(OUT_DIR_NAME, compiledRelativePath));

    if (isInit) {
        projectPath = toPosix(path.dirname(projectPath));
        if (virtualParts.length > 0) {
            nodeName = virtualParts.pop()!;
            if (APPEND_ROUTE_SUFFIX && lastRouteKeyword) {
                if (lastRouteKeyword === "server") nodeName += "-server";
                if (lastRouteKeyword === "client") nodeName += "-client";
            }
        } else {
            nodeName = lastRouteKeyword ? toPascalCase(lastRouteKeyword) : "Source";
        }
    } else {
        if (!APPEND_ROUTE_SUFFIX) {
            nodeName = basename.replace(/[\.-]?(server|client)$/i, "");
        }
    }

    return { targetService, virtualParts, nodeName, projectPath };
}

const projectTree: any = {
    name: PROJECT_NAME,
    globIgnorePaths: [ "**/package.json", "**/tsconfig.json" ],
    tree: {
        $className: "DataModel",
        Workspace: {
            $className: "Workspace",
            "$properties": { "FilteringEnabled": true }
        },
        HttpService: {
            $className: "HttpService",
            "$properties": { "HttpEnabled": true }
        },
        SoundService: {
            $className: "SoundService",
            "$properties": { "RespectFilteringEnabled": true }
        },
        ReplicatedStorage: { 
            $className: "ReplicatedStorage", 
            $ignoreUnknownInstances: true,
            rbxts_include: {
                $path: "include",
                node_modules: {
                    $className: "Folder",
                    "@rbxts": { $path: "node_modules/@rbxts" }
                }
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

function walk(dir: string, callback: (filepath: string, isInit: boolean) => void) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const initFile = entries.find((e) => e.isFile() && isInitFile(e.name));

    if (initFile) {
        callback(path.join(dir, initFile.name), true);
        return;
    }
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(fullPath, callback);
        else if (entry.isFile() && isScriptFile(entry.name)) callback(fullPath, false);
    }
}

walk(BASE_PATH, (filepath: string, isInit: boolean) => {
    const { targetService, virtualParts, nodeName, projectPath } = processFilePath(filepath, isInit);

    let current: any = projectTree.tree;
    const parentService = SERVICE_PARENTS[targetService];

    if (parentService) {
        current[parentService] ??= { $className: parentService, $ignoreUnknownInstances: true };
        current = current[parentService];
    }

    current[targetService] ??= { $className: targetService, $ignoreUnknownInstances: true };
    current = current[targetService];
    current.TS ??= { $className: "Folder" };
    current = current.TS;

    for (const part of virtualParts) {
        current[part] ??= { $className: "Folder", $ignoreUnknownInstances: true };
        current = current[part];
    }

    current[nodeName] = { $path: projectPath };
});

fs.writeFileSync("default.project.json", JSON.stringify(projectTree, null, 2));
console.log("✅ default.project.json generated.");
