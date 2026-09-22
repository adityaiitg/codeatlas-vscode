import * as vscode from "vscode";
import { CodeAtlasCli } from "./cliRunner";

export class CodeAtlasStatusBar {
  private item: vscode.StatusBarItem;

  constructor(private cli: CodeAtlasCli) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.command = "codeatlas.showQuickMenu";
    this.setReady();
  }

  public setReady(isIndexed: boolean = true): void {
    if (isIndexed) {
      this.item.text = "$(database) CodeAtlas";
      this.item.tooltip = "CodeAtlas: Ready (Click for quick menu)";
      this.item.backgroundColor = undefined;
    } else {
      this.item.text = "$(warning) CodeAtlas";
      this.item.tooltip = "CodeAtlas: Not Indexed (Click to index workspace)";
      this.item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
    }
    this.updateVisibility();
  }

  public setIndexing(): void {
    this.item.text = "$(sync~spin) CodeAtlas: Indexing...";
    this.item.tooltip = "CodeAtlas is incrementally indexing workspace";
    this.item.backgroundColor = undefined;
    this.updateVisibility();
  }

  public updateVisibility(): void {
    const config = vscode.workspace.getConfiguration("codeatlas");
    if (config.get<boolean>("statusBarEnabled", true)) {
      this.item.show();
    } else {
      this.item.hide();
    }
  }

  public async showQuickMenu(): Promise<void> {
    const items: Array<{
      label: string;
      description: string;
      command: string;
    }> = [
      {
        label: "$(search) Search Codebase",
        description: "Hybrid BM25 + Semantic + Graph search",
        command: "codeatlas.search",
      },
      {
        label: "$(pulse) Analyze Change Impact",
        description: "Calculate caller blast radius for a symbol",
        command: "codeatlas.impact",
      },
      {
        label: "$(graph) Open Knowledge Graph",
        description: "Interactive visual network map",
        command: "codeatlas.openViewer",
      },
      {
        label: "$(database) Re-index Workspace",
        description: "Trigger incremental background scan",
        command: "codeatlas.index",
      },
      {
        label: "$(refresh) Refresh Views",
        description: "Reload search, impact, and status panels",
        command: "codeatlas.refresh",
      },
      {
        label: "$(git-commit) Install Background Git Hooks",
        description: "Automatically re-index on git commit & checkout",
        command: "codeatlas.installHooks",
      },
    ];

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: "CodeAtlas Code Intelligence Actions",
    });

    if (pick) {
      vscode.commands.executeCommand(pick.command);
    }
  }

  public dispose(): void {
    this.item.dispose();
  }
}
