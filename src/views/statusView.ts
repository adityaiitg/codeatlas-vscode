import * as path from "path";
import * as vscode from "vscode";
import { CodeAtlasCli } from "../cliRunner";
import { CodeAtlasStatus } from "../types";

export class StatusTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly itemType: "metric" | "action" | "group",
    public readonly commandId?: string,
    public readonly iconName?: string,
    public readonly descriptionText?: string
  ) {
    super(label, collapsibleState);

    if (descriptionText) {
      this.description = descriptionText;
    }

    if (iconName) {
      this.iconPath = new vscode.ThemeIcon(iconName);
    }

    if (commandId) {
      this.command = {
        command: commandId,
        title: label,
      };
    }
  }
}

export class StatusViewProvider implements vscode.TreeDataProvider<StatusTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<StatusTreeItem | undefined | null | void> =
    new vscode.EventEmitter<StatusTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<StatusTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private status: CodeAtlasStatus | null = null;
  private isLoading: boolean = false;

  constructor(private cli: CodeAtlasCli) {}

  public refresh(): void {
    this.status = null;
    this._onDidChangeTreeData.fire();
  }

  public getTreeItem(element: StatusTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: StatusTreeItem): Promise<StatusTreeItem[]> {
    if (!element) {
      if (!this.status && !this.isLoading) {
        this.isLoading = true;
        try {
          this.status = await this.cli.getStatus();
        } catch {
          this.status = null;
        } finally {
          this.isLoading = false;
        }
      }

      const s = this.status;
      const isIndexed = s?.is_indexed ?? false;
      const rootFolder = path.basename(this.cli.getWorkspaceRoot());

      const items: StatusTreeItem[] = [];

      // Status header
      const statusLabel = isIndexed ? "Status: Indexed" : "Status: Not Indexed";
      const statusIcon = isIndexed ? "check" : "circle-slash";
      const statusItem = new StatusTreeItem(
        statusLabel,
        vscode.TreeItemCollapsibleState.None,
        "metric",
        undefined,
        statusIcon,
        rootFolder
      );
      if (isIndexed) {
        statusItem.iconPath = new vscode.ThemeIcon("pass-filled", new vscode.ThemeColor("charts.green"));
      } else {
        statusItem.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("charts.yellow"));
      }
      items.push(statusItem);

      if (isIndexed) {
        if (s?.files !== undefined) {
          items.push(
            new StatusTreeItem("Indexed Files", vscode.TreeItemCollapsibleState.None, "metric", undefined, "files", `${s.files}`)
          );
        }
        if (s?.symbols !== undefined) {
          items.push(
            new StatusTreeItem("Symbols & Classes", vscode.TreeItemCollapsibleState.None, "metric", undefined, "symbol-class", `${s.symbols}`)
          );
        }
        if (s?.edges !== undefined) {
          items.push(
            new StatusTreeItem("Graph Edges", vscode.TreeItemCollapsibleState.None, "metric", undefined, "git-branch", `${s.edges}`)
          );
        }
        if (s?.db_size) {
          items.push(
            new StatusTreeItem("Index Database Size", vscode.TreeItemCollapsibleState.None, "metric", undefined, "database", s.db_size)
          );
        }
      }

      // Quick Actions group
      const actionsGroup = new StatusTreeItem(
        "Quick Actions",
        vscode.TreeItemCollapsibleState.Expanded,
        "group",
        undefined,
        "tools"
      );
      items.push(actionsGroup);

      return items;
    }

    if (element.itemType === "group") {
      return [
        new StatusTreeItem(
          "Re-index Workspace",
          vscode.TreeItemCollapsibleState.None,
          "action",
          "codeatlas.index",
          "database",
          "Incremental scan"
        ),
        new StatusTreeItem(
          "Open Knowledge Graph",
          vscode.TreeItemCollapsibleState.None,
          "action",
          "codeatlas.openViewer",
          "graph",
          "Interactive viewer"
        ),
        new StatusTreeItem(
          "Search Codebase",
          vscode.TreeItemCollapsibleState.None,
          "action",
          "codeatlas.search",
          "search",
          "Hybrid retrieval"
        ),
        new StatusTreeItem(
          "Analyze Impact (Blast Radius)",
          vscode.TreeItemCollapsibleState.None,
          "action",
          "codeatlas.impact",
          "pulse",
          "Call graph analysis"
        ),
        new StatusTreeItem(
          "Install Background Git Hooks",
          vscode.TreeItemCollapsibleState.None,
          "action",
          "codeatlas.installHooks",
          "git-commit",
          "Auto-index on commit"
        ),
      ];
    }

    return [];
  }
}
