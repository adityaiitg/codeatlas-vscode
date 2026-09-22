import * as path from "path";
import * as vscode from "vscode";
import { CodeAtlasCli } from "../cliRunner";
import { SearchResultItem } from "../types";

export class SearchTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly result?: SearchResultItem,
    public readonly detailType?: "snippet" | "neighbor",
    public readonly neighborData?: {
      kind: string;
      name: string;
      file_path: string;
      start_line: number;
    }
  ) {
    super(label, collapsibleState);

    if (result && !detailType) {
      this.tooltip = `${result.file_path}:${result.start_line}-${result.end_line}\nScore: ${result.score.toFixed(4)}`;
      this.description = `L${result.start_line}-${result.end_line} • ${(result.score * 100).toFixed(1)}%`;
      this.iconPath = result.is_definition
        ? new vscode.ThemeIcon("symbol-class", new vscode.ThemeColor("charts.green"))
        : new vscode.ThemeIcon("code", new vscode.ThemeColor("charts.blue"));

      // Click opens file at line
      this.command = {
        command: "vscode.open",
        title: "Open File",
        arguments: [
          vscode.Uri.file(result.file_path),
          {
            selection: new vscode.Range(
              Math.max(0, result.start_line - 1),
              0,
              Math.max(0, result.end_line - 1),
              0
            ),
          },
        ],
      };
    } else if (detailType === "snippet") {
      this.iconPath = new vscode.ThemeIcon("file-code");
      this.contextValue = "snippet";
    } else if (detailType === "neighbor" && neighborData) {
      this.iconPath = new vscode.ThemeIcon("references", new vscode.ThemeColor("charts.purple"));
      this.tooltip = `${neighborData.kind}: ${neighborData.name} in ${neighborData.file_path}:${neighborData.start_line}`;
      this.description = `${neighborData.kind} • L${neighborData.start_line}`;
      this.command = {
        command: "vscode.open",
        title: "Open Neighbor File",
        arguments: [
          vscode.Uri.file(neighborData.file_path),
          {
            selection: new vscode.Range(
              Math.max(0, neighborData.start_line - 1),
              0,
              Math.max(0, neighborData.start_line - 1),
              0
            ),
          },
        ],
      };
    }
  }
}

export class SearchViewProvider implements vscode.TreeDataProvider<SearchTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<SearchTreeItem | undefined | null | void> =
    new vscode.EventEmitter<SearchTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<SearchTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private currentQuery: string = "";
  private results: SearchResultItem[] = [];
  private isLoading: boolean = false;
  private errorMessage: string | null = null;

  constructor(private cli: CodeAtlasCli) {}

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  public async search(query?: string): Promise<void> {
    if (!query) {
      query = await vscode.window.showInputBox({
        prompt: "Search codebase using CodeAtlas hybrid retrieval",
        placeHolder: "e.g. authentication token verification or SymbolName",
        value: this.currentQuery,
      });
    }

    if (!query || !query.trim()) {
      return;
    }

    this.currentQuery = query.trim();
    this.isLoading = true;
    this.errorMessage = null;
    this.refresh();

    try {
      this.results = await this.cli.search(this.currentQuery);
      this.isLoading = false;
      this.refresh();

      if (this.results.length === 0) {
        vscode.window.showInformationMessage(`CodeAtlas: No results found for "${this.currentQuery}"`);
      }
    } catch (err: any) {
      this.isLoading = false;
      if (err.message === "NOT_INDEXED") {
        this.errorMessage = "Workspace not indexed yet. Click 'Index' to start.";
        const choice = await vscode.window.showWarningMessage(
          "CodeAtlas index not found for this workspace. Would you like to index it now?",
          "Index Workspace",
          "Cancel"
        );
        if (choice === "Index Workspace") {
          vscode.commands.executeCommand("codeatlas.index");
        }
      } else {
        this.errorMessage = `Search failed: ${err.message}`;
        vscode.window.showErrorMessage(`CodeAtlas search error: ${err.message}`);
      }
      this.refresh();
    }
  }

  public getTreeItem(element: SearchTreeItem): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: SearchTreeItem): Thenable<SearchTreeItem[]> {
    if (this.isLoading) {
      return Promise.resolve([
        new SearchTreeItem(
          `Searching "${this.currentQuery}"...`,
          vscode.TreeItemCollapsibleState.None
        ),
      ]);
    }

    if (this.errorMessage) {
      const errItem = new SearchTreeItem(
        this.errorMessage,
        vscode.TreeItemCollapsibleState.None
      );
      errItem.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("charts.yellow"));
      return Promise.resolve([errItem]);
    }

    if (!element) {
      if (this.results.length === 0) {
        if (!this.currentQuery) {
          const item = new SearchTreeItem(
            "Click search icon or run 'CodeAtlas: Search Codebase'",
            vscode.TreeItemCollapsibleState.None
          );
          item.iconPath = new vscode.ThemeIcon("search");
          return Promise.resolve([item]);
        }
        return Promise.resolve([
          new SearchTreeItem(
            `No matches for "${this.currentQuery}"`,
            vscode.TreeItemCollapsibleState.None
          ),
        ]);
      }

      // Root search result items
      return Promise.resolve(
        this.results.map((r, idx) => {
          const fileName = path.basename(r.file_path);
          const symName = r.symbol_id ? r.symbol_id.split(":").pop() : "";
          const title = symName
            ? `${symName} (${fileName})`
            : `${fileName}:${r.start_line}`;

          const label = `${idx + 1}. ${title}${r.is_definition ? " [DEF]" : ""}`;
          const hasChildren = Boolean(r.content || (r.neighbors && r.neighbors.length > 0));

          return new SearchTreeItem(
            label,
            hasChildren
              ? vscode.TreeItemCollapsibleState.Collapsed
              : vscode.TreeItemCollapsibleState.None,
            r
          );
        })
      );
    }

    // Children of a search result: snippet lines and graph neighbors
    const children: SearchTreeItem[] = [];
    if (element.result) {
      const r = element.result;

      // First few lines of code preview
      if (r.content) {
        const previewLines = r.content
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
          .slice(0, 3);

        for (const line of previewLines) {
          const snippetItem = new SearchTreeItem(
            line.length > 60 ? `${line.slice(0, 60)}...` : line,
            vscode.TreeItemCollapsibleState.None,
            r,
            "snippet"
          );
          children.push(snippetItem);
        }
      }

      // Graph neighbors
      if (r.neighbors && r.neighbors.length > 0) {
        for (const n of r.neighbors.slice(0, 5)) {
          const neighborItem = new SearchTreeItem(
            `${n.name}`,
            vscode.TreeItemCollapsibleState.None,
            r,
            "neighbor",
            n
          );
          children.push(neighborItem);
        }
      }
    }

    return Promise.resolve(children);
  }
}
