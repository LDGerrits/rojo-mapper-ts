<div align="center">
	<h1>rbxts-feature-router</h1>
    <p>A feature-based structure generator for roblox-ts. Automatically route server, client, and shared logic from feature-local folders to their designated Roblox services.</p>
</div>

## Why use it?
While folder-by-type (i.e. putting all components in one folder, all services in another) is simple, it becomes difficult to manage as projects grow, requiring you to jump between folders to edit one feature. Folder-by-feature (i.e. grouping all related files together) is generally superior for scaling, maintainability, and team collaboration; it makes it easier to add, modify, or delete features.

## Features
* **Automatic Folder Routing:** Folders named 'server', 'client', 'shared', or specific Roblox services (e.g. 'replicatedfirst') automatically map to their respective Roblox services.
* **Suffix Teleportation:** Use '-server.ts', '-client.ts', or service suffixes (e.g., '-startergui.ts') to send files to specific services regardless of their physical folder location.  

## Example structure
```txt
src/
├── app/
│   ├── client/
│   │   ├── index.client.ts     -> Mounts to StarterPlayer/StarterPlayerScripts/TS/app/init.client.luau
│   │   └── app.tsx             -> Handled natively by Rojo inside the app module
│   ├── replicatedfirst/
│   │   ├── index.client.ts     -> Mounts to ReplicatedFirst/TS/app/init.client.luau
│   │   └── loader.ts  -> Handled natively by Rojo inside the app module
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
To get the most out of rbxts-feature-router, you should integrate it directly into your npm workflow so the `default.project.json` updates automatically as you code.

### 1. Install Dependencies
Copy the `feature-router.ts` script into your project (e.g. in the `tools/` directory).

Also, you will need a few development tools to handle the mapping, watching, and concurrent execution:
```bash
npm install -D tsx chokidar-cli concurrently
```

### 2. Update package.json Scripts
Add the following scripts to your package.json to automate the build process:
```bash
"scripts": {
    "build": "tsx tools/feature-router.ts && rbxtsc",
    "watch": "concurrently \"chokidar src -c \\\"tsx tools/feature-router.ts\\\"\" \"rbxtsc -w\"",
    "dev": "npm run build && concurrently \"chokidar src -c \\\"tsx tools/feature-router.ts\\\"\" \"rbxtsc -w\" \"rojo serve\""
}
```

### 3. Command Overview
* **npm run build:** Generates the latest project map and performs a single roblox-ts compilation.  
* **npm run watch:** Monitors your src directory. If you add or move a folder, the mapper instantly updates your Rojo project while rbxtsc handles the code compilation.  
* **npm run dev:** The dev command. It maps, compiles, starts all watchers, and launches the Rojo server in one go.
