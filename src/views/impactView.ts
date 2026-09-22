import * as vscode from "vscode";
import { CodeAtlasCli } from "../cliRunner";
import { ImpactAnalysis } from "../types";

export class ImpactTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly itemType: "root" | "category" | "dependent" | "message",
    public readonly symbolName?: string
  ) {
    super(label, collapsibleState);

    if (itemType === "root") {
      this.iconPath = new vscode.ThemeIcon("pulse", new vscode.ThemeColor("charts.red"));
    } else if (itemType === "category") {
      this.iconPath = new vscode.ThemeIcon("folder");
    } else if (itemType === "dependent") {
      this.iconPath = new vscode.ThemeIcon("references", new vscode.ThemeColor("charts.orange"));
      this.contextValue = "dependentSymbol";
      this.tooltip = `Dependent: ${label}\nClick to analyze impact or search definition`;

      // Clicking a dependent symbol searches for it in the codebase
      this.command = {
        command: "codeatlas.search",
        title: "Search Symbol Definition",
        arguments: [symbolName || label],
      };
    } else if (itemType === "message") {
      this.iconPath = new vscode.ThemeIcon("info");
    }
  }
}

export class ImpactViewProvider implements vscode.TreeDataProvider<ImpactTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ImpactTreeItem | undefined | null | void> =
    new vscode.EventEmitter<ImpactTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ImpactTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private currentTarget: string = "";
  private currentAnalysis: ImpactAnalysis | null = null;
  private isLoading: boolean = false;
  private errorMessage: string | null = null;

  constructor(private cli: CodeAtlasCli) {}

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  public async analyze(symbol?: string): Promise<void> {
    if (!symbol) {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const selection = editor.selection;
        const text = editor.document.getText(selection).trim();
        if (text) {
          symbol = text;
        } else {
          const wordRange = editor.document.getWordRangeAtPosition(selection.active);
          if (wordRange) {
            symbol = editor.document.getText(wordRange).trim();
          }
        }
      }
    }

    if (!symbol) {
      symbol = await vscode.window.showInputBox({
        prompt: "Enter symbol name (class or function) to analyze change blast radius",
        placeHolder: "e.g. Model2VecInner or search_lexical",
        value: this.currentTarget,
      });
    }

    if (!symbol || !symbol.trim()) {
      return;
    }

    this.currentTarget = symbol.trim();
    this.isLoading = true;
    this.errorMessage = null;
    this.refresh();

    try {
      this.currentAnalysis = await this.cli.impact(this.currentTarget);
      this.isLoading = false;
      this.refresh();

      const count = this.currentAnalysis.affected_count;
      const dependents = this.currentAnalysis.direct_dependents.length;
      vscode.window.showInformationMessage(
        `CodeAtlas: "${this.currentTarget}" has ${dependents} direct callers, ${count} total affected nodes.`
      );
    } catch (err: any) {
      this.isLoading = false;
      if (err.message === "NOT_INDEXED") {
        this.errorMessage = "Workspace not indexed yet. Run 'codeatlas index' first.";
      } else {
        this.errorMessage = `Impact analysis failed: ${err.message}`;
      }
      this.refresh();
    }
  }

  public getTreeItem(element: ImpactTreeItem): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: ImpactTreeItem): Thenable<ImpactTreeItem[]> {
    if (this.isLoading) {
      return Promise.resolve([
        new ImpactTreeItem(
          `Analyzing blast radius for "${this.currentTarget}"...`,
          vscode.TreeItemCollapsibleState.None,
          "message"
        ),
      ]);
    }

    if (this.errorMessage) {
      const errItem = new ImpactTreeItem(
        this.errorMessage,
        vscode.TreeItemCollapsibleState.None,
        "message"
      );
      errItem.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("charts.yellow"));
      return Promise.resolve([errItem]);
    }

    if (!element) {
      if (!this.currentAnalysis) {
        return Promise.resolve([
          new ImpactTreeItem(
            "Select a symbol and run 'CodeAtlas: Analyze Impact'",
            vscode.TreeItemCollapsibleState.None,
            "message"
          ),
        ]);
      }

      const a = this.currentAnalysis;
      const items: ImpactTreeItem[] = [];

      // Summary root node
      const summaryLabel = `Target: ${a.target} (Blast Radius: ${a.affected_count} affected)`;
      const summaryItem = new ImpactTreeItem(
        summaryLabel,
        vscode.TreeItemCollapsibleState.Expanded,
        "root"
      );
      items.push(summaryItem);

      return Promise.resolve(items);
    }

    if (element.itemType === "root" && this.currentAnalysis) {
      const a = this.currentAnalysis;
      const categories: ImpactTreeItem[] = [];

      // Direct Dependents Category
      const directLabel = `Direct Dependents (${a.direct_dependents.length})`;
      const directItem = new ImpactTreeItem(
        directLabel,
        a.direct_dependents.length > 0
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.None,
        "category"
      );
      categories.push(directItem);

      return Promise.resolve(categories);
    }

    if (element.itemType === "category" && this.currentAnalysis) {
      const a = this.currentAnalysis;
      if (a.direct_dependents.length === 0) {
        return Promise.resolve([
          new ImpactTreeItem(
            "No direct dependents detected (leaf node)",
            vscode.TreeItemCollapsibleState.None,
            "message"
          ),
        ]);
      }

      return Promise.resolve(
        a.direct_dependents.map((dep) => {
          const cleanName = dep.replace(/^(symbol|call):/, "");
          return new ImpactTreeItem(
            cleanName,
            vscode.TreeItemCollapsibleState.None,
            "dependent",
            cleanName
          );
        })
      );
    }

    return Promise.resolve([]);
  }
}
