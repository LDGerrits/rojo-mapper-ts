<div align="center">
	<h1>rbxts-feature-router</h1>
    <p>An automatic, file-system based router for roblox-ts. Organize feature logic in a single directory.</p>
</div>

## Why use it?
While **folder-by-type** (i.e. putting all components in one folder, all services in another) is simple, it becomes difficult to manage as projects grow, requiring you to jump between folders to edit one feature. 

**Folder-by-feature** (i.e. grouping all related files together) is superior for scaling, maintainability, and team collaboration. It makes it easier to add, modify, or delete features.

## Automatic Routing
The router determines a file's destination using three main strategies. Folder-based routing takes precedence over suffix-based routing.

### 1. Folder Context (Primary)
If a file is located within a folder named after a service or a keyword, it is automatically routed to that service.
* **Keywords:** `server`, `client`, `shared`
* **Services:** `ReplicatedFirst`, `ServerStorage`, `StarterGui`, etc.
* **Behavior:** All files and sub-folders within these directories inherit the target service.

### 2. Suffix Context (Secondary)
If a file is in a generic folder, the router inspects the filename for a suffix. This allows you to define a file's destination without moving it into a specific sub-folder.
* **Delimited Suffixes:** Use a separator such as a dot, hyphen, or underscore.
    - Examples: `auth.server.ts`, `input-client.ts`, `data_shared.ts`

* **PascalCase Suffixes:** Append the service name directly to the end of the filename.
    - Examples: `AuthServer.ts`, `InputClient.ts`, `DataShared.ts`

    **Note:** The router strips the suffix for the final Rojo object name. `AuthServer.ts` becomes `Auth` in Roblox. This can be stopped by doing `APPEND_ROUTE_SUFFIX = true` instead.

### 3. Default
If neither matches, the file defaults to `ReplicatedStorage`.

## Example Structure
```txt
src/
├── app/
│   ├── client/
│   │   ├── index.client.ts     -> Mounts to StarterPlayer/StarterPlayerScripts/TS/app/init.client.luau
│   │   └── app.tsx             -> Handled natively by Rojo inside the app module
│   ├── replicatedfirst/
│   │   ├── index.client.ts     -> Mounts to ReplicatedFirst/TS/app/init.client.luau
│   │   └── loader.ts			-> Handled natively by Rojo inside the app module
├── features/
│   ├── inventory/
│   │   ├── client/
│   │   │   ├── index.ts        -> Mounts to StarterPlayerScripts/TS/features/inventory/init.luau
│   │   │   └── ui.tsx          -> Handled natively by Rojo inside the inventory module
│   │   ├── server/
│   │   │   └── index.ts        -> Mounts to ServerScriptService/TS/features/inventory/init.luau
│   │   └── shared/
│   │       └── config.ts       -> Mounts to ReplicatedStorage/TS/features/inventory/config.luau
```

## Setup & Integration
Integrate the router into your workflow to ensure your `default.project.json` stays synchronized with your file system.

### 1. Install Dependencies
Copy the `feature-router.ts` script into your project (e.g. in the `tools/` directory).

Also, you will need a few development tools to handle the watching, routing and concurrent execution:
```bash
npm install -D tsx chokidar-cli concurrently
```

### 2. Update JSON Scripts
Add the following scripts to your package.json to automate the build process:
```json
"scripts": {
    "build": "tsx tools/feature-router.ts && rbxtsc",
    "watch": "concurrently \"chokidar src -c \\\"tsx tools/feature-router.ts\\\"\" \"rbxtsc -w\"",
    "dev": "npm run build && concurrently \"chokidar src -c \\\"tsx tools/feature-router.ts\\\"\" \"rbxtsc -w\" \"rojo serve\""
}
```

And make sure to add the following to your tsconfig.json:
```json
"exclude": [
	"tools"
]
```

### 3. Commands
* **npm run build:** Generates the latest project map and performs a single roblox-ts compilation.  
* **npm run watch:** Monitors your src directory. If you add or move a folder, the mapper instantly updates your Rojo project while rbxtsc handles the code compilation.  
* **npm run dev:** The dev command. It builds, compiles, starts all watchers, and launches the Rojo server all in one go.
