import * as vscode from "vscode";
import { CodeAtlasCli } from "./cliRunner";
import { CallerCodeLensProvider } from "./codelens/callerCodelens";
import { CodeAtlasStatusBar } from "./statusBar";
import { GraphWebviewPanel } from "./views/graphWebview";
import { ImpactViewProvider } from "./views/impactView";
import { SearchViewProvider } from "./views/searchView";
import { StatusViewProvider } from "./views/statusView";

let saveDebounceTimer: NodeJS.Timeout | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const cli = CodeAtlasCli.getInstance();
  cli.log("Activating CodeAtlas VS Code Extension...");

  // 1. Initialize Views
  const searchViewProvider = new SearchViewProvider(cli);
  const impactViewProvider = new ImpactViewProvider(cli);
  const statusViewProvider = new StatusViewProvider(cli);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("codeatlas.searchView", searchViewProvider),
    vscode.window.registerTreeDataProvider("codeatlas.impactView", impactViewProvider),
    vscode.window.registerTreeDataProvider("codeatlas.statusView", statusViewProvider)
  );

  // 2. Initialize CodeLens Provider
  const codeLensProvider = new CallerCodeLensProvider(cli);
  const supportedLanguages = [
    { language: "python", scheme: "file" },
    { language: "typescript", scheme: "file" },
    { language: "javascript", scheme: "file" },
    { language: "typescriptreact", scheme: "file" },
    { language: "javascriptreact", scheme: "file" },
    { language: "rust", scheme: "file" },
    { language: "go", scheme: "file" },
  ];
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(supportedLanguages, codeLensProvider)
  );

  // 3. Initialize Status Bar
  const statusBar = new CodeAtlasStatusBar(cli);
  context.subscriptions.push(statusBar);

  // Check initial availability and indexing status
  cli.checkAvailability().then(({ available, version, isIndexed }) => {
    cli.log(`CodeAtlas CLI detected: available=${available}, version=${version}, isIndexed=${isIndexed}`);
    statusBar.setReady(isIndexed);

    if (available && !isIndexed) {
      const config = vscode.workspace.getConfiguration("codeatlas");
      if (config.get<boolean>("autoIndex", true)) {
        vscode.window
          .showInformationMessage(
            "CodeAtlas: Workspace is not indexed. Index now for instant hybrid search and knowledge graph?",
            "Index Workspace",
            "Later"
          )
          .then((selection) => {
            if (selection === "Index Workspace") {
              vscode.commands.executeCommand("codeatlas.index");
            }
          });
      }
    }
  });

  // 4. Register Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("codeatlas.search", async (query?: string) => {
      await searchViewProvider.search(query);
      vscode.commands.executeCommand("codeatlas.searchView.focus");
    }),

    vscode.commands.registerCommand("codeatlas.impact", async (symbol?: string) => {
      await impactViewProvider.analyze(symbol);
      vscode.commands.executeCommand("codeatlas.impactView.focus");
    }),

    vscode.commands.registerCommand("codeatlas.impactCurrent", async () => {
      await impactViewProvider.analyze();
      vscode.commands.executeCommand("codeatlas.impactView.focus");
    }),

    vscode.commands.registerCommand("codeatlas.openViewer", async () => {
      await GraphWebviewPanel.createOrShow(context.extensionUri, cli);
    }),

    vscode.commands.registerCommand("codeatlas.refresh", () => {
      searchViewProvider.refresh();
      impactViewProvider.refresh();
      statusViewProvider.refresh();
      codeLensProvider.refresh();
      cli.checkAvailability().then(({ isIndexed }) => statusBar.setReady(isIndexed));
    }),

    vscode.commands.registerCommand("codeatlas.showQuickMenu", () => {
      statusBar.showQuickMenu();
    }),

    vscode.commands.registerCommand("codeatlas.index", async () => {
      statusBar.setIndexing();
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "CodeAtlas: Indexing Workspace...",
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: "Scanning AST, extracting symbols, and building graph..." });
          const res = await cli.index();
          if (res.success) {
            vscode.window.showInformationMessage("CodeAtlas: Workspace indexing complete!");
            statusBar.setReady(true);
          } else {
            vscode.window.showErrorMessage(`CodeAtlas indexing failed: ${res.message}`);
            statusBar.setReady(false);
          }
          searchViewProvider.refresh();
          impactViewProvider.refresh();
          statusViewProvider.refresh();
          codeLensProvider.refresh();
        }
      );
    }),

    vscode.commands.registerCommand("codeatlas.installHooks", async () => {
      try {
        const out = await cli.installHooks();
        vscode.window.showInformationMessage(`CodeAtlas Git Hooks: ${out.trim() || "Installed successfully!"}`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to install hooks: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand("codeatlas.uninstallHooks", async () => {
      try {
        const out = await cli.uninstallHooks();
        vscode.window.showInformationMessage(`CodeAtlas Git Hooks: ${out.trim() || "Removed successfully!"}`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to remove hooks: ${err.message}`);
      }
    })
  );

  // 5. Auto-reindex on File Save (Debounced)
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const config = vscode.workspace.getConfiguration("codeatlas");
      if (!config.get<boolean>("autoIndex", true)) {
        return;
      }

      // Ignore files outside workspace or hidden/.codeatlas files
      if (doc.uri.scheme !== "file" || doc.uri.fsPath.includes(".codeatlas") || doc.uri.fsPath.includes(".git")) {
        return;
      }

      if (saveDebounceTimer) {
        clearTimeout(saveDebounceTimer);
      }

      saveDebounceTimer = setTimeout(async () => {
        cli.log(`Auto-indexing triggered by save on ${doc.fileName}`);
        try {
          await cli.index();
          statusViewProvider.refresh();
          codeLensProvider.refresh();
        } catch {
          // Silent auto-index background failure
        }
      }, 4000);
    })
  );

  // 6. Listen for Configuration Changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("codeatlas.statusBarEnabled")) {
        statusBar.updateVisibility();
      }
      if (e.affectsConfiguration("codeatlas.codelensEnabled")) {
        codeLensProvider.refresh();
      }
    })
  );

  cli.log("CodeAtlas extension activated successfully.");
}

export function deactivate(): void {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
  }
}
